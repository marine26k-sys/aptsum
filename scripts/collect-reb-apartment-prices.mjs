import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const apiKey = process.env.REB_RONE_API_KEY;
if (!apiKey) throw new Error('REB_RONE_API_KEY is required');

const API = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const TABLES = {
  average: 'A_2024_00061',
  median: 'A_2024_00062',
};
const REGIONS = ['서울', '경기', '인천', '부산'];
const PAGE_SIZE = 1000;

async function getRows(tableId) {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total) {
    const url = new URL(API);
    for (const [key, value] of Object.entries({
      KEY: apiKey,
      Type: 'json',
      STATBL_ID: tableId,
      DTACYCLE_CD: 'MM',
      ITM_ID: '100001',
      START_WRTTIME: '201201',
      END_WRTTIME: String(new Date().getFullYear()) + '12',
      pIndex: String(page),
      pSize: String(PAGE_SIZE),
    })) url.searchParams.set(key, value);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`R-ONE request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const block = payload.SttsApiTblData;
    const head = block?.[0]?.head;
    const result = head?.find(item => item.RESULT)?.RESULT;
    if (result && result.CODE !== 'INFO-000') throw new Error(`R-ONE returned ${result.CODE}: ${result.MESSAGE}`);
    const pageRows = block?.[1]?.row;
    if (!Array.isArray(pageRows)) throw new Error(`R-ONE returned no rows for ${tableId}`);
    total = Number(head?.find(item => item.list_total_count)?.list_total_count || 0);
    rows.push(...pageRows);
    if (!pageRows.length || page >= Math.ceil(total / PAGE_SIZE)) break;
    page++;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return rows;
}

const [averageRows, medianRows] = await Promise.all(Object.values(TABLES).map(getRows));
const monthly = new Map();
function collect(rows, metric) {
  for (const row of rows) {
    const month = String(row.WRTTIME_IDTFR_ID || '');
    const region = String(row.CLS_FULLNM || row.CLS_NM || '').trim();
    const value = Number(row.DTA_VAL);
    if (!/^\d{6}$/.test(month) || !region || !Number.isFinite(value)) continue;
    const key = `${region}|${month}`;
    const record = monthly.get(key) || { region, month };
    record[metric] = value;
    record.unit = row.UI_NM || '천원';
    monthly.set(key, record);
  }
}
collect(averageRows, 'average');
collect(medianRows, 'median');

const annual = new Map();
for (const row of monthly.values()) {
  if (!Number.isFinite(row.average) || !Number.isFinite(row.median)) continue;
  const year = row.month.slice(0, 4);
  const key = `${row.region}|${year}`;
  const item = annual.get(key) || { region: row.region, year: Number(year), averageTotal: 0, medianTotal: 0, months: 0 };
  item.averageTotal += row.average;
  item.medianTotal += row.median;
  item.months++;
  annual.set(key, item);
}

const regions = {};
for (const item of annual.values()) {
  if (!REGIONS.includes(item.region)) continue;
  (regions[item.region] ||= []).push({
    year: item.year,
    average: Number((item.averageTotal / item.months).toFixed(3)),
    median: Number((item.medianTotal / item.months).toFixed(3)),
    months: item.months,
  });
}
for (const values of Object.values(regions)) values.sort((a, b) => a.year - b.year);

const monthlyRows = [...monthly.values()].filter(row => Number.isFinite(row.average) && Number.isFinite(row.median));
const asOf = monthlyRows.map(row => row.month).sort().at(-1);
if (!asOf || !Object.keys(regions).length) throw new Error('R-ONE returned no usable apartment price data');

const tileContext = { window: {} };
vm.runInNewContext(await readFile('shared/metro-tile-map.js', 'utf8'), tileContext);
const tiles = tileContext.window.APTSUM_METRO_TILE_MAP.flat();
const normalize = value => String(value).replace(/[\s>\/|·]/g, '').replace(/시(?=.+구$)/, '');
const districtMonthly = [];
for (const row of monthlyRows) {
  const path = normalize(row.region);
  const matches = tiles.filter(([, province, name]) => path.startsWith(province) && path.endsWith(normalize(name)));
  if (matches.length !== 1) continue;
  const [, province, name] = matches[0];
  districtMonthly.push({ province, name, period: row.month.slice(0,4)+'-'+row.month.slice(4), average: row.average, median: row.median });
}
if (!districtMonthly.length) throw new Error('R-ONE returned no usable district price data');
const output = {
  source: '한국부동산원 R-ONE Open API',
  sourceUrl: 'https://www.reb.or.kr/r-one/portal/stat/easyStatPage/A_2024_00062.do?isMobileYn=N',
  tables: TABLES,
  unit: '천원',
  aggregation: '월별 아파트 매매가격의 연도별 산술평균 (단위: 천원)',
  asOf: asOf.slice(0, 4) + '-' + asOf.slice(4),
  updatedAt: new Date().toISOString(),
  regions,
  districtMonthly,
};
// Never replace a newer uploaded release or publish a different price unit.
const latestResponse = await fetch('https://raw.githubusercontent.com/marine26k-sys/aptsum/refs/heads/reb-weekly-data/data/reb-apartment-prices.json?v=' + Date.now(), { cache: 'no-store' });
if (!latestResponse.ok) throw new Error('Cannot verify published price release; keeping existing data');
const published = await latestResponse.json();
const baseline = JSON.parse(await readFile('data/reb-apartment-prices.json', 'utf8'));
for (const existing of [published, baseline]) {
  if (existing.asOf > output.asOf) throw new Error(`Refusing older price release ${output.asOf}; existing release is ${existing.asOf}`);
  for (const province of REGIONS) {
    const last = existing.regions[province]?.at(-1);
    const next = output.regions[province]?.find(row => row.year === last?.year);
    if (!next || next.months < last.months) throw new Error(`Incomplete price series for ${province}`);
  }
}
for (const province of REGIONS) for (const row of output.regions[province] || []) {
  if (!(row.average > 0 && row.median > 0) || row.average / row.median < .5 || row.average / row.median > 3) {
    throw new Error(`Price unit mismatch for ${province} ${row.year}; keeping existing data`);
  }
}
const path = 'data/reb-apartment-prices.json';
let previous = '';
try { previous = await readFile(path, 'utf8'); } catch {}
const next = JSON.stringify(output);
await writeFile(path, next + '\n');
console.log(`R-ONE apartment prices: ${Object.keys(regions).length} regions, ${monthlyRows.length} monthly region points, through ${output.asOf}; ${previous === next + '\n' ? 'unchanged' : 'updated'}`);
