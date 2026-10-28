import { readFile, writeFile } from 'node:fs/promises';

const STAT_PAGE = 'https://stat.molit.go.kr/portal/cate/statView.do?hRsId=468';
const DATA_URL = 'https://stat.molit.go.kr/portal/stat/data.do';
const FORM_ID = '5373';
const REGIONS = new Set(['서울', '경기', '인천', '부산']);
const FIRST_MONTH = '201008';

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'AptsumMoveInHistory/1.0',
      'Referer': STAT_PAGE,
    },
  });
  if (!response.ok) throw new Error(`통계 자료 요청 실패 (${response.status})`);
  return response.text();
}

function monthNumber(value) {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(4, 6)) - 1;
}

function monthString(value) {
  return `${Math.floor(value / 12)}${String(value % 12 + 1).padStart(2, '0')}`;
}

const page = await fetchText(STAT_PAGE);
const option = page.match(/<option\s+value=['"]5373['"][^>]*>[^<]*\((\d{6})\s*~\s*(\d{6})\)/);
if (!option) throw new Error('국토교통부 준공 통계의 기간 정보를 찾지 못했습니다.');
const start = monthNumber(FIRST_MONTH);
const latest = monthNumber(option[2]);
if (latest < start) throw new Error('준공 실적 자료의 최신 월이 시작 월보다 이전입니다.');

const rows = [];
for (let chunkStart = start; chunkStart <= latest; chunkStart += 60) {
  const chunkEnd = Math.min(latest, chunkStart + 59);
  const params = new URLSearchParams({
    formId: FORM_ID,
    styleNum: '1',
    apprYn: 'Y',
    startDate: monthString(chunkStart),
    endDate: monthString(chunkEnd),
  });
  const data = JSON.parse(await fetchText(`${DATA_URL}?${params}`));
  if (data.result !== true || !Array.isArray(data.data)) {
    throw new Error(data.msg || '국토교통부 준공 실적 데이터를 읽지 못했습니다.');
  }
  for (const row of data.data) {
    // 국토교통부는 확정 전 실적에 `p)`를 붙입니다(예: `2026-08 p)`).
    // 잠정치도 공식 준공 실적이므로 월 정보를 정규화해 포함합니다.
    const month = row['0']?.match(/^(\d{4})-(\d{2})(?:\s*p\))?$/)?.slice(1, 3).join('');
    const region = row['1'];
    if (!/^\d{6}$/.test(month || '') || !REGIONS.has(region) || row['2'] !== '아파트') continue;
    const rawUnits = String(row['5'] ?? '').replaceAll(',', '').trim();
    const households = Number(rawUnits);
    if (!rawUnits || !Number.isFinite(households) || households < 0) continue;
    rows.push({ month: `${month.slice(0, 4)}-${month.slice(4, 6)}`, region, households });
  }
}

const unique = new Map(rows.map(row => [`${row.month}|${row.region}`, row]));
const history = [...unique.values()].sort((a, b) => a.month.localeCompare(b.month) || a.region.localeCompare(b.region, 'ko'));
const expectedMonths = latest - start + 1;
const availableMonths = new Set(history.map(row => row.month)).size;
if (!history.length || availableMonths < Math.floor(expectedMonths * 0.9)) {
  throw new Error(`월별 준공 실적이 충분히 수집되지 않아 기존 자료를 유지합니다. (${availableMonths}/${expectedMonths}개월)`);
}

const path = 'data/move-in.json';
const existing = JSON.parse(await readFile(path, 'utf8'));
const output = {
  ...existing,
  historicalSource: '국토교통부 주택건설실적통계(준공) · 주택유형별 주택건설 준공실적(월계)',
  historicalSourceUrl: STAT_PAGE,
  historicalAsOf: option[2].slice(0, 4) + '-' + option[2].slice(4, 6),
  historicalUpdatedAt: new Date().toISOString(),
  history,
};
const stable = value => JSON.stringify({ ...value, historicalUpdatedAt: undefined });
if (existing.history?.length && stable(existing) === stable(output)) {
  console.log(`과거 아파트 준공 실적 변동 없음 (${output.historicalAsOf}, ${history.length}개 월·지역)`);
} else {
  await writeFile(path, `${JSON.stringify(output)}\n`);
  console.log(`과거 아파트 준공 실적 갱신 (${output.historicalAsOf}, ${history.length}개 월·지역)`);
}
