import { readFile, writeFile } from 'node:fs/promises';

const apiKey = process.env.REB_RONE_API_KEY;
if (!apiKey) throw new Error('REB_RONE_API_KEY is required');

const API = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const TABLE_ID = 'T244183132827305';
const REGIONS = [
  { name: '서울', clsId: '50008' },
  { name: '경기', clsId: '50016' },
  { name: '인천', clsId: '50124' },
  { name: '부산', clsId: '50025' },
];
const PAGE_SIZE = 1000;

async function getRows(region) {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total) {
    const url = new URL(API);
    for (const [key, value] of Object.entries({
      KEY: apiKey,
      Type: 'json',
      STATBL_ID: TABLE_ID,
      DTACYCLE_CD: 'WK',
      ITM_ID: '10001',
      CLS_ID: region.clsId,
      pIndex: String(page),
      pSize: String(PAGE_SIZE),
    })) url.searchParams.set(key, value);
    let response;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (response.ok || response.status < 500) break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, attempt * 1200));
    }
    if (!response.ok) throw new Error(`R-ONE request failed: HTTP ${response.status}`);
    const payload = await response.json();
    const block = payload.SttsApiTblData;
    const head = block?.[0]?.head;
    const result = head?.find(item => item.RESULT)?.RESULT;
    if (result && result.CODE !== 'INFO-000') throw new Error(`R-ONE returned ${result.CODE}: ${result.MESSAGE}`);
    const pageRows = block?.[1]?.row;
    if (!Array.isArray(pageRows)) throw new Error(`R-ONE returned no rows for ${region.name}`);
    total = Number(head?.find(item => item.list_total_count)?.list_total_count || 0);
    rows.push(...pageRows);
    if (!pageRows.length || page >= Math.ceil(total / PAGE_SIZE)) break;
    page++;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return rows;
}

const collected = await Promise.all(REGIONS.map(async region => ({ region: region.name, rows: await getRows(region) })));
const regions = {};
for (const { region, rows } of collected) {
  regions[region] = rows.map(row => ({
    week: String(row.WRTTIME_IDTFR_ID || ''),
    date: String(row.WRTTIME_DESC || ''),
    index: Number(row.DTA_VAL),
  })).filter(row => /^\d{6}$/.test(row.week) && Number.isFinite(row.index))
    .sort((a, b) => a.week.localeCompare(b.week));
  if (!regions[region].length) throw new Error(`No usable weekly index data for ${region}`);
}
const asOf = Object.values(regions).flat().map(row => row.date).filter(Boolean).sort().at(-1);
const output = {
  source: '한국부동산원 R-ONE 주간 아파트 매매가격지수',
  sourceUrl: 'https://www.reb.or.kr/r-one/portal/openapi/openApiListPage.do',
  tableId: TABLE_ID,
  cycle: 'WK',
  unit: '2021.06.28=100',
  updatedAt: new Date().toISOString(),
  asOf,
  regions,
};
const path = 'data/reb-weekly-index.json';
let previous = '';
try { previous = await readFile(path, 'utf8'); } catch {}
const next = JSON.stringify(output);
await writeFile(path, next + '\n');
const count = Object.values(regions).reduce((sum, rows) => sum + rows.length, 0);
console.log(`R-ONE weekly apartment sale index: ${count} points across ${Object.keys(regions).length} regions through ${asOf}; ${previous === next + '\n' ? 'unchanged' : 'updated'}`);
