// Netlify Function — 국토교통부 공동주택 단지목록/기본정보 API로 세대수 조회
// 매매·분양권 실거래 API(analyze.mjs/presale.mjs)와는 완전히 다른 별도 API 군(둘 다 JSON 응답):
//   1) AptListService4/getSigunguAptList4: 시군구코드 → 그 구에 등록된 단지의 kaptCode 목록
//   2) AptBasisInfoServiceV5/getAphusBassInfoV5: kaptCode → 세대수(kaptdaCnt)·동수·사용승인일 등
// (2026.07 data.go.kr 활용신청 승인 스펙 기준으로 V2/V3→V3/V4 갱신, XML→JSON 전환)
// (2026.08 V3/V4→V4/V5 재갱신 — 수민의 구버전 승인이 만료되고 같은 날 새 버전으로 재승인된 것을
// collect-hhcnt.mjs 배치가 전 지역 0건으로 실패하면서 발견함. 파라미터명·응답 필드명은 이전 버전과
// 동일할 것으로 추정되나 실전 검증 전 — 매칭 실패가 갑자기 늘면 여기부터 의심할 것)
// K-apt(공동주택관리정보시스템) 가입 단지만 나오므로, 여기 없는 단지는 세대수를 못 찾을 수 있음
// (의무관리대상 미달 소규모 단지 등) — 매칭 실패 시 조용히 세대수만 비워서 반환, 나머지 분석엔 영향 없음
// 환경변수: DATA_GO_KR_KEY(필수, analyze.mjs·presale.mjs와 공용)

export const config = {
  path: "/api/hhcnt",
};

const LIST_URL = "https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4";
const BASIS_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5";
// 지하철호선/도보시간은 getAphusBassInfoV5(기본정보)가 아니라 getAphusDtlInfoV5(상세정보)에만 있음
// (2026.08 확인 — 두 API가 같은 kaptCode를 받지만 응답 필드가 서로 다름, 별도 호출 필요)
const DTL_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusDtlInfoV5";

// analyze.mjs의 SPLIT_REGIONS와 동일한 신규 구코드 매핑(목록조회는 단일 코드만 필요하므로 신규코드 우선,
// 화성·부천은 통합 폐지코드로 폴백 — K-apt 등록정보가 아직 옛 구코드에 남아있을 수 있어서)
const SPLIT_FALLBACK = {
  "HS-": { codes: { "동탄구": "41597", "만세구": "41591", "병점구": "41595", "효행구": "41593" }, old: "41590" },
  "BC-": { codes: { "원미구": "41192", "소사구": "41194", "오정구": "41196" }, old: "41190" },
  // 인천은 옛 구를 쪼개거나 합치는 비대칭 구조라 단일 폴백 코드가 없음 — 신규코드만 시도
  "IC-": { codes: { "제물포구": "28125", "영종구": "28155", "서해구": "28275", "검단구": "28290" }, old: null },
};

// ── 자동 매칭 수동 보정 목록 ──
// "한신"처럼 이름이 짧으면 matchKapt()가 K-apt에 등록된 동명의 다른(대개 더 작은) 단지와 계속 충돌해
// 엉뚱한 세대수·지하철 정보를 돌려주는 경우가 있다. 이런 케이스는 자동 매칭 로직을 아예 우회하고
// 확인된 값을 고정 반환한다 — 정적 배치·라이브 조회 둘 다보다 먼저 확인.
// key: `${lawd}|${검색어 공백 제거}`
// (2026.08 도봉동 한신 — 실거래 단지명 "한신"이 짧아 도봉구 내 동명 소규모 단지와 충돌, 202세대·4호선
// 쌍문역으로 잘못 매칭되고 있었음. 실제로는 2,678세대, 1997년 준공, 1호선·7호선 도봉산역 도보 10분권.)
const MANUAL_OVERRIDE = {
  "11320|한신": { hhcnt: 2678, dongCnt: null, useDate: null, subwayLines: ["1호선", "7호선"], subwayWalk: "10분이내", subwayStation: "도봉산" },
};
function checkOverride(lawd, name) {
  return MANUAL_OVERRIDE[`${lawd}|${name.replace(/\s/g, "")}`] || null;
}
// 위 MANUAL_OVERRIDE는 "전체" 보정(자동 매칭 자체를 생략)용이고, 이건 "부분" 보정 —
// 자동 매칭은 그대로 실행하되(지하철 등 나머지 필드는 정상적으로 채워지므로), 특정 필드만 확인된 값으로
// 덮어쓴다. 세대수만 틀리고 지하철 등 나머지는 맞는 경우(전체 override로 처리하면 그 값들을 다시
// 수동으로 채워야 하는 번거로움) 이쪽을 쓴다.
// (2026.08 봉천동 두산 — 실거래 단지명 "두산"이 K-apt의 "두산1,2단지"(분양, 2,001세대)와 "두산3단지"
// (임대, 560세대) 두 후보와 겹치는데, matchKapt()의 "형제 단지 합산" 감지가 "1,2단지"(5자)까지는 못 잡고
// "3단지"(3자)만 잡아 후보가 1개뿐이라 합산 조건(siblings.length>1)을 못 만족 → 이름 길이가 검색어에
// 더 가까운(짧은) "두산3단지"(임대)로 잘못 채택되고 있었음.
// matchKapt의 임대 배제 필터는 후보명에 "임대"라는 글자가 실제로 들어있어야 걸리는데, K-apt엔
// "두산3단지"처럼 임대 여부가 이름에 안 드러나는 경우가 있어 이 사례는 못 걸러냄 — 이름만으로 분양/임대를
// 구분하는 건 근본적으로 한계가 있어(오매칭될 때마다 다른 임대단지명 패턴일 수 있음) 형제단지 정규식을
// 넓히는 대신(그러면 임대까지 합산돼 2,561세대로 오히려 더 틀어짐) 이 단지는 확인된 값으로 직접 고정한다.)
const PARTIAL_OVERRIDE = {
  "11620|두산": { hhcnt: 2001 },
  // 안양 동안구 평촌목련2단지아파트 — 세대수(994) 매칭 자체는 정상인데, K-apt 원본 subwayLine 필드에
  // "4호선,경춘선"으로 경춘선이 잘못 들어가 있음(안양은 경춘선과 지리적으로 무관 — 원천 데이터 오기입으로 보임).
  // 실제로는 범계역 4호선 초역세권. data/hhcnt 정적 배치·지하철 검색 탭 양쪽 다 이 값을 그대로 읽으므로
  // 두 군데 모두 보정 필요(지하철 검색 탭은 index.html의 SUBWAY_LINE_FIX 참고, 2026.08).
  "41173|평촌목련2단지아파트": { subwayLines: ["4호선"] },
  // 안양 동안구 한가람한양6차 — 관양동, 다른 "한가람" 계열 단지들과 동일하게 4호선 권역인데 K-apt 원본에
  // "의정부경전철"이 잘못 섞여 있음(의정부시 소재 노선이라 안양과 지리적으로 완전히 무관). 위 평촌목련2단지와
  // 동일한 유형의 원천 데이터 오기입 — SUBWAY_LINE_FIX에도 동일하게 반영(2026.08).
  "41173|한가람한양6차": { subwayLines: ["4호선"] },
  // 안양 동안구 호계동 목련단지 — 실거래는 "목련우성5"/"목련우성7"처럼 [단지명+건설사+동번호] 순서인데
  // K-apt는 "목련5단지우성"/"목련7단지우성"처럼 [단지명+번호+건설사] 순서라 토큰 순서가 달라 matchKapt()의
  // 단순 포함(includes) 비교로도, naverLookup()의 접두/접미 비교로도 못 잡는다(2026.09, 수민 리포트 —
  // 네이버 보정 도입 후 "목련우성5"가 전혀 다른 단지 "목련"(관양동, 48세대)에 잘못 걸렸던 게 발단, 원인은
  // naverLookup의 후보명 길이 하한이 2자였던 별개 버그였지만 겸사겸사 이 단지도 K-apt 확정값으로 고정).
  // data/hhcnt/41173.json의 "목련5단지우성"(683세대)·"목련7단지우성"(466세대)을 그대로 사용.
  "41173|목련우성5": { hhcnt: 683 },
  "41173|목련우성7": { hhcnt: 466 },
};
function applyPartialOverride(lawd, name, result) {
  const ov = PARTIAL_OVERRIDE[`${lawd}|${name.replace(/\s/g, "")}`];
  if (!ov) return result;
  const base = (result && result.found) ? result : { found: true, name };
  return { ...base, ...ov, found: true, name };
}

// ── 네이버 세대수 보강(2026.09) ──
// K-apt(data/hhcnt)는 의무관리대상 공동주택만 있어 소규모 단지가 빠지고, 단지명도 "신당남산타운(분양)"처럼
// 관리용 표기라 실거래명과 잘 안 맞는다. 그 결과 matchKapt()가 "한신"을 202세대, "두산"을 560세대 임대동에
// 붙이는 오매칭이 있었고(아래 MANUAL/PARTIAL_OVERRIDE가 그걸 손으로 막아둔 것), 연 회전율이 20%를 넘는
// 비현실적 매칭이 35건 더 있었다.
// data/hhcnt-naver/<lawd>.json(scripts/build-hhcnt-naver.mjs 생성)이 있으면 그 세대수로 덮어쓴다.
// **세대수만** 덮는다 — 지하철 노선·도보시간은 네이버 데이터에 없어서, K-apt 결과를 지우면 그 정보가 통째로
// 사라진다. 그래서 기존 조회는 그대로 다 돌린 뒤 마지막에 hhcnt 값만 교체하는 순서로 붙였다.
// 구 단위 매칭인 이유: /api/hhcnt가 동(umd)을 안 받는다. 동까지 쓰면 59.5%, 구만 쓰면 58.0%로 1.5%p
// 차이뿐이라(서울 12개월 실거래 기준) API·클라이언트를 안 건드리는 쪽을 택했다. 구 안에서 이름이 겹치고
// 세대수가 서로 다른 단지는 빌드 단계에서 아예 제외돼 K-apt 결과가 그대로 남는다.
const naverCache = new Map(); // lawd -> {items, keyIndex} | null — 컨테이너 warm 재사용 동안만
async function loadNaverHh(origin, lawd) {
  if (naverCache.has(lawd)) return naverCache.get(lawd);
  let data = null;
  try {
    const r = await fetch(`${origin}/data/hhcnt-naver/${encodeURIComponent(lawd)}.json`);
    if (r.ok) {
      const j = await r.json();
      if (j && j.items) data = { items: j.items, keyIndex: j.keyIndex || {} };
    }
  } catch (e) { data = null; } // 파일 없음(서울 외 지역 등)은 정상 — 조용히 K-apt만 씀
  naverCache.set(lawd, data);
  return data;
}
// shared/name-match.mjs의 nameKey와 같은 규칙(Netlify 함수는 번들이 분리돼 import를 못 하므로 사본).
// 규칙을 바꿀 땐 두 곳을 같이 고칠 것.
const NV_ALIAS = [
  [/에스케이뷰/g, "SKVIEW"], [/SK뷰/g, "SKVIEW"],
  [/에스케이/g, "SK"], [/엘지/g, "LG"], [/지에스/g, "GS"],
  [/케이씨씨/g, "KCC"], [/케이티/g, "KT"],
  [/이편한세상/g, "E편한세상"],
  [/써미트/g, "SUMMIT"], [/써밋/g, "SUMMIT"],
  [/뷰/g, "VIEW"],
];
function nvKey(s) {
  let x = String(s || "").replace(/\s/g, "").replace(/[()（）,.\-_·・'"]/g, "");
  x = x.replace(/(임대|분양)$/, "").replace(/아파트$/, "").replace(/아파트(?=\d)/g, "");
  // shared/name-match.mjs의 nameKey()와 동일 규칙(두 곳 다 고칠 것) — "향촌마을현대4차"(실거래) ↔
  // "향촌현대4차"(네이버)처럼 1기 신도시 하위 동네명 "마을"이 중간에 있다 없다 하는 경우를 지우고 비교(2026.09).
  x = x.replace(/마을/g, "");
  // "우성4"(실거래) ↔ "우성4차"(네이버)처럼 숫자+차/단지 접미사가 있다 없다 하는 경우도 지우고 비교.
  // "차"와 "단지"가 실제로 다른 동을 가리키는 단지도 있어(현대6차 178세대 vs 현대6단지 421세대 등) —
  // 그런 경우는 build-hhcnt-naver.mjs가 keyIndex를 null로 막고 아래 폴백 스캔도 세대수 불일치 시
  // 포기하도록 이미 돼 있어 자동으로 안전하게 보류된다(nameKey() 주석 참고).
  x = x.replace(/(\d+)(차|단지)$/, "$1");
  x = x.toUpperCase();
  for (const [re, to] of NV_ALIAS) x = x.replace(re, to);
  return x;
}
// 2026.09 — "목련아파트"(호계동, 1994년 준공)가 "아파트" 접미사 제거만으로 키가 "목련"(2자)이 되면서
// 전혀 다른 "목련"(관양동, 48세대, 1979년 준공)에 정확 일치로 잘못 걸렸던 걸 계기로, keyIndex 정확 매칭이
// "현대"·"삼성" 같은 흔한 2자 이름에서 얼마나 위험한지 실거래 준공년도로 전수 검증했다(같은 구 안에서
// 네이버 built 연도와 실거래 등록 연식을 대조). 결과: 짧은 키 144건 중 131건은 연식이 맞아떨어지는
// 정상 매칭이었고, 명백히 틀린 건 13건뿐이었다. 그래서 "짧은 키는 무조건 불신"하는 일반 규칙 대신(그러면
// 정상 매칭 131건까지 같이 잃음), 연식이 실제로 어긋난다고 확인된 이 13건만 콕 집어 네이버 조회를
// 건너뛰게 막는다 — 나머지는 기존 K-apt 자동 매칭(대개 found:false였던 것들)으로 조용히 폴백된다.
const NAVER_DENY = new Set([
  "11260|백운아파트", "11350|건영아파트", "11380|현대아파트", "11590|대림아파트",
  "11650|현대아파트", "11680|한솔마을", "11710|한양아파트", "26200|봉래",
  "28177|행복", "28177|우성아파트", "28177|삼원아파트", "41173|목련아파트",
  "BC-원미구|금강",
  // 화성 동탄 여울동 "동탄역롯데캐슬"(940세대, 2021년 준공)이 접두어 매칭으로 청계동의 전혀 다른 단지
  // "동탄역롯데캐슬알바트로스"(1,416세대, 2015년 준공, 용적률 189%)에 걸려 용적률이 틀리게 표시되던 문제
  // (2026.09, 수민 리포트 — 실제로는 486%). 여울동 단지는 이번 네이버 크롤링에 아예 없어서(수집 누락으로
  // 추정) 세대수는 K-apt 자동 매칭(940세대, matchKapt의 "이름 길이가 가까운 후보 우선" 로직으로 이미
  // 정상적으로 여울동 쪽을 채택함)으로 폴백되고, 용적률만 표시가 안 되는 상태가 됨 — 틀린 값보다는 낫다.
  "HS-동탄구|동탄역롯데캐슬",
]);
function naverLookup(nv, lawd, name) {
  if (!nv) return null;
  const n = String(name || "").replace(/\s/g, "");
  if (NAVER_DENY.has(`${lawd}|${n}`)) return null;
  if (nv.items[n]) return nv.items[n];
  const k = nvKey(n);
  const viaKey = nv.keyIndex[k];
  if (viaKey && nv.items[viaKey]) return nv.items[viaKey];
  // 접두/접미 관계만 인정(부분 포함은 오매칭이 많아 불허) + 후보가 유일할 때만 채택.
  // 짧은 이름(3자 이하)은 접미만 인정 — shared/name-match.mjs와 같은 규칙이다.
  // "한신"→"도봉한신"처럼 앞에 동네명이 붙는 건 같은 단지지만, "신금호"→"신금호파크자이"처럼
  // 뒤에 더 붙는 건 대개 다른 단지다.
  if (k.length < 2) return null;
  const shortName = k.length <= 3;
  let hit = null;
  for (const key of Object.keys(nv.items)) {
    const kk = nvKey(key);
    // 2026.09 버그 수정 — 후보명이 2자면(예: "목련") 그 자체가 흔한 접두어라 "목련우성5"(호계동, 683세대)
    // 같은 전혀 다른 단지(관양동 "목련", 48세대)의 접두 관계로 잘못 걸림. shared/name-match.mjs의
    // resolveComplexNames()는 후보 쪽에 이미 h.k.length>=3 조건을 걸어두는데 여기만 <2로 느슨했던 것 —
    // 두 곳을 맞춰 후보명도 3자 이상만 인정.
    if (kk.length < 3) continue;
    const ok = shortName ? kk.endsWith(k)
      : (kk.endsWith(k) || k.endsWith(kk) || kk.startsWith(k) || k.startsWith(kk));
    if (!ok) continue;
    if (hit && hit.hh !== nv.items[key].hh) return null; // 세대수가 다른 후보 둘 → 포기
    hit = nv.items[key];
  }
  return hit;
}
function applyNaver(nv, lawd, name, result) {
  const hit = naverLookup(nv, lawd, name);
  if (!hit) return result;
  const base = (result && result.found) ? result : { found: true, name };
  // far(용적률)는 K-apt 쪽엔 없는 필드라 지울 게 없음 — hit에 있을 때만 얹는다(없으면 기존 base 유지, undefined로 덮어써 지우지 않도록).
  return { ...base, found: true, name, hhcnt: hit.hh, ...(hit.far != null ? { far: hit.far } : {}) };
}

function resolveSigungu(lawd) {
  if (/^\d{5}$/.test(lawd)) return [lawd];
  const prefix = Object.keys(SPLIT_FALLBACK).find((p) => lawd.startsWith(p));
  if (!prefix) return [];
  const cfg = SPLIT_FALLBACK[prefix];
  const code = cfg.codes[lawd.slice(prefix.length)];
  if (!code) return [];
  return cfg.old ? [code, cfg.old] : [code];
}

// data.go.kr 표준 JSON 포맷: { response: { header:{resultCode,resultMsg}, body:{ items:{item:[...]}|{item:{...}}|"" , totalCount } } }
// 결과가 0건일 때 items가 빈 문자열("")로 오는 경우가 있어(빈 객체가 아님) 그 경우도 안전하게 []로 처리
function extractItems(json) {
  const body = json && json.response && json.response.body;
  if (!body) return null; // header/body 구조 자체가 없으면 파싱 실패로 취급(에러 응답일 가능성)
  // getAphusBassInfoV4는 body.item(단수, 객체 하나)을 쓰고, getSigunguAptList3는 body.items(배열)를 씀 — 둘 다 지원
  if (body.item && !body.items) return [body.item];
  const items = body.items;
  if (!items) return [];
  if (typeof items === "string") return []; // items:"" (결과 없음)
  if (Array.isArray(items)) return items; // V3/V4: items가 배열 그대로 옴(구버전 items:{item:[...]}와 다름)
  const item = items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function fetchList(key, sgg) {
  try {
    const r = await fetch(`${LIST_URL}?serviceKey=${encodeURIComponent(key)}&sigunguCode=${sgg}&pageNo=1&numOfRows=1000&_type=json`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error(`[hhcnt] getSigunguAptList3(${sgg}) JSON 파싱 실패. 응답 앞부분:`, text.slice(0, 500));
      return [];
    }
    const header = json && json.response && json.response.header;
    const rawItems = extractItems(json);
    // 임시 디버그: 결과가 비어있으면(정상 빈 목록인지, header에 에러가 실려있는지 구분 안 되므로) 무조건 원문 남김
    if (!rawItems || !rawItems.length) {
      console.error(`[hhcnt] getSigunguAptList3(${sgg}) 빈 결과. HTTP ${r.status}, header:`, JSON.stringify(header), "응답 앞부분:", text.slice(0, 500));
      return [];
    }
    const items = rawItems
      .map((it) => ({ kaptCode: it.kaptCode || it.kaptcode || "", kaptName: it.kaptName || it.kaptname || "" }))
      .filter((it) => it.kaptCode && it.kaptName);
    if (!items.length) {
      // 아이템은 왔는데 필드명이 예상(kaptCode/kaptName)과 다른 경우 — 실제 필드명을 로그로 확인
      console.error(`[hhcnt] getSigunguAptList3(${sgg}) 필드명 불일치. 첫 항목:`, JSON.stringify(rawItems[0]).slice(0, 300));
    }
    return items;
  } catch (e) {
    console.error(`[hhcnt] getSigunguAptList3(${sgg}) fetch 실패:`, e.message);
    return [];
  }
}

// analyzeComplex의 matchComplex와 동일한 방식(정확 일치 → 부분 포함)으로 단지명 매칭.
// 반환값은 "합산해야 할 후보들의 배열" — 대개 1개뿐이지만, 실거래 데이터의 단지명은 "두산"처럼
// 포괄적인데 K-apt엔 "두산1차"/"두산2차"처럼 블록을 나눠 따로 등록된 경우(예: 봉천동 두산아파트 —
// 실거래상 한 단지로 묶여 거래되는데 세대수는 그중 한 블록만 잡혀 실제보다 훨씬 작게 나오는 문제가 있었음),
// 후보 중 하나만 골라 반환하면 세대수가 부당하게 작게 나온다. 검색어로 시작하고 남는 꼬리가 짧으면서
// 숫자를 포함하는("1차","2단지" 등) "형제 단지" 패턴이 여럿 감지되면 전부 합산 대상으로 반환한다(2026.08).
function matchKapt(list, name) {
  const qn = name.replace(/\s/g, "");
  // v108에서 "임대 후보 배제"를 부분일치(cand) 단계에만 넣었었는데, 정확 일치(exact)가 먼저 return돼버려서
  // 정확히 일치하는 이름이 하필 임대 동일 때(예: 두산3단지가 K-apt에 정확히 "두산"으로 등록돼 있고,
  // 매매 대상인 1·2단지는 "두산1,2단지"처럼 다른 이름으로 등록돼 있는 경우) v108 수정이 전혀 적용되지
  // 않는 문제가 있었다 — 정확/부분일치를 가리지 않고 후보를 다 모은 뒤 임대부터 배제하고,
  // 그 다음에 정확 일치를 우선하도록 순서를 바꿈.
  let cand = list.filter((a) => {
    const an = a.kaptName.replace(/\s/g, "");
    return an && (an === qn || an.includes(qn) || qn.includes(an));
  });
  if (!cand.length) return [];
  // 디버그: 후보가 2개 이상(이름이 겹치는 단지가 여러 개)이면, 실제 K-apt 등록 이름이 어떻게 돼 있는지
  // 매칭 로직을 또 고칠 일이 생길 때 바로 확인할 수 있게 로그로 남겨둔다(Netlify 함수 로그에서 확인 가능).
  if (cand.length > 1) {
    console.error(`[hhcnt] "${name}" 매칭 후보 ${cand.length}건:`, JSON.stringify(cand.map((a) => a.kaptName)));
  }
  // 매매 실거래(analyze.mjs)에서 나온 단지명을 세대수와 매칭하는 함수이므로, 후보 중 임대 세대만
  // 있는 단지(예: "두산3단지"가 임대, "두산1,2단지"가 일반분양인 봉천 두산아파트처럼 같은 이름을 쓰는
  // 임대·분양 혼재 단지)는 배제한다 — 임대 세대는 애초에 매매로 거래될 수 없어, 여기 온 이름은
  // 사실상 항상 분양 동 쪽을 가리킨다. 단, 후보가 임대 표기뿐이면(진짜 임대 단지를 조회한 경우) 그대로 둔다.
  const nonRental = cand.filter((a) => !a.kaptName.includes("임대"));
  if (nonRental.length) cand = nonRental;
  // 임대 배제 이후에도 정확히 이름이 같은 후보가 있으면 그걸 우선 채택(기존 "정확 일치 우선" 취지 유지)
  const exact = cand.filter((a) => a.kaptName.replace(/\s/g, "") === qn);
  if (exact.length) return [exact[0]];
  // "형제 단지" 감지 — 후보명이 qn으로 시작하고 남는 꼬리가 짧으면서(4자 이하) 숫자를 포함하면
  // ("두산1차","두산2단지" 등) 한 복합단지를 나눠 등록한 것으로 보고 전부 합산한다.
  // "두산위브"처럼 꼬리에 숫자가 없는 건 별개 개발단지일 뿐이므로 제외된다.
  const siblings = cand.filter((a) => {
    const an = a.kaptName.replace(/\s/g, "");
    if (!an.startsWith(qn)) return false;
    const rest = an.slice(qn.length);
    return rest.length > 0 && rest.length <= 4 && /[0-9]/.test(rest);
  });
  if (siblings.length > 1) return siblings;
  // 여러 후보가 있으면 이름 길이가 검색어와 가장 가까운 쪽 채택
  cand.sort((a, b) => Math.abs(a.kaptName.replace(/\s/g, "").length - qn.length) - Math.abs(b.kaptName.replace(/\s/g, "").length - qn.length));
  return [cand[0]];
}

async function fetchBasis(key, kaptCode) {
  try {
    const r = await fetch(`${BASIS_URL}?serviceKey=${encodeURIComponent(key)}&kaptCode=${encodeURIComponent(kaptCode)}&_type=json`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) JSON 파싱 실패. 응답 앞부분:`, text.slice(0, 500));
      return null;
    }
    const rawItems = extractItems(json);
    if (!rawItems || !rawItems.length) {
      console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) 빈 응답:`, text.slice(0, 500));
      return null;
    }
    const it = rawItems[0];
    const hh = parseInt(String(it.kaptdaCnt ?? "").replace(/,/g, ""), 10);
    if (!hh) {
      // 임시 디버그: kaptCode는 찾았는데 세대수 필드가 없거나 형식이 다른 경우 실제 항목을 로그로 남김
      console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) 세대수 파싱 실패. 항목:`, JSON.stringify(it).slice(0, 500));
      return null;
    }
    const dongRaw = parseInt(String(it.kaptDongCnt ?? "").replace(/,/g, ""), 10);
    return { hhcnt: hh, dongCnt: dongRaw || null, useDate: it.kaptUsedate || null };
  } catch (e) {
    console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) fetch 실패:`, e.message);
    return null;
  }
}

// 지하철호선("1호선, 4호선" 형태 문자열)·역까지 도보시간(구간 텍스트, 예: "15~20분이내")·역명을 조회.
// subwayStation(역명)은 값이 있는 단지도 있고 null인 단지도 있어(2026.08 확인 — 아파트별로 등록 상태가 다름),
// 있으면 쓰고 없으면 호선/도보시간만으로 표시.
// 세대수 조회(fetchBasis)와 달리 이 값이 없어도 치명적이지 않으므로 실패 시 조용히 null 반환.
async function fetchDtl(key, kaptCode) {
  try {
    const r = await fetch(`${DTL_URL}?serviceKey=${encodeURIComponent(key)}&kaptCode=${encodeURIComponent(kaptCode)}&_type=json`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error(`[hhcnt] getAphusDtlInfoV4(${kaptCode}) JSON 파싱 실패. 응답 앞부분:`, text.slice(0, 500));
      return null;
    }
    const rawItems = extractItems(json);
    if (!rawItems || !rawItems.length) return null;
    const it = rawItems[0];
    const subwayLines = String(it.subwayLine || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const subwayWalk = (it.kaptdWtimesub && String(it.kaptdWtimesub).trim()) || null;
    const subwayStation = (it.subwayStation && String(it.subwayStation).trim()) || null;
    if (!subwayLines.length && !subwayWalk && !subwayStation) return null;
    return { subwayLines, subwayWalk, subwayStation };
  } catch (e) {
    console.error(`[hhcnt] getAphusDtlInfoV4(${kaptCode}) fetch 실패:`, e.message);
    return null;
  }
}

// 형제 단지(같은 복합단지가 여러 kaptCode로 나뉜 경우) 지하철 정보 합산: 호선은 합집합,
// 도보시간·역명은 먼저 값이 있는 쪽을 채택(어차피 같은 위치라 사실상 동일한 값)
function mergeSubway(list) {
  const lines = new Set();
  let walk = null;
  let station = null;
  for (const f of list) {
    if (!f) continue;
    (f.subwayLines || []).forEach((l) => lines.add(l));
    if (!walk && f.subwayWalk) walk = f.subwayWalk;
    if (!station && f.subwayStation) station = f.subwayStation;
  }
  if (!lines.size && !walk && !station) return {};
  return { subwayLines: [...lines], subwayWalk: walk, subwayStation: station };
}

// matchKapt가 "형제 단지"로 판단해 후보를 여러 개 돌려줄 때, 정적 캐시 항목(이미 hhcnt 계산됨)들을 합산
function mergeFull(fulls) {
  const hh = fulls.reduce((s, f) => s + (f.hhcnt || 0), 0);
  if (!hh) return null;
  const dongCnt = fulls.reduce((s, f) => s + (f.dongCnt || 0), 0) || null;
  const useDate = fulls.map((f) => f.useDate).filter(Boolean).sort()[0] || null; // 가장 이른 사용승인일
  return { hhcnt: hh, dongCnt, useDate, ...mergeSubway(fulls) };
}
// 위와 동일하되 라이브 조회(fetchBasis) 결과들을 합산 (subways는 별도 fetchDtl 결과 배열을 받아 합침)
function mergeBasis(bases, subways = []) {
  const valid = bases.filter(Boolean);
  if (!valid.length) return null;
  const hh = valid.reduce((s, b) => s + b.hhcnt, 0);
  const dongCnt = valid.reduce((s, b) => s + (b.dongCnt || 0), 0) || null;
  const useDate = valid.map((b) => b.useDate).filter(Boolean).sort()[0] || null;
  return { hhcnt: hh, dongCnt, useDate, ...mergeSubway(subways) };
}

export default async (req) => {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return Response.json({ error: "서버에 DATA_GO_KR_KEY가 설정되지 않았습니다." }, { status: 500 });

  // ── 배치 모드(POST): 화면 하나(지역 랭킹 등)에서 최대 100여 개 단지명을 한 번의 요청으로 묶어서 조회 ──
  // GET 모드(기존, 단지 하나씩)는 그대로 유지하되, 목록형 화면은 이 배치 모드를 써서
  // 같은 data/hhcnt/<lawd>.json 파일을 단지 수만큼 반복해서 fetch하던 낭비를 없앤다
  // (2026.07 추가 — 지역 랭킹처럼 최대 100건을 개별 조회하면 파일은 동일한데 매번 새로 읽어와 느렸음).
  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "잘못된 요청" }, { status: 400 }); }
    const lawd = String(body.lawd || "").trim();
    const names = Array.isArray(body.names) ? [...new Set(body.names.map((n) => String(n || "").trim()).filter(Boolean))].slice(0, 200) : [];
    const sggs = resolveSigungu(lawd);
    if (!sggs.length) return Response.json({ error: "지역 코드 오류" }, { status: 400 });
    if (!names.length) return Response.json({ results: {} });

    const results = {};
    const remaining = new Set(names);
    const fullyOverridden = new Set(); // MANUAL_OVERRIDE로 확정된 이름 — 네이버가 뒤에서 덮어쓰지 않게 기억해둔다

    // 수동 보정 목록에 있는 이름은 정적/라이브 조회를 아예 건너뛰고 확정값으로 채운다
    for (const nm of [...remaining]) {
      const ov = checkOverride(lawd, nm);
      if (ov) { results[nm] = { found: true, name: nm, ...ov }; remaining.delete(nm); fullyOverridden.add(nm); }
    }

    // 정적 배치 파일을 딱 한 번만 읽어서, 그 안에서 요청받은 이름을 전부 매칭 시도
    // (data/hhcnt/<lawd>.json에는 세대수까지 이미 포함돼 있어 매칭만 되면 추가 API 호출이 필요 없음)
    try {
      const staticR = await fetch(`${new URL(req.url).origin}/data/hhcnt/${encodeURIComponent(lawd)}.json`);
      if (staticR.ok) {
        const staticJ = await staticR.json();
        const staticItems = (staticJ && Array.isArray(staticJ.items)) ? staticJ.items : [];
        if (staticItems.length) {
          const staticList = staticItems.map((it) => ({ kaptCode: it.kaptCode, kaptName: it.name }));
          for (const nm of [...remaining]) {
            const hits = matchKapt(staticList, nm);
            if (!hits.length) continue;
            const fulls = hits.map((h) => staticItems.find((it) => it.kaptCode === h.kaptCode)).filter(Boolean);
            const merged = fulls.length ? mergeFull(fulls) : null;
            if (!merged) continue;
            results[nm] = { found: true, name: nm, ...merged };
            remaining.delete(nm);
          }
        }
      }
    } catch (e) { /* 정적 캐시 조회 실패는 조용히 무시하고 아래 라이브 조회로 폴백 */ }

    // 정적 파일에서 못 찾은 나머지만(신규 단지, 배치가 아직 못 받은 지역 등) 라이브 API로 폴백
    // — 목록조회는 한 번만, 세대수 조회(basis)는 실제 매칭된 kaptCode만(중복 제거) 병렬로
    if (remaining.size) {
      try {
        const lists = await Promise.all(sggs.map((s) => fetchList(key, s)));
        const allItems = lists.flat();
        const matched = {}; // nm → [kaptCode, ...] (형제 단지면 여러 개)
        for (const nm of remaining) {
          const hits = matchKapt(allItems, nm);
          if (!hits.length) { results[nm] = { found: false }; continue; }
          matched[nm] = hits.map((h) => h.kaptCode);
        }
        const allCodes = [...new Set(Object.values(matched).flat())];
        const [bases, subways] = await Promise.all([
          Promise.all(allCodes.map((c) => fetchBasis(key, c))),
          Promise.all(allCodes.map((c) => fetchDtl(key, c))),
        ]);
        const basisByCode = {};
        const subwayByCode = {};
        allCodes.forEach((c, i) => { basisByCode[c] = bases[i]; subwayByCode[c] = subways[i]; });
        for (const nm of Object.keys(matched)) {
          const merged = mergeBasis(matched[nm].map((c) => basisByCode[c]), matched[nm].map((c) => subwayByCode[c]));
          results[nm] = merged ? { found: true, name: nm, ...merged } : { found: false };
        }
      } catch (e) {
        for (const nm of remaining) results[nm] = { found: false };
      }
    }

    // 네이버 세대수로 덮어쓰기(지하철 등 나머지 필드는 위에서 채운 K-apt 값 유지).
    // MANUAL_OVERRIDE로 이미 확정한 값은 건드리지 않는다 — 수동 확인값이 자동 매칭(네이버 포함)보다 우선.
    const nvMap = await loadNaverHh(new URL(req.url).origin, lawd);
    if (nvMap) for (const nm of names) { if (!fullyOverridden.has(nm)) results[nm] = applyNaver(nvMap, lawd, nm, results[nm]); }

    // 부분 보정(PARTIAL_OVERRIDE)은 네이버보다도 뒤 — 수동 확인값이 항상 최종 우선
    for (const nm of names) results[nm] = applyPartialOverride(lawd, nm, results[nm]);

    // 배치 응답은 요청마다 이름 조합이 달라 CDN 캐시 효율이 낮으므로 캐시하지 않음
    // (개별 결과는 이미 위에서 static/basis 단계의 CDN 캐시 대상 데이터를 그대로 활용한 것이라 손해 없음)
    return Response.json({ results });
  }

  const url = new URL(req.url);
  const lawd = (url.searchParams.get("lawd") || "").trim();
  const name = (url.searchParams.get("name") || "").trim();

  const sggs = resolveSigungu(lawd);
  if (!sggs.length) return Response.json({ error: "지역 코드 오류" }, { status: 400 });
  if (name.length < 2) return Response.json({ error: "단지명 오류" }, { status: 400 });

  // 단건 조회 경로도 배치와 동일하게 네이버 세대수로 덮어쓴다(아래 return들에서 applyNaver → applyPartialOverride 순).
  const nvGet = await loadNaverHh(url.origin, lawd);

  const ov = checkOverride(lawd, name);
  if (ov) return new Response(JSON.stringify({ found: true, name, ...ov }), {
    headers: { "Content-Type": "application/json", "Netlify-CDN-Cache-Control": "public, durable, max-age=7776000", "Cache-Control": "public, max-age=0, must-revalidate" },
  });

  // 세대수·동수는 사실상 고정값(재건축 전까지 안 바뀜) — CDN에 길게 캐시 (클라이언트 localStorage 캐시와 별개로,
  // 캐시가 없는 신규 방문자·다른 브라우저 요청도 최대한 API 재호출 없이 처리되도록)
  // 단, 못 찾은 경우(found:false)는 일시적 API 오류일 수 있으므로 짧게(1일)만 캐시 — 클라이언트도 미스는 1일 TTL로
  // 재시도하는데(HH_TTL_MISS_MS), CDN을 90일로 고정해두면 클라이언트가 재시도해도 CDN이 계속 옛 found:false를
  // 돌려줘 재시도가 무의미해짐(analyze.mjs·presale.mjs가 빈 결과와 정상 결과의 캐시 기간을 다르게 두는 것과 동일한 이유)
  const cacheHeadersFound = {
    "Content-Type": "application/json",
    "Netlify-CDN-Cache-Control": "public, durable, max-age=7776000",
    "Cache-Control": "public, max-age=0, must-revalidate",
  };
  const cacheHeadersMiss = {
    "Content-Type": "application/json",
    "Netlify-CDN-Cache-Control": "public, durable, max-age=86400",
    "Cache-Control": "public, max-age=0, must-revalidate",
  };

  // GitHub Actions 배치가 미리 수집해 리포에 커밋해둔 정적 목록(data/hhcnt/<lawd>.json)을 먼저 확인.
  // 세대수는 재건축 전까지 거의 안 바뀌는 값이라 여기서 매칭되면 국토부 API를 아예 호출하지 않고 즉시 반환.
  // 정적 파일이 없거나(신규 지역 등) 매칭 실패 시엔 조용히 기존 라이브 조회로 폴백.
  try {
    const staticR = await fetch(`${url.origin}/data/hhcnt/${encodeURIComponent(lawd)}.json`);
    if (staticR.ok) {
      const staticJ = await staticR.json();
      const staticList = (staticJ && Array.isArray(staticJ.items)) ? staticJ.items.map((it) => ({ kaptCode: it.kaptCode, kaptName: it.name })) : [];
      if (staticList.length) {
        const hits = matchKapt(staticList, name);
        if (hits.length) {
          const fulls = hits.map((h) => staticJ.items.find((it) => it.kaptCode === h.kaptCode)).filter(Boolean);
          const merged = fulls.length ? mergeFull(fulls) : null;
          if (merged) return new Response(JSON.stringify(applyPartialOverride(lawd, name, applyNaver(nvGet, lawd, name, { found: true, name, ...merged }))), { headers: cacheHeadersFound });
        }
      }
    }
  } catch (e) { /* 정적 캐시 조회 실패는 조용히 무시하고 아래 라이브 조회로 폴백 */ }

  try {
    const lists = await Promise.all(sggs.map((s) => fetchList(key, s)));
    const allItems = lists.flat();
    const hits = matchKapt(allItems, name);
    if (!hits.length) {
      // 임시 디버그: 목록엔 항목이 있는데(=API 자체는 정상) 이 단지명만 못 찾은 경우,
      // 후보 목록 중 이름이 비슷한 것들을 로그로 남겨 "미등록"인지 "표기 차이"인지 구분
      const qn = name.replace(/\s/g, "");
      const similar = allItems
        .filter((a) => a.kaptName.replace(/\s/g, "").includes(qn.slice(0, 2)))
        .map((a) => a.kaptName)
        .slice(0, 15);
      console.error(`[hhcnt] "${name}" 매칭 실패. 목록 총 ${allItems.length}건. 비슷한 이름 후보:`, JSON.stringify(similar));
    }
    const [bases, subways] = hits.length
      ? await Promise.all([
          Promise.all(hits.map((h) => fetchBasis(key, h.kaptCode))),
          Promise.all(hits.map((h) => fetchDtl(key, h.kaptCode))),
        ])
      : [[], []];
    const merged = mergeBasis(bases, subways);
    if (!merged) {
      const patched = applyPartialOverride(lawd, name, applyNaver(nvGet, lawd, name, { found: false }));
      return new Response(JSON.stringify(patched), { headers: patched.found ? cacheHeadersFound : cacheHeadersMiss });
    }
    return new Response(JSON.stringify(applyPartialOverride(lawd, name, applyNaver(nvGet, lawd, name, { found: true, name, ...merged }))), { headers: cacheHeadersFound });
  } catch (e) {
    // 세대수는 보조 정보이므로, 실패해도 found:false로 조용히 반환(메인 분석에 영향 없도록 500을 피함)
    return new Response(JSON.stringify({ found: false }), { headers: cacheHeadersMiss });
  }
};
