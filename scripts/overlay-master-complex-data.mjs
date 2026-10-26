// Apply the operator's confirmed whole-complex mapping table to the static fallback records.
// Usage: node scripts/overlay-master-complex-data.mjs --master=../naver/전체_단지_매핑표.json
// The source mapping file stays outside this repository; only verified matching rows are emitted.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findNaverComplex, matchNaverTradeNames, naverNameKey } from '../shared/naver-name-match.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const i = arg.indexOf('='); return i < 0 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, i), arg.slice(i + 1)];
}));
if (!args.master) throw new Error('--master=<전체 단지 매핑표 JSON 경로> is required');
const norm = (s) => String(s || '').normalize('NFKC').replace(/[\s·()\[\]{}.,_-]/g, '').toLowerCase();
const masterRaw = JSON.parse(await readFile(args.master, 'utf8'));
const masterRows = Object.entries(masterRaw).map(([id, row]) => ({ id, ...row }));
const index = JSON.parse(await readFile('data/complex-index.json', 'utf8')).entries;
const byIdentity = new Map();
const byArea = new Map();
for (const row of masterRows) {
  if (row['단지정보 상태'] !== '확인됨' || !(Number(row['세대수']) > 0)) continue;
  const area = [row['시'], row['구'], row['법정동']].join('|');
  if (!byArea.has(area)) byArea.set(area, []);
  byArea.get(area).push(row);
  const key = [row['시'], row['구'], row['법정동'], norm(row['단지명'])].join('|');
  if (!byIdentity.has(key)) byIdentity.set(key, []);
  byIdentity.get(key).push(row);
}
const cityByPrefix = { '11':'서울','26':'부산','27':'대구','28':'인천','29':'광주','30':'대전','31':'울산','36':'세종','41':'경기','42':'강원','43':'충북','44':'충남','45':'전북','46':'전남','47':'경북','48':'경남','50':'제주' };
const cityOf = (lawd) => String(lawd).startsWith('IC-') ? '인천' : /^(HS-|BC-)/.test(lawd) ? '경기' : cityByPrefix[String(lawd).slice(0, 2)];
const identities = [];
let unmatched = 0, ambiguousComplex = 0, corroboratedFuzzy = 0, fuzzyAmbiguous = 0;
const sourceCache = new Map();
async function readSource(kind, lawd) {
  const key = `${kind}|${lawd}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  let value = null;
  try { value = JSON.parse(await readFile(path.join('data', kind, `${lawd}.json`), 'utf8')); } catch {}
  sourceCache.set(key, value);
  return value;
}
async function corroboratedRows(complex, names) {
  const areaRows = byArea.get([cityOf(complex.lawd), complex.region, complex.umd].join('|')) || [];
  if (!areaRows.length) return [];
  const masterCandidates = new Map();
  for (const row of areaRows) {
    const key = naverNameKey(row['단지명'], complex.umd);
    if (!masterCandidates.has(key)) masterCandidates.set(key, []);
    masterCandidates.get(key).push(row);
  }
  const reserved = new Set(masterCandidates.keys());
  const masterHits = new Map();
  for (const name of names) for (const row of matchNaverTradeNames(masterCandidates, name, complex.umd, { reserved, strict: true })) masterHits.set(row.id, row);
  if (!masterHits.size) return [];

  const naverData = await readSource('hhcnt-naver', complex.lawd);
  const naverHits = names.map((name) => findNaverComplex(naverData?.items, name, { dong: complex.umd })).filter(Boolean);
  const kaptData = await readSource('hhcnt', complex.lawd);
  const kaptPool = (kaptData?.items || []).filter((item) => !item.kaptAddr || item.kaptAddr.includes(complex.umd));
  const kaptCandidates = new Map();
  for (const item of kaptPool) {
    const key = naverNameKey(item.name || '');
    if (!kaptCandidates.has(key)) kaptCandidates.set(key, []);
    kaptCandidates.get(key).push(item);
  }
  const kaptHits = new Map();
  for (const name of names) for (const item of matchNaverTradeNames(kaptCandidates, name)) kaptHits.set(item.kaptCode || `${item.kaptName}|${item.hhcnt}|${item.useDate}`, item);
  const yearsMatch = (sourceYear, masterYear) => {
    const a = Number(String(sourceYear || '').slice(0, 4));
    const b = Number(String(masterYear || '').slice(0, 4));
    return a >= 1800 && b >= 1800 && Math.abs(a - b) <= 1;
  };
  return [...masterHits.values()].filter((row) => {
    const naverConfirmed = naverHits.some((hit) => Number(hit.hh) === Number(row['세대수']) && yearsMatch(hit.built, row['준공년월']));
    const kaptConfirmed = [...kaptHits.values()].some((hit) => Number(hit.hhcnt) === Number(row['세대수']) && yearsMatch(hit.useDate, row['준공년월']));
    return naverConfirmed || kaptConfirmed;
  });
}
for (const complex of index) {
  const names = [...new Set([complex.name, ...(complex.names || [])].filter(Boolean))];
  const exactKey = [cityOf(complex.lawd), complex.region, complex.umd, norm(complex.name)].join('|');
  const exactRows = new Map((byIdentity.get(exactKey) || []).map((row) => [row.id, row]));
  const rows = new Map(exactRows);
  if (!rows.size) for (const name of names.slice(1)) {
    const key = [cityOf(complex.lawd), complex.region, complex.umd, norm(name)].join('|');
    for (const row of byIdentity.get(key) || []) rows.set(row.id, row);
  }
  if (rows.size === 0) {
    const corroborated = await corroboratedRows(complex, names);
    if (corroborated.length === 1) { rows.set(corroborated[0].id, corroborated[0]); corroboratedFuzzy++; }
    else { if (corroborated.length > 1) { ambiguousComplex++; fuzzyAmbiguous++; } else unmatched++; continue; }
  }
  if (rows.size !== 1) { ambiguousComplex++; continue; }
  identities.push({ complex, row: [...rows.values()][0], names });
}
// An alias is safe to override only when it points to one confirmed mapping row in its legal dong.
const claims = new Map();
for (const { complex, row, names } of identities) for (const name of names) {
  const exactKey = [cityOf(complex.lawd), complex.region, complex.umd, norm(name)].join('|');
  const exactRows = byIdentity.get(exactKey) || [];
  // Preserve canonical labels, but don't reuse an alias that actually belongs to a different mapped complex.
  if (name !== complex.name && (exactRows.length !== 1 || exactRows[0].id !== row.id)) continue;
  const key = [complex.lawd, complex.umd, norm(name)].join('|');
  if (!claims.has(key)) claims.set(key, { name, lawd: complex.lawd, umd: complex.umd, rows: new Map(), names: new Set() });
  claims.get(key).rows.set(row.id, row);
  claims.get(key).names.add(name);
}
const safeClaims = [...claims.values()].filter((claim) => claim.rows.size === 1);
const overridesByLawd = new Map();
const numberOrNull = (value) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
for (const claim of safeClaims) {
  const row = [...claim.rows.values()][0];
  if (!overridesByLawd.has(claim.lawd)) overridesByLawd.set(claim.lawd, []);
  for (const name of claim.names) overridesByLawd.get(claim.lawd).push({
    name,
    hh: Number(row['세대수']),
    umd: claim.umd,
    built: row['준공년월'] || null,
    far: numberOrNull(row['용적률']),
    bcr: numberOrNull(row['건폐율']),
    dongCnt: numberOrNull(row['총동수']),
    masterId: row.id,
  });
}
let replaced = 0, inserted = 0, aliasesSkipped = claims.size - safeClaims.length, duplicateDirectAliases = 0;
for (const [lawd, overrides] of overridesByLawd) {
  const uniqueOverrides = [];
  const directNames = new Set();
  for (const item of overrides) {
    const directKey = `${item.umd}|${item.name.replace(/\s/g, '')}`;
    if (directNames.has(directKey)) { duplicateDirectAliases++; continue; }
    directNames.add(directKey);
    uniqueOverrides.push(item);
  }
  const file = path.join('data/hhcnt-naver', `${lawd}.json`);
  let data = { items: {}, keyIndex: {} };
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const items = { ...(data.items || {}) };
  const authoritativeNames = new Map(uniqueOverrides.map((item) => [`${item.umd}|${norm(item.name)}`, item]));
  for (const [key, value] of Object.entries(items)) {
    if (value?.umd && authoritativeNames.has(`${value.umd}|${norm(value.name)}`)) { delete items[key]; replaced++; }
  }
  for (const item of uniqueOverrides) {
    const key = `${norm(item.name)}|${item.umd}|${inserted}`;
    items[key] = item;
    inserted++;
  }
  const keyIndex = {};
  const keyCounts = {};
  for (const [key, item] of Object.entries(items)) {
    const nameKey = naverNameKey(item.name || '');
    keyCounts[nameKey] = (keyCounts[nameKey] || 0) + 1;
    keyIndex[nameKey] = keyCounts[nameKey] === 1 ? key : null;
  }
  await writeFile(file, JSON.stringify({ items, keyIndex, updatedAt: new Date().toISOString() }));
}
console.log(JSON.stringify({ appComplexes: index.length, masterRows: masterRows.length, exactOrCorroboratedComplexes: identities.length, corroboratedFuzzy, unmatched, ambiguousComplex, fuzzyAmbiguous, safeAliases: inserted, ambiguousAliases: aliasesSkipped, duplicateDirectAliases, replaced }, null, 2));
