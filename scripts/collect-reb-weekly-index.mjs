import { writeFile } from 'node:fs/promises';

const apiKey = process.env.REB_RONE_API_KEY;
if (!apiKey) throw new Error('REB_RONE_API_KEY is required');

const TABLES = [
  { key: 'monthly', id: 'A_2024_00045', cycle: 'MM', item: '100001' },
  { key: 'weekly', id: 'T244183132827305', cycle: 'WK', item: '10001' },
];
const PROVINCES = ['서울', '경기', '인천', '부산'];
const API = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const TREE = 'https://www.reb.or.kr/r-one/portal/stat/statEasyItmJson.do';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url, options = {}) {
  let error;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (response.ok) return await response.json();
      error = new Error(`HTTP ${response.status}`);
    } catch (caught) { error = caught; }
    if (attempt < 4) await pause(attempt * 1000);
  }
  throw error;
}

async function getDistricts(table) {
  const response = await fetchJson(TREE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ statblId: table.id, itmTag: 'C', itmNmsearchVal: '', optDivVal: '21', langGb: '' }),
  });
  const leaves = (response.data || []).filter(node => node.leaf === 'T' && PROVINCES.some(p => node.viewItmFullnm.startsWith(`${p}>`)));
  if (!leaves.length) throw new Error(`No district nodes for ${table.id}`);
  return leaves.map(node => {
    const parts = node.viewItmFullnm.split('>');
    const province = parts[0];
    const city = parts.at(-2);
    const district = parts.at(-1);
    const name = province === '경기' && /시$/.test(city) && /구$/.test(district) ? `${city.slice(0, -1)} ${district}` : district;
    return { province, name, clsId: String(node.datano) };
  });
}

async function getSeries(table, district) {
  const url = new URL(API);
  for (const [key, value] of Object.entries({
    KEY: apiKey, Type: 'json', STATBL_ID: table.id, DTACYCLE_CD: table.cycle,
    ITM_ID: table.item, CLS_ID: district.clsId, pIndex: '1', pSize: '1000',
  })) url.searchParams.set(key, value);
  const payload = await fetchJson(url);
  const block = payload.SttsApiTblData;
  const head = block?.[0]?.head;
  const result = head?.find(item => item.RESULT)?.RESULT;
  if (result && result.CODE !== 'INFO-000') throw new Error(`${district.province} ${district.name}: ${result.CODE} ${result.MESSAGE}`);
  const rows = block?.[1]?.row;
  if (!Array.isArray(rows)) throw new Error(`No ${table.key} rows for ${district.province} ${district.name}`);
  return rows.map(row => ({
    period: String(row.WRTTIME_IDTFR_ID || ''),
    date: String(row.WRTTIME_DESC || ''),
    index: Number(row.DTA_VAL),
  })).filter(row => row.period && Number.isFinite(row.index)).sort((a, b) => a.period.localeCompare(b.period));
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await fn(items[index]);
      if (cursor < items.length) await pause(100);
    }
  }));
  return output;
}

const regionsByKey = new Map();
const meta = {};
for (const table of TABLES) {
  const districts = await getDistricts(table);
  const collected = await mapLimit(districts, 5, async district => ({ ...district, rows: await getSeries(table, district) }));
  for (const { province, name, rows } of collected) {
    const key = `${province}\u0000${name}`;
    const region = regionsByKey.get(key) || { province, name, monthly: [], weekly: [] };
    region[table.key] = rows;
    regionsByKey.set(key, region);
  }
  const labels = collected.flatMap(item => item.rows.map(row => row.date)).filter(Boolean).sort();
  meta[table.key] = { tableId: table.id, cycle: table.cycle, item: table.item, asOf: labels.at(-1) || '' };
}

const regions = [...regionsByKey.values()].sort((a, b) => PROVINCES.indexOf(a.province) - PROVINCES.indexOf(b.province) || a.name.localeCompare(b.name, 'ko'));
const output = {
  source: '한국부동산원 R-ONE 아파트 매매가격지수',
  sourceUrl: 'https://www.reb.or.kr/r-one/portal/openapi/openApiListPage.do',
  updatedAt: new Date().toISOString(),
  meta,
  regions,
};
await writeFile('data/reb-weekly-index.json', JSON.stringify(output) + '\n');
console.log(`Collected monthly and weekly sale price index data for ${regions.length} districts; monthly through ${meta.monthly.asOf}, weekly through ${meta.weekly.asOf}.`);
