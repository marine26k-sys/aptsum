import { readFile, mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { REGIONS } from '../shared/regions.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const i = arg.indexOf('=');
  return i < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, i), arg.slice(i + 1)];
}));
if (!args.master) throw new Error('--master=<전체 단지 매핑표 JSON 경로> is required');
const freshKbTypes = args['kb-types'] ? JSON.parse(await readFile(args['kb-types'], 'utf8')) : null;
const normalize = (value) => String(value || '').normalize('NFKC').replace(/[\s·ㆍ()\[\]{}.,_-]/g, '').toLocaleLowerCase('ko-KR');
const regionCodes = new Map(REGIONS.flatMap(([, regions]) => regions));
const freshTypesByNaverId = new Map();
const supplyPyeongByType = new Map();
const freshIdsByIdentity = new Map();
for (const complex of freshKbTypes?.complexes || []) {
  const ids = complex.targetNaverIds || (complex.matchedTarget?.naverId ? [complex.matchedTarget.naverId] : []);
  for (const naverId of ids) {
    if (!freshTypesByNaverId.has(Number(naverId))) freshTypesByNaverId.set(Number(naverId), []);
    freshTypesByNaverId.get(Number(naverId)).push(...(complex.areas || []));
  }
  for (const area of complex.areas || []) {
    const type = String(area.websiteTypeName || '').trim();
    const supply = Number(area.supplyM2);
    if (!type || !Number.isFinite(supply) || supply <= 0) continue;
    for (const naverId of ids) {
      const key = `${Number(naverId)}|${type}`;
      const pyeong = Math.floor(supply * 0.3025);
      if (!supplyPyeongByType.has(key)) supplyPyeongByType.set(key, pyeong);
      else if (supplyPyeongByType.get(key) !== pyeong) supplyPyeongByType.set(key, null);
    }
  }
  const target = complex.matchedTarget;
  const lawd = target?.district ? regionCodes.get(target.district) : null;
  if (lawd && target?.dong && target?.name && ids.length === 1) {
    const identity = [lawd, normalize(target.dong), normalize(target.name)].join('|');
    if (!freshIdsByIdentity.has(identity)) freshIdsByIdentity.set(identity, new Set());
    freshIdsByIdentity.get(identity).add(Number(ids[0]));
  }
}

const exactAreaKey = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return '';
  const [whole, fraction = ''] = text.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
};
const master = JSON.parse(await readFile(args.master, 'utf8'));
const index = JSON.parse(await readFile('data/complex-index.json', 'utf8')).entries;
const byIdentity = new Map();
const byRegionAndName = new Map();
for (const [id, row] of Object.entries(master)) {
  if (row['단지정보 상태'] !== '확인됨') continue;
  const lawd = regionCodes.get(row['구']);
  if (!lawd || !row['법정동'] || !row['단지명']) continue;
  const key = [lawd, normalize(row['법정동']), normalize(row['단지명'])].join('|');
  if (!byIdentity.has(key)) byIdentity.set(key, []);
  const entry = { id, row, dong: normalize(row['법정동']) };
  byIdentity.get(key).push(entry);
  const nameKey = `${lawd}|${normalize(row['단지명'])}`;
  if (!byRegionAndName.has(nameKey)) byRegionAndName.set(nameKey, []);
  byRegionAndName.get(nameKey).push(entry);
}

const identityFor = (complex, name) => [complex.lawd, normalize(complex.umd), normalize(name)].join('|');
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
  const resolvedNaverId = candidates.size === 1 ? Number([...candidates.keys()][0]) : freshIds.size === 1 ? [...freshIds][0] : null;
  if (!resolvedNaverId) { if (candidates.size > 1 || freshIds.size > 1) ambiguous++; else unmatched++; continue; }
  const row = candidates.size === 1 ? candidates.values().next().value : null;
  const byArea = new Map();
  const exactExclusiveTypes = new Map();
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
    // 같은 타입이 소수점 면적 차이로 중복 기재된 경우 한 번만 집계한다.
    types.set(type, Math.max(types.get(type) || 0, households));
  }
  // After the one-time live KB collection finishes, supplement/replace gaps in the older mapping
  // with the freshly collected type inventory, including types that have no KB price.
  for (const area of freshTypesByNaverId.get(resolvedNaverId) || []) {
    const exclusive = Number(area.exclusiveM2);
    if (!Number.isFinite(exclusive) || exclusive <= 0) continue;
    // Keep the website/Naver type label. A raw KB label is unsafe when the
    // Naver area match was ambiguous: it can duplicate or mislabel a confirmed
    // type already present in the canonical map.
    const type = String(area.websiteTypeName || '').trim();
    if (!type) continue;
    const exactKey = exactAreaKey(area.exclusiveM2);
    if (exactKey) {
      if (!exactExclusiveTypes.has(exactKey)) exactExclusiveTypes.set(exactKey, new Set());
      exactExclusiveTypes.get(exactKey).add(type);
    }
    const households = Number(area.households);
    if (Number.isInteger(households) && households > 0) {
      const areaKey = String(Math.floor(exclusive));
      if (!byArea.has(areaKey)) byArea.set(areaKey, new Map());
      const types = byArea.get(areaKey);
      types.set(type, Math.max(types.get(type) || 0, households));
    }
  }
  if (!byArea.size && !exactExclusiveTypes.size) continue;
  const areas = Object.fromEntries([...byArea].map(([area, types]) => [area, [...types].map(([type, households]) => ({ type, households, supplyPyeong: supplyPyeongByType.get(`${resolvedNaverId}|${type}`) ?? null })).sort((a, b) => a.type.localeCompare(b.type, 'ko', { numeric: true }))]));
  const exactTypes = Object.fromEntries([...exactExclusiveTypes].map(([area, types]) => [area, [...types].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))]));
  complexesWithAreas++;
  typeCount += Object.values(areas).reduce((sum, types) => sum + types.length, 0);
  for (const name of new Set([complex.name, ...(complex.names || [])].filter(Boolean))) {
    const key = identityFor(complex, name);
    if (!matchByIndex.has(key)) matchByIndex.set(key, { ids: new Set(), lawd: complex.lawd, umd: complex.umd, areas, exactTypes });
    matchByIndex.get(key).ids.add(resolvedNaverId);
  }
}

const shards = new Map();
const exactShards = new Map();
const ambiguousKeys = new Map();
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
  if (items[lookupKey]) {
    delete items[lookupKey];
    delete exactShards.get(entry.lawd)[lookupKey];
    ambiguousKeys.get(entry.lawd).add(lookupKey);
    aliasesSkipped++;
    continue;
  }
  items[lookupKey] = entry.areas;
  exactShards.get(entry.lawd)[lookupKey] = entry.exactTypes;
  keysWritten++;
}

const outDir = 'data/complex-type-households';
await mkdir(outDir, { recursive: true });
for (const file of await readdir(outDir)) await unlink(path.join(outDir, file));
for (const [lawd, items] of shards) await writeFile(path.join(outDir, `${lawd}.json`), JSON.stringify({ items, exactExclusiveTypes: exactShards.get(lawd) || {} }));
console.log(JSON.stringify({ indexComplexes: index.length, complexesWithTypes: complexesWithAreas, typeAreaRows: typeCount, lookupKeys: keysWritten, prefixDongMatches, aliasesSkipped, ambiguous, unmatched, shards: shards.size }, null, 2));
