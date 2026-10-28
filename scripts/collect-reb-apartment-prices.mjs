import { readFile, writeFile } from 'node:fs/promises';

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
      START_WRTTIME: '2012',
      END_WRTTIME: String(new Date().getFullYear()),
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

const output = {
  source: '한국부동산원 R-ONE Open API',
  sourceUrl: 'https://www.reb.or.kr/r-one/portal/stat/easyStatPage/A_2024_00062.do?isMobileYn=N',
  tables: TABLES,
  unit: '천원',
  aggregation: '월별 아파트 매매가격의 연도별 산술평균 (단위: 천원)',
  asOf: asOf.slice(0, 4) + '-' + asOf.slice(4),
  updatedAt: new Date().toISOString(),
  regions,
};
const path = 'data/reb-apartment-prices.json';
let previous = '';
try { previous = await readFile(path, 'utf8'); } catch {}
const next = JSON.stringify(output);
await writeFile(path, next + '\n');
console.log(`R-ONE apartment prices: ${Object.keys(regions).length} regions, ${monthlyRows.length} monthly region points, through ${output.asOf}; ${previous === next + '\n' ? 'unchanged' : 'updated'}`);
