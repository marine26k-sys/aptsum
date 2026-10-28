import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DATASET_URL = 'https://www.data.go.kr/data/15111714/fileData.do';
const DOWNLOAD_BASE = 'https://www.data.go.kr/cmm/cmm/fileDownload.do';
const INCLUDED_REGIONS = new Set(['서울', '경기', '인천', '부산']);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); if (row.some(value => value !== '')) rows.push(row); }
  return rows;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'AptsumMoveInData/1.0' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return response.text();
}

const page = (await fetchText(DATASET_URL)).replaceAll('&amp;', '&');
const datasetDate = page.match(/한국부동산원_주택공급정보_입주예정물량정보[_ ](\d{8})/)?.[1];
const fileMatch = page.match(/atchFileId=(FILE_[^&"'\s]+)&fileDetailSn=(\d+)/);
if (!datasetDate || !fileMatch) throw new Error('공공데이터포털의 최신 CSV 파일 정보를 찾지 못했습니다.');

const csvUrl = `${DOWNLOAD_BASE}?atchFileId=${encodeURIComponent(fileMatch[1])}&fileDetailSn=${fileMatch[2]}&insertDataPrcus=N`;
const csv = await fetchText(csvUrl);
if (!csv.includes('입주예정월') || !csv.includes('아파트명')) throw new Error('다운로드 자료가 예상한 입주예정물량 CSV 형식이 아닙니다.');
const [headers, ...records] = parseCsv(csv.replace(/^\uFEFF/, ''));
const col = name => headers.indexOf(name);
for (const name of ['입주예정월', '지역', '사업유형', '주소', '아파트명', '세대수']) {
  if (col(name) < 0) throw new Error(`필수 CSV 컬럼이 없습니다: ${name}`);
}

const items = records.map(row => {
  const plannedMonth = row[col('입주예정월')]?.trim() || '';
  const households = Number(String(row[col('세대수')] || '').replaceAll(',', '').trim());
  return {
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(plannedMonth) ? plannedMonth : null,
    region: row[col('지역')]?.trim() || '',
    type: row[col('사업유형')]?.trim() || '',
    address: row[col('주소')]?.trim() || '',
    name: row[col('아파트명')]?.trim() || '',
    households,
  };
}).filter(item => item.month && INCLUDED_REGIONS.has(item.region) && item.name && Number.isFinite(item.households) && item.households >= 30)
  .sort((a, b) => (a.month || '9999-99').localeCompare(b.month || '9999-99') || a.region.localeCompare(b.region, 'ko') || a.name.localeCompare(b.name, 'ko'));

if (!items.length) throw new Error('서울·경기·인천·부산 자료가 비어 있어 기존 파일을 유지합니다.');
const path = 'data/move-in.json';
let previous;
try { previous = JSON.parse(await readFile(path, 'utf8')); } catch {}
const output = {
  source: '한국부동산원·부동산R114 공동주택 입주예정물량',
  sourceUrl: DATASET_URL,
  sourceAsOf: `${datasetDate.slice(0, 4)}-${datasetDate.slice(4, 6)}-${datasetDate.slice(6, 8)}`,
  updatedAt: new Date().toISOString(),
  householdMinimum: 30,
  regions: [...INCLUDED_REGIONS],
  historicalSource: previous?.historicalSource || '국토교통부 주택건설실적통계(준공) · 주택유형별 주택건설 준공실적(월계)',
  historicalSourceUrl: previous?.historicalSourceUrl || 'https://stat.molit.go.kr/portal/cate/statView.do?hRsId=468',
  historicalAsOf: previous?.historicalAsOf || null,
  history: previous?.history || [],
  items,
};

await mkdir('data', { recursive: true });
const stable = value => JSON.stringify({ ...value, updatedAt: undefined });
if (previous && stable(previous) === stable(output)) {
  console.log(`입주물량 변동 없음 (${output.sourceAsOf}, ${items.length}개 단지)`);
} else {
  await writeFile(path, `${JSON.stringify(output)}\n`);
  console.log(`입주물량 갱신 (${output.sourceAsOf}, ${items.length}개 단지)`);
}
