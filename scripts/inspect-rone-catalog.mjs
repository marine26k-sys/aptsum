const key = process.env.REB_RONE_API_KEY;
if (!key) throw new Error('REB_RONE_API_KEY is required');

const endpoint = new URL('https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do');
for (const [name, value] of Object.entries({ KEY: key, Type: 'json', pIndex: '1', pSize: '1000' })) {
  endpoint.searchParams.set(name, value);
}
const response = await fetch(endpoint);
if (!response.ok) throw new Error(`R-ONE catalog request failed: HTTP ${response.status}`);
const payload = await response.json();
const catalog = payload.SttsApiTbl?.[1]?.row;
if (!Array.isArray(catalog)) throw new Error(JSON.stringify(payload.RESULT || payload).slice(0, 500));
const relevant = catalog.filter(({ STATBL_NM = '' }) => /아파트|주택|입주|공급|준공|분양/.test(STATBL_NM));
await import('node:fs/promises').then(({ writeFile }) => writeFile('/tmp/rone-catalog.json', JSON.stringify(relevant, null, 2)));
console.log(`Catalog rows: ${catalog.length}; housing-related: ${relevant.length}`);
for (const row of relevant) console.log(`${row.STATBL_ID}\t${row.DTACYCLE_NM}\t${row.DATA_START_YY}~${row.DATA_END_YY}\t${row.STATBL_NM}`);
