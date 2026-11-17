import { readFile, writeFile } from 'node:fs/promises';

const apiKey = process.env.REB_RONE_API_KEY;
if (!apiKey) throw new Error('REB_RONE_API_KEY is required');

const API = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const TABLE_ID = 'T247223131886356';
const ITEM_ID = '10001';
const GROUPS = [
  { id: '60001', name: '전국' },
  { id: '60004', name: '서울' },
  { id: '60002', name: '수도권' },
  { id: '60003', name: '지방' },
];
const SIZES = [
  { id: '50001', name: '초소형' },
  { id: '50002', name: '소형' },
  { id: '50003', name: '중소형' },
  { id: '50004', name: '중대형' },
  { id: '50005', name: '대형' },
];
const PAGE_SIZE = 1000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJson(url) {
  let error;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`R-ONE request failed: HTTP ${response.status}`);
      return await response.json();
    } catch (caught) {
      error = caught;
      if (attempt < 4) await pause(attempt * 1000);
    }
  }
  throw error;
}

async function getRows(group) {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total) {
    const url = new URL(API);
    for (const [key, value] of Object.entries({
      KEY: apiKey,
      Type: 'json',
      STATBL_ID: TABLE_ID,
      DTACYCLE_CD: 'MM',
      ITM_ID: ITEM_ID,
      GRP_ID: group.id,
      pIndex: String(page),
      pSize: String(PAGE_SIZE),
    })) url.searchParams.set(key, value);

    const payload = await fetchJson(url);
    const block = payload.SttsApiTblData;
    const head = block?.[0]?.head;
    const result = head?.find(item => item.RESULT)?.RESULT;
    if (result && result.CODE !== 'INFO-000') throw new Error(`R-ONE ${group.name}: ${result.CODE} ${result.MESSAGE}`);
    const pageRows = block?.[1]?.row;
    if (!Array.isArray(pageRows)) throw new Error(`R-ONE returned no rows for ${group.name}`);
    total = Number(head?.find(item => item.list_total_count)?.list_total_count || 0);
    rows.push(...pageRows);
    if (!pageRows.length || page >= Math.ceil(total / PAGE_SIZE)) break;
    page++;
    await pause(150);
  }
  return rows;
}

const groups = [];
for (const group of GROUPS) {
  const rows = await getRows(group);
  const bySize = new Map(SIZES.map(size => [size.id, { id: size.id, name: size.name, values: [] }]));
  for (const row of rows) {
    const size = bySize.get(String(row.CLS_ID));
    const period = String(row.WRTTIME_IDTFR_ID || '');
    const value = Number(row.DTA_VAL);
    if (!size || !/^\d{6}$/.test(period) || !Number.isFinite(value) || value <= 0) continue;
    size.values.push({ period: `${period.slice(0, 4)}-${period.slice(4)}`, value: Number(value.toFixed(2)) });
  }
  for (const size of bySize.values()) {
    size.values.sort((a, b) => a.period.localeCompare(b.period));
    if (!size.values.length) throw new Error(`Missing ${group.name} ${size.name} price series`);
  }
  groups.push({ id: group.id, name: group.name, sizes: [...bySize.values()] });
}

const allPeriods = groups.flatMap(group => group.sizes.flatMap(size => size.values.map(row => row.period))).sort();
const asOf = allPeriods.at(-1);
if (!asOf || groups.length !== GROUPS.length) throw new Error('R-ONE returned no usable size-specific apartment sale prices');
for (const group of groups) {
  for (const size of group.sizes) {
    if (size.values.at(-1)?.period !== asOf) throw new Error(`Incomplete latest period for ${group.name} ${size.name}`);
  }
}

const output = {
  source: '한국부동산원 R-ONE 공동주택 실거래가격지수 통계',
  sourceUrl: `https://www.reb.or.kr/r-one/portal/stat/easyStatPage/${TABLE_ID}.do?isMobileYn=N`,
  tableId: TABLE_ID,
  unit: '만원/㎡',
  aggregation: '아파트 규모별 매매 실거래 평균 단위면적 가격',
  asOf,
  updatedAt: new Date().toISOString(),
  groups,
};

const path = 'data/reb-apartment-size-prices.json';
let previous = null;
try { previous = JSON.parse(await readFile(path, 'utf8')); } catch {}
const publishedResponse = await fetch(`https://raw.githubusercontent.com/marine26k-sys/aptsum/refs/heads/reb-weekly-data/${path}?v=${Date.now()}`, { cache: 'no-store' });
if (publishedResponse.ok) {
  const published = await publishedResponse.json();
  previous = [previous, published].filter(Boolean).sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))[0];
} else if (publishedResponse.status !== 404) {
  throw new Error(`Cannot verify published size-price release; keeping existing data (HTTP ${publishedResponse.status})`);
}
if (previous?.asOf > output.asOf) throw new Error(`Refusing older size-price release ${output.asOf}; existing release is ${previous.asOf}`);
for (const group of previous?.groups || []) for (const size of group.sizes || []) {
  const nextGroup = output.groups.find(item => item.name === group.name);
  const nextSize = nextGroup?.sizes.find(item => item.id === size.id);
  if (!nextSize || nextSize.values.at(-1)?.period < size.values?.at(-1)?.period) {
    throw new Error(`Incomplete size-price series for ${group.name} ${size.name}; keeping existing data`);
  }
}
await writeFile(path, JSON.stringify(output) + '\n');
console.log(`R-ONE size-specific apartment prices: ${groups.length} groups, ${SIZES.length} size classes each, through ${output.asOf}`);
