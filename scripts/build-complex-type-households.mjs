import { readFile, mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { REGIONS } from '../shared/regions.mjs';
import { verifiedCombinedKBTypes } from '../shared/kb-combined-complex.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const i = arg.indexOf('=');
  return i < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, i), arg.slice(i + 1)];
}));
if (!args.master) throw new Error('--master=<전체 단지 매핑표 JSON 경로> is required');
const freshKbTypes = args['kb-types'] ? JSON.parse(await readFile(args['kb-types'], 'utf8')) : null;
const normalize = (value) => String(value || '').normalize('NFKC').replace(/[\s·ㆍ()\[\]{}.,_-]/g, '').toLocaleLowerCase('ko-KR');
const regionCodes = new Map(REGIONS.flatMap(([city, regions]) => regions.map(([district, code]) => [`${city}|${district}`, code])));
const codesByDistrict = new Map();
for (const [, regions] of REGIONS) {
  for (const [district, code] of regions) {
    if (!codesByDistrict.has(district)) codesByDistrict.set(district, []);
    codesByDistrict.get(district).push(code);
  }
}
const master = JSON.parse(await readFile(args.master, 'utf8'));
function masterRegionCode(row) {
  return row && regionCodes.get(`${row['시']}|${row['구']}`);
}
const locationKey = (city, district, dong) => [
  normalize(city).replace(/도/g, ''),
  normalize(district).replace(/시/g, ''),
  normalize(dong),
].join('|');
function completionYear(value) {
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}
function hasCorroboratingKBData(complex, row) {
  if (!row || locationKey(complex.city, complex.district, complex.dong) !==
      locationKey(row['시'], row['구'], row['법정동'])) return false;
  const areas = complex.areas || [];
  if (!areas.length || areas.some(area => {
    const exclusive = Number(area.exclusiveM2);
    const supply = Number(area.supplyM2);
    return !(exclusive > 0 && supply >= exclusive &&
      Number.isInteger(Number(area.households)) && Number(area.households) > 0);
  })) return false;
  const households = areas.reduce((sum, area) => sum + Number(area.households), 0);
  if (!Number(row['세대수']) || households !== Number(row['세대수'])) return false;
  const confirmedAreas = (row['면적별'] || []).filter(area =>
    area['상태'] === 'confirmed' && Number(area['전용면적']) > 0 &&
    Number(area['공급면적']) >= Number(area['전용면적']));
  const everyKBAreaExists = areas.every(area => confirmedAreas.some(candidate =>
    Math.abs(Number(candidate['전용면적']) - Number(area.exclusiveM2)) <= 0.02 &&
    Math.abs(Number(candidate['공급면적']) - Number(area.supplyM2)) <= 0.02));
  if (!everyKBAreaExists) return false;
  // The current KB type catalog does not expose a completion year. If a future
  // export does, use it as another required cross-check when the master has one.
  const kbYear = completionYear(complex.completionYear ?? complex.builtYear ?? complex.year ?? complex['준공연도'] ?? complex['준공년월']);
  const masterYear = completionYear(row['준공년월'] ?? row['준공연도']);
  return kbYear == null || masterYear == null || kbYear === masterYear;
}
const masterByLocation = new Map();
for (const [id, row] of Object.entries(master)) {
  if (row['단지정보 상태'] !== '확인됨' || !masterRegionCode(row) || !row['법정동']) continue;
  const key = locationKey(row['시'], row['구'], row['법정동']);
  if (!masterByLocation.has(key)) masterByLocation.set(key, []);
  masterByLocation.get(key).push([id, row]);
}
const freshTypesByNaverId = new Map();
const freshIdsByIdentity = new Map();
// KB가 두 관리단지로 수집한 곳을 네이버가 한 단지로 표시한다. 위치·면적·세대수
// 합계가 모두 일치할 때만 두 KB 원본을 합산 단지에 연결한다.
const combinedKBGroups = new Map([[1992, [4756, 4750]]]);
const verifiedCombined = new Map();
for (const [naverId, kbIds] of combinedKBGroups) {
  const kbComplexes = kbIds.map(id => freshKbTypes?.complexes?.find(complex => Number(complex.kbComplexId) === id));
  if (kbComplexes.every(Boolean) && verifiedCombinedKBTypes(master[String(naverId)], kbComplexes)) {
    for (const kbId of kbIds) verifiedCombined.set(kbId, naverId);
  }
}
const verifiedCombinedNaverIds = new Set(verifiedCombined.values());
let crossCheckedMatches = 0;
let crossCheckedNameVariants = 0;
let exactIdentityFallbacks = 0;
for (const complex of freshKbTypes?.complexes || []) {
  let target = complex.matchedTarget;
  let ids = complex.targetNaverIds || (target?.naverId ? [target.naverId] : []);
  const combinedNaverId = verifiedCombined.get(Number(complex.kbComplexId));
  if (combinedNaverId) {
    const combinedMaster = master[String(combinedNaverId)];
    ids = [combinedNaverId];
    target = { naverId: combinedNaverId, name: combinedMaster['단지명'], district: combinedMaster['구'], dong: combinedMaster['법정동'] };
  }
  // Some KB catalog records lack targetNaverIds. Use one shared area Naver ID
  // when present; if the name differs, require exact location, total household
  // count, and every KB area dimension to agree with the confirmed master row.
  // With no Naver ID, accept one exact name+location row, or one unique row
  // corroborated by the same household and complete area-dimension checks.
  if (!ids.length) {
    const areaIds = new Set((complex.areas || []).map(area => Number(area.naverId)).filter(id => Number.isInteger(id) && id > 0));
    if (areaIds.size === 1) {
      const candidateId = [...areaIds][0];
      const candidate = master[String(candidateId)];
      const simplifyDistrict = value => normalize(value).replace(/시/g, '');
      const sameIdentity = candidate &&
        normalize(complex.city) === normalize(candidate['시']) &&
        simplifyDistrict(complex.district) === simplifyDistrict(candidate['구']) &&
        normalize(complex.dong) === normalize(candidate['법정동']) &&
        normalize(complex.kbName) === normalize(candidate['단지명']);
      if (sameIdentity) {
        ids = [candidateId];
        target = { naverId: candidateId, name: candidate['단지명'], district: candidate['구'], dong: candidate['법정동'] };
      } else if (hasCorroboratingKBData(complex, candidate)) {
        ids = [candidateId];
        target = { naverId: candidateId, name: candidate['단지명'], district: candidate['구'], dong: candidate['법정동'] };
        crossCheckedMatches++;
        if (normalize(complex.kbName) !== normalize(candidate['단지명'])) crossCheckedNameVariants++;
      }
    } else if (areaIds.size === 0) {
      const locationCandidates = masterByLocation.get(locationKey(complex.city, complex.district, complex.dong)) || [];
      const exactNameCandidates = locationCandidates.filter(([, row]) => normalize(complex.kbName) === normalize(row['단지명']));
      const corroboratedCandidates = locationCandidates.filter(([, row]) => hasCorroboratingKBData(complex, row));
      const selected = exactNameCandidates.length === 1
        ? exactNameCandidates[0]
        : corroboratedCandidates.length === 1 ? corroboratedCandidates[0] : null;
      if (selected) {
        const [candidateId, candidate] = selected;
        ids = [Number(candidateId)];
        target = { naverId: Number(candidateId), name: candidate['단지명'], district: candidate['구'], dong: candidate['법정동'] };
        if (normalize(complex.kbName) === normalize(candidate['단지명'])) exactIdentityFallbacks++;
        else {
          crossCheckedMatches++;
          crossCheckedNameVariants++;
        }
      }
    }
  }
  for (const naverId of ids) {
    if (!freshTypesByNaverId.has(Number(naverId))) freshTypesByNaverId.set(Number(naverId), []);
    freshTypesByNaverId.get(Number(naverId)).push(...(complex.areas || []).map(area => ({ ...area, kbComplexId: complex.kbComplexId })));
  }
  const districtCodes = codesByDistrict.get(target?.district) || [];
  const masterCode = ids.length === 1 ? masterRegionCode(master[ids[0]]) : null;
  const lawd = districtCodes.includes(masterCode) ? masterCode : districtCodes.length === 1 ? districtCodes[0] : null;
  if (lawd && target?.dong && target?.name && ids.length === 1) {
    const targetMaster = master[String(ids[0])];
    const identities = new Set([
      [lawd, normalize(target.dong), normalize(target.name)].join('|'),
    ]);
    if (targetMaster && masterRegionCode(targetMaster) === lawd) {
      identities.add([lawd, normalize(targetMaster['법정동']), normalize(targetMaster['단지명'])].join('|'));
    }
    for (const identity of identities) {
      if (!freshIdsByIdentity.has(identity)) freshIdsByIdentity.set(identity, new Set());
      freshIdsByIdentity.get(identity).add(Number(ids[0]));
    }
  }
}

const exactAreaKey = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return '';
  const [whole, fraction = ''] = text.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
};
const index = JSON.parse(await readFile('data/complex-index.json', 'utf8')).entries;
const byIdentity = new Map();
const byRegionAndName = new Map();
const byVillageNameIdentity = new Map();
const tradeYearsByDistrict = new Map();
async function tradeYearsFor(lawd) {
  if (tradeYearsByDistrict.has(lawd)) return tradeYearsByDistrict.get(lawd);
  const years = new Map();
  const dir = path.join('data/analyze', lawd);
  for (const file of await readdir(dir).catch(() => [])) {
    if (!file.endsWith('.json')) continue;
    const month = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    for (const trade of month.items || []) {
      const year = completionYear(trade.build);
      if (!year) continue;
      const key = `${normalize(trade.umd)}|${normalize(trade.apt)}`;
      if (!years.has(key)) years.set(key, new Set());
      years.get(key).add(year);
    }
  }
  tradeYearsByDistrict.set(lawd, years);
  return years;
}
for (const [id, row] of Object.entries(master)) {
  if (row['단지정보 상태'] !== '확인됨') continue;
  const lawd = masterRegionCode(row);
  if (!lawd || !row['법정동'] || !row['단지명']) continue;
  const key = [lawd, normalize(row['법정동']), normalize(row['단지명'])].join('|');
  if (!byIdentity.has(key)) byIdentity.set(key, []);
  const entry = { id, row, dong: normalize(row['법정동']) };
  byIdentity.get(key).push(entry);
  const villageKey = [lawd, normalize(row['법정동']), normalize(row['단지명']).replace(/마을/g, '')].join('|');
  if (!byVillageNameIdentity.has(villageKey)) byVillageNameIdentity.set(villageKey, []);
  byVillageNameIdentity.get(villageKey).push(entry);
  const nameKey = `${lawd}|${normalize(row['단지명'])}`;
  if (!byRegionAndName.has(nameKey)) byRegionAndName.set(nameKey, []);
  byRegionAndName.get(nameKey).push(entry);
}

const identityFor = (complex, name) => [complex.lawd, normalize(complex.umd), normalize(name)].join('|');
const typeSuffix = (value) => {
  const normalized = String(value || '').normalize('NFKC').toLocaleUpperCase('ko-KR').trim();
  return normalized.match(/^\d+(?:\.\d+)?(.*)$/)?.[1]?.trim() || '';
};
function mapFreshAreaType(area, row) {
  const exclusive = Number(area.exclusiveM2);
  const supply = Number(area.supplyM2);
  if (!(exclusive > 0) || !(supply >= exclusive)) return { type: '', siteTypeMatched: false };
  const candidates = (row?.['면적별'] || []).filter(item =>
    item['상태'] === 'confirmed' && String(item['타입명'] || '').trim() &&
    Math.abs(Number(item['전용면적']) - exclusive) <= 0.02 &&
    Math.abs(Number(item['공급면적']) - supply) <= 0.02);
  const names = [...new Set(candidates.map(item => String(item['타입명']).trim()))];
  // A master row can carry the wrong Naver label for a specific KB area ID.
  // The fresh catalog's per-area website label must win in that case.
  const matchingKbArea = candidates.find(item =>
    Number(item['KB면적ID']) === Number(area.kbAreaId) &&
    normalize(item['KB타입명']) === normalize(area.kbTypeName));
  if (matchingKbArea && area.websiteTypeName &&
      normalize(matchingKbArea['타입명']) !== normalize(area.websiteTypeName)) {
    return { type: String(area.websiteTypeName).trim(), siteTypeMatched: true };
  }
  if (names.length === 1) return { type: names[0], siteTypeMatched: true };
  // Even when the catalog did not link a KB type to Naver, the operator's
  // master map can still carry the same KB type label on the exact same area.
  // Prefer that verified label before using a suffix-only fallback.
  const kbType = normalize(area.kbTypeName);
  const kbTypeMatches = [...new Set(kbType ? candidates.filter(item =>
    normalize(item['KB타입명']) === kbType || normalize(item['타입명']) === kbType
  ).map(item => String(item['타입명']).trim()) : [])];
  if (kbTypeMatches.length === 1) return { type: kbTypeMatches[0], siteTypeMatched: true };
  const websiteType = normalize(area.websiteTypeName);
  const websiteMatches = [...new Set(websiteType ? candidates.filter(item =>
    normalize(item['타입명']) === websiteType
  ).map(item => String(item['타입명']).trim()) : [])];
  if (websiteMatches.length === 1) return { type: websiteMatches[0], siteTypeMatched: true };
  const suffix = typeSuffix(area.typeSuffix || area.kbTypeName);
  const suffixMatches = [...new Set(candidates
    .filter(item => suffix && typeSuffix(item['타입명']) === suffix)
    .map(item => String(item['타입명']).trim()))];
  if (suffixMatches.length === 1) return { type: suffixMatches[0], siteTypeMatched: true };
  // KB's exact type-name match can include a second supply-area entry under
  // the same Naver label; retain it as a separate supply-floor row.
  if (area.typeMatchStatus === 'exact_KB_type' && area.websiteTypeName) {
    return { type: String(area.websiteTypeName).trim(), siteTypeMatched: true };
  }
  // Keep the KB type available to the analysis even when Naver has no exact
  // type-name row. The UI shows its exclusive area and can match its
  // supply group using the exact area.
  const kbLabel = String(area.kbTypeName || area.websiteTypeName || '').trim();
  return { type: kbLabel ? `KB:${kbLabel}` : '', siteTypeMatched: false };
}
const matchByIndex = new Map();
let ambiguous = 0, unmatched = 0, prefixDongMatches = 0, complexesWithAreas = 0, typeCount = 0;
for (const complex of index) {
  const candidates = new Map();
  const freshIds = new Set();
  const names = new Set([complex.name, ...(complex.names || [])].filter(Boolean));
  for (const name of names) {
    for (const match of byIdentity.get(identityFor(complex, name)) || []) candidates.set(match.id, match.row);
    for (const id of freshIdsByIdentity.get(identityFor(complex, name)) || []) freshIds.add(id);
  }
  // The index can retain "마을" while the verified Naver/KB identity omits it.
  // Require the same dong, KB household total, and reported completion year.
  if (!candidates.size && !freshIds.size) {
    const variants = new Map();
    const variantEntries = [...names].flatMap(name => {
      const key = [complex.lawd, normalize(complex.umd), normalize(name).replace(/마을/g, '')].join('|');
      return byVillageNameIdentity.get(key) || [];
    });
    if (variantEntries.length) {
      const tradeYears = await tradeYearsFor(complex.lawd);
      const indexYears = new Set([...names].flatMap(name =>
        [...(tradeYears.get(`${normalize(complex.umd)}|${normalize(name)}`) || [])]));
      for (const match of variantEntries) {
        const freshAreas = freshTypesByNaverId.get(Number(match.id)) || [];
        const masterYear = completionYear(match.row['준공년월'] ?? match.row['준공연도']);
        const kbHouseholds = freshAreas.reduce((sum, area) => sum + Number(area.households || 0), 0);
        if (masterYear && indexYears.has(masterYear) && kbHouseholds === Number(match.row['세대수'])) {
          variants.set(match.id, match.row);
        }
      }
    }
    if (variants.size === 1) for (const [id, row] of variants) candidates.set(id, row);
  }
  // The complex index often includes a legal ri after the eup/myeon/dong
  // (for example, "봉담읍 내리"), while the canonical map stores only the
  // administrative eup/myeon/dong ("봉담읍"). Match that hierarchy only
  // when the complex name and region identify exactly one canonical row.
  if (!candidates.size) {
    const complexDong = normalize(complex.umd);
    const prefixCandidates = new Map();
    for (const name of names) {
      for (const match of byRegionAndName.get(`${complex.lawd}|${normalize(name)}`) || []) {
        if (complexDong.startsWith(match.dong)) prefixCandidates.set(match.id, match.row);
      }
      for (const id of freshIdsByIdentity.get(identityFor(complex, name)) || []) freshIds.add(id);
    }
    if (prefixCandidates.size === 1) {
      for (const [id, row] of prefixCandidates) candidates.set(id, row);
      prefixDongMatches++;
    } else if (prefixCandidates.size > 1) {
      ambiguous++;
      continue;
    }
  }
  if (candidates.size > 1) {
    const canonical = byIdentity.get(identityFor(complex, complex.name)) || [];
    if (canonical.length === 1) {
      candidates.clear();
      candidates.set(canonical[0].id, canonical[0].row);
    }
  }
  if (candidates.size === 1 && freshIds.size > 0 && [...freshIds].some(id => !candidates.has(String(id)))) {
    ambiguous++;
    continue;
  }
  const resolvedNaverId = candidates.size === 1 ? Number([...candidates.keys()][0]) : freshIds.size === 1 ? [...freshIds][0] : null;
  if (!resolvedNaverId) { if (candidates.size > 1 || freshIds.size > 1) ambiguous++; else unmatched++; continue; }
  const row = candidates.size === 1 ? candidates.values().next().value : null;
  const byArea = new Map();
  const exactExclusiveTypes = new Map();
  const resolvedKBLabels = new Map();
  const masterVerifiedAreas = (row?.['면적별'] || []).filter(area =>
    area['상태'] === 'confirmed' && area['KB세대수상태'] === '확인됨' &&
    Number.isInteger(Number(area['KB세대수'])) && Number(area['KB세대수']) > 0);
  for (const area of row?.['면적별'] || []) {
    const exclusive = Number(area['전용면적']);
    const type = String(area['타입명'] || '').trim();
    // 실거래 행은 국토부 원본 전용면적을 소수점 둘째 자리까지 대조한다.
    // 같은 전용면적에 여러 타입이 있으면 전부 보존한다.
    if (area['상태'] === 'confirmed' && Number.isFinite(exclusive) && exclusive > 0 && type) {
      const exactKey = exactAreaKey(area['전용면적']);
      if (exactKey) {
        if (!exactExclusiveTypes.has(exactKey)) exactExclusiveTypes.set(exactKey, new Set());
        exactExclusiveTypes.get(exactKey).add(type);
      }
    }
    const households = Number(area['KB세대수']);
    if (area['상태'] !== 'confirmed' || area['KB세대수상태'] !== '확인됨' || !Number.isFinite(exclusive) || exclusive <= 0 || !Number.isInteger(households) || households <= 0 || !type) continue;
    const areaKey = String(Math.floor(exclusive));
    if (!byArea.has(areaKey)) byArea.set(areaKey, new Map());
    const types = byArea.get(areaKey);
    const supply = Number(area['공급면적']);
    const supplyAreaFloor = Number.isFinite(supply) && supply >= exclusive ? Math.floor(supply) : null;
    const supplyPyeong = supplyAreaFloor == null ? null : Math.floor(supply * 0.3025);
    const typeKey = `${type}|${supplyAreaFloor ?? ''}`;
    const old = types.get(typeKey);
    // 같은 타입명이더라도 KB 공급면적 정수 내림값이 다르면 별도 행으로 둔다.
    types.set(typeKey, {
      type,
      households: Math.max(old?.households || 0, households),
      supplyPyeong: supplyPyeong ?? old?.supplyPyeong ?? null,
      supplyAreaFloor: supplyAreaFloor ?? old?.supplyAreaFloor ?? null,
    });
  }
  // A matched KB complex is authoritative for the full area-type inventory.
  // Do not mix its type labels with older master-map rows, which can lack supply pyeong.
  const freshAreas = freshTypesByNaverId.get(resolvedNaverId) || [];
  if (freshAreas.length) { byArea.clear(); exactExclusiveTypes.clear(); }
  const targetMaster = master[String(resolvedNaverId)];
  const sameTargetIdentity = targetMaster && masterRegionCode(targetMaster) === complex.lawd &&
    normalize(targetMaster['법정동']) === normalize(complex.umd);
  for (const area of freshAreas) {
    const exclusive = Number(area.exclusiveM2);
    if (!Number.isFinite(exclusive) || exclusive <= 0) continue;
    // Use the site label from an exact match, or map by exact KB/Naver dimensions
    // when the KB type is absent from the Naver catalog's type-name mapping.
    // A linked complex can lack confirmed complex metadata while retaining
    // confirmed Naver types for individual KB area IDs.
    const typeRow = row || (sameTargetIdentity && {
      '면적별': (targetMaster['면적별'] || []).filter(item =>
        Number(item['KB단지ID']) === Number(area.kbComplexId) &&
        Number(item['KB면적ID']) === Number(area.kbAreaId)),
    });
    const { type, siteTypeMatched } = mapFreshAreaType(area, typeRow);
    if (!type) continue;
    const exactKey = exactAreaKey(area.exclusiveM2);
    if (exactKey && siteTypeMatched) {
      if (!exactExclusiveTypes.has(exactKey)) exactExclusiveTypes.set(exactKey, new Set());
      exactExclusiveTypes.get(exactKey).add(type);
    }
    const rawArea = (row?.['KB수집평형'] || []).find(item =>
      Number(item['KB단지ID']) === Number(area.kbComplexId) &&
      Number(item['KB면적ID']) === Number(area.kbAreaId));
    const households = Number(rawArea?.['KB세대수'] ?? area.households);
    if (Number.isInteger(households) && households > 0) {
      const areaKey = String(Math.floor(exclusive));
      if (!byArea.has(areaKey)) byArea.set(areaKey, new Map());
      const types = byArea.get(areaKey);
      const supply = Number(rawArea?.['공급면적'] ?? area.supplyM2);
      const supplyAreaFloor = Number.isFinite(supply) && supply >= exclusive ? Math.floor(supply) : null;
      const supplyPyeong = supplyAreaFloor == null ? null : Math.floor(supply * 0.3025);
      const combinedType = verifiedCombinedNaverIds.has(Number(resolvedNaverId));
      const typeKey = combinedType ? `${type}|${supplyAreaFloor ?? ''}` : area.kbAreaId ? `KB:${area.kbComplexId}|${area.kbAreaId}` : `${type}|${supplyAreaFloor ?? ''}`;
      const old = types.get(typeKey);
      const kbLabel = String(area.kbTypeName || area.websiteTypeName || '').trim();
      if (siteTypeMatched && kbLabel) {
        if (!resolvedKBLabels.has(areaKey)) resolvedKBLabels.set(areaKey, new Set());
        resolvedKBLabels.get(areaKey).add(`KB:${kbLabel}|${supplyAreaFloor ?? ''}`);
      }
      types.set(typeKey, {
        type,
        ...(!combinedType && area.kbAreaId ? { kbAreaId: Number(area.kbAreaId) } : {}),
        exclusiveAreas: [...new Set([...(old?.exclusiveAreas || []), exactKey].filter(Boolean))],
        ...(type.startsWith('KB:') ? { kbTypeName: String(area.kbTypeName || area.websiteTypeName || '').trim() } : {}),
        siteTypeMatched,
        households: combinedType ? (old?.households || 0) + households : Math.max(old?.households || 0, households),
        supplyPyeong: supplyPyeong ?? old?.supplyPyeong ?? null,
        supplyAreaFloor: supplyAreaFloor ?? old?.supplyAreaFloor ?? null,
      });
    }
  }
  // Keep directly verified KB areas that the latest catalog response omitted.
  for (const area of masterVerifiedAreas) {
    if (freshAreas.some(fresh => Number(fresh.kbComplexId) === Number(area['KB단지ID']) &&
      Number(fresh.kbAreaId) === Number(area['KB면적ID']))) continue;
    const exclusive = Number(area['전용면적']);
    const supply = Number(area['공급면적']);
    const households = Number(area['KB세대수']);
    const type = String(area['타입명'] || '').trim();
    if (!(exclusive > 0 && supply >= exclusive && Number.isInteger(households) && households > 0 && type)) continue;
    const size = String(Math.floor(exclusive));
    if (!byArea.has(size)) byArea.set(size, new Map());
    const supplyAreaFloor = Math.floor(supply);
    const typeKey = `${type}|${supplyAreaFloor}`;
    if (!byArea.get(size).has(typeKey)) byArea.get(size).set(typeKey, {
      type,
      households,
      supplyPyeong: Math.floor(supply * 0.3025),
      supplyAreaFloor,
    });
    const exact = exactAreaKey(exclusive);
    if (!exactExclusiveTypes.has(exact)) exactExclusiveTypes.set(exact, new Set());
    exactExclusiveTypes.get(exact).add(type);
  }
  if (!byArea.size && !exactExclusiveTypes.size) continue;
  const areas = Object.fromEntries([...byArea].map(([area, types]) => {
    const rows = [...types.values()].sort((a, b) => a.type.localeCompare(b.type, 'ko', { numeric: true }) || Number(a.supplyAreaFloor || 0) - Number(b.supplyAreaFloor || 0));
    const floors = [...new Set(rows.map(row => row.supplyAreaFloor).filter(Number.isInteger))].sort((a, b) => a - b);
    // Exact KB dimensions can resolve separate supply groups even when the
    // site type is unknown. Keep them only where the fallback needs them.
    if (!rows.some(row => row.siteTypeMatched === false) ||
        !floors.some((floor, index) => index > 0 && floor - floors[index - 1] >= 3)) {
      for (const row of rows) delete row.exclusiveAreas;
    }
    return [area, rows];
  }));
  const exactTypes = Object.fromEntries([...exactExclusiveTypes].map(([area, types]) => [area, [...types].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))]));
  complexesWithAreas++;
  typeCount += Object.values(areas).reduce((sum, types) => sum + types.length, 0);
  for (const name of new Set([complex.name, ...(complex.names || [])].filter(Boolean))) {
    const key = identityFor(complex, name);
    if (!matchByIndex.has(key)) matchByIndex.set(key, { ids: new Set(), lawd: complex.lawd, umd: complex.umd, areas, exactTypes, resolvedKBLabels });
    matchByIndex.get(key).ids.add(resolvedNaverId);
  }
}

const shards = new Map();
const exactShards = new Map();
const supplyPyeongShards = new Map();
const ambiguousKeys = new Map();
const outDir = 'data/complex-type-households';
const supplyPyeongDir = 'data/complex-supply-pyeong';
const preserved = new Map();
if (args['preserve-existing']) {
  for (const file of await readdir(outDir)) {
    if (!file.endsWith('.json')) continue;
    const lawd = file.slice(0, -5);
    const previous = JSON.parse(await readFile(path.join(outDir, file), 'utf8'));
    preserved.set(lawd, previous);
    shards.set(lawd, { ...previous.items });
    exactShards.set(lawd, { ...previous.exactExclusiveTypes });
    ambiguousKeys.set(lawd, new Set());
  }
}

function mergeAreas(previous, verified, resolvedKBLabels) {
  const areas = { ...previous };
  for (const [size, rows] of Object.entries(verified)) {
    const rowKey = row => row.kbAreaId ? `KB:${row.kbAreaId}` : `${row.type}|${Number.isInteger(row.supplyAreaFloor) ? row.supplyAreaFloor : ''}`;
    const resolved = resolvedKBLabels.get(size);
    const freshLabels = new Set(rows.map(row => `${row.type}|${row.supplyAreaFloor ?? ''}`));
    const byType = new Map((previous[size] || [])
      .filter(row => !freshLabels.has(`${row.type}|${row.supplyAreaFloor ?? ''}`) &&
        (row.siteTypeMatched !== false || !resolved?.has(rowKey(row))))
      .map(row => [rowKey(row), row]));
    for (const row of rows) {
      const key = rowKey(row);
      const old = byType.get(key);
      if (!old) {
        byType.set(key, row);
        continue;
      }
      const merged = {
        ...old,
        ...row,
        households: row.households ?? old.households,
        supplyPyeong: row.supplyPyeong ?? old.supplyPyeong,
        supplyAreaFloor: row.supplyAreaFloor ?? old.supplyAreaFloor,
      };
      if (!row.exclusiveAreas) delete merged.exclusiveAreas;
      byType.set(key, merged);
    }
    const verifiedTypesWithSupply = new Set(rows.filter(row => Number.isInteger(row.supplyAreaFloor)).map(row => row.type));
    for (const [key, row] of byType) {
      if (!Number.isInteger(row.supplyAreaFloor) && verifiedTypesWithSupply.has(row.type)) byType.delete(key);
    }
    areas[size] = [...byType.values()].sort((a, b) => a.type.localeCompare(b.type, 'ko', { numeric: true }) || Number(a.supplyAreaFloor || 0) - Number(b.supplyAreaFloor || 0));
  }
  return areas;
}
let aliasesSkipped = 0, keysWritten = 0;
for (const [key, entry] of matchByIndex) {
  if (entry.ids.size !== 1) { aliasesSkipped++; continue; }
  if (!shards.has(entry.lawd)) shards.set(entry.lawd, {});
  if (!exactShards.has(entry.lawd)) exactShards.set(entry.lawd, {});
  if (!ambiguousKeys.has(entry.lawd)) ambiguousKeys.set(entry.lawd, new Set());
  const [, normalizedDong, normalizedName] = key.split('|');
  const lookupKey = `${normalizedName}|${normalizedDong}`;
  const items = shards.get(entry.lawd);
  if (ambiguousKeys.get(entry.lawd).has(lookupKey)) continue;
  if (items[lookupKey] && !preserved.get(entry.lawd)?.items?.[lookupKey]) {
    delete items[lookupKey];
    delete exactShards.get(entry.lawd)[lookupKey];
    ambiguousKeys.get(entry.lawd).add(lookupKey);
    aliasesSkipped++;
    continue;
  }
  const existing = preserved.get(entry.lawd);
  const oldExact = existing?.exactExclusiveTypes?.[lookupKey] || {};
  const exactTypes = { ...oldExact };
  for (const [area, types] of Object.entries(entry.exactTypes)) {
    exactTypes[area] = [...new Set([...(oldExact[area] || []), ...types])].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  }
  items[lookupKey] = mergeAreas(existing?.items?.[lookupKey] || {}, entry.areas, entry.resolvedKBLabels);
  exactShards.get(entry.lawd)[lookupKey] = exactTypes;
  keysWritten++;
}

for (const [lawd, items] of shards) {
  const previousSupply = preserved.has(lawd)
    ? JSON.parse(await readFile(path.join(supplyPyeongDir, `${lawd}.json`), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '{}';
    })).items || {}
    : {};
  const supplyItems = { ...previousSupply };
  supplyPyeongShards.set(lawd, supplyItems);
  for (const [lookupKey, areas] of Object.entries(items)) {
    const bySize = {};
    for (const [size, rows] of Object.entries(areas)) {
      const counts = new Map();
      for (const row of rows) {
        const py = Number(row.supplyPyeong), hh = Number(row.households);
        if (Number.isInteger(py) && py > 0 && Number.isFinite(hh) && hh > 0) counts.set(py, (counts.get(py) || 0) + hh);
      }
      if (counts.size) bySize[size] = [...counts].sort((a,b) => b[1]-a[1] || a[0]-b[0])[0][0];
    }
    supplyItems[lookupKey] = { ...previousSupply[lookupKey], ...bySize };
  }
}
await mkdir(outDir, { recursive: true });
for (const file of await readdir(outDir)) await unlink(path.join(outDir, file));
for (const [lawd, items] of shards) await writeFile(path.join(outDir, `${lawd}.json`), JSON.stringify({ items, exactExclusiveTypes: exactShards.get(lawd) || {} }));
await mkdir(supplyPyeongDir, { recursive: true });
for (const file of await readdir(supplyPyeongDir)) await unlink(path.join(supplyPyeongDir, file));
for (const [lawd, items] of supplyPyeongShards) await writeFile(path.join(supplyPyeongDir, `${lawd}.json`), JSON.stringify({ items }));
console.log(JSON.stringify({ indexComplexes: index.length, complexesWithTypes: complexesWithAreas, typeAreaRows: typeCount, lookupKeys: keysWritten, prefixDongMatches, exactIdentityFallbacks, crossCheckedMatches, crossCheckedNameVariants, aliasesSkipped, ambiguous, unmatched, shards: shards.size }, null, 2));
