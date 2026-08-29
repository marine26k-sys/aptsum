// Netlify Function — 국토부 실거래 월 데이터 샤드 조회 (분석은 클라이언트에서)
// 환경변수: DATA_GO_KR_KEY(필수)

// Rate Limiting 없음 — 국토부 API 일 100만 콜 한도 확보, 여러 사용자가 동시에 쓰는 플랫폼이라 의도적으로 제한을 걸지 않음
export const config = {
  path: "/api/analyze",
};

const RTMS = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";

// 행정구역 개편 지역: 구코드·신코드 병합 조회 설정
// 화성시 2026.02 분구 / 부천시 2024.01 구 재설치 / 인천 2026.07 행정체제 개편
const SPLIT_REGIONS = {
  "HS-": {
    oldCode: "41590", split: "202602",
    codes: { "동탄구": "41597", "만세구": "41591", "병점구": "41595", "효행구": "41593" },
    dongs: {
      // "여울동"은 2026.03.01부로 "오산동"에서 개명된 법정동(수민 확인) — 이 필터는 분구 이전(2026.02 이전)
      // 과거 거래를 통합코드(41590) 응답에서 걸러내는 용도라, 개명 이전 거래는 RTMS에 "오산동"으로
      // 남아있을 수 있어 옛 이름도 함께 남겨둠(둘 다 매치해도 안전 — 같은 동을 가리키는 이름일 뿐이라
      // 중복·오매칭 위험 없음). 개명 후 거래는 "여울동"으로 잡힘.
      "동탄구": ["여울동","오산동","청계동","영천동","중동","신동","목동","산척동","장지동","송동","방교동","금곡동","능동","반송동","석우동"],
      "병점구": ["병점동","진안동","반정동","기배동","화산동","안녕동","황계동","배양동","반월동","송산동","정남면"],
      "효행구": ["봉담읍","매송면","비봉면"],
      "만세구": ["남양읍","향남읍","우정읍","팔탄면","장안면","양감면","마도면","송산면","서신면","새솔동"],
    },
  },
  "BC-": {
    oldCode: "41190", split: "202401",
    codes: { "원미구": "41192", "소사구": "41194", "오정구": "41196" },
    dongs: {
      "원미구": ["원미동","심곡동","춘의동","도당동","약대동","중동","상동","소사동","역곡동"],
      "소사구": ["심곡본동","소사본동","송내동","계수동","옥길동","범박동","괴안동"],
      "오정구": ["오정동","여월동","작동","원종동","고강동","대장동","삼정동","내동"],
    },
  },
  // 인천 2026.07.01 행정체제 개편: 중구(28110)+동구(28140) 통합→제물포구, 중구의 영종·용유·무의도만 분리→영종구
  // 서구(28260) 분구: 경인아라뱃길 이북(검단신도시)만 분리→검단구, 나머지→서해구
  // 화성/부천과 달리 "여러 옛 코드를 합치거나(제물포구) 옛 코드 하나에서 동을 걸러 가져오는" 비대칭 구조라 fetchShardIncheon()에서 별도 처리
  "IC-": {
    split: "202607",
    codes: { "제물포구": "28125", "영종구": "28155", "서해구": "28275", "검단구": "28290" },
    islandDongs: ["운북동", "중산동", "운남동", "운서동", "을왕동", "남북동", "덕교동", "무의동"], // 영종·용유·무의도 (옛 중구 28110 소속)
    geomdanDongs: ["마전동", "불로동", "대곡동", "원당동", "당하동", "오류동", "왕길동", "백석동", "시천동"], // 검단신도시 (옛 서구 28260 소속)
  },
};

// 전용면적(㎡) → 평형(공급면적 기준, 시장 통용 표기) 환산
// 단순 고정비율(전용률) 나눗셈 대신, 실제 시장에서 통용되는 전용-평형 대응점(앵커)을
// 기준으로 구간 선형보간한다. 실제 전용률은 면적이 커질수록 높아지는 경향이 있어
// 고정비율로는 중대형에서 오차가 커지므로, 앵커 방식이 훨씬 실제 표기에 가깝다.
// (그래도 동일 전용면적이라도 단지별 구조(복도식/계단식)에 따라 ±1평형 편차는 있을 수 있음)
// 2026.08 개편 — 이전 값(39→18/49→21/59→25/84→33 등)이 실제 시장 관행과 어긋난다는 지적을 받아
// 재조사. 59/74/84/101/114㎡→24/30/34/40/45평형은 복수 출처(jakup.com, roberin.com 등)에서 일치
// 확인된 값. 39/49㎡(소형)와 130/150/165㎡(대형)는 확인된 구간의 전용률 증가 추세(작은 평형일수록
// 전용률 낮고, 클수록 높아짐 — 59㎡=24평(비율2.46) → 114㎡=45평(비율2.53))를 그대로 연장한 추정치라
// 확정된 값보다 신뢰도가 낮음 — 실측 데이터(공급면적 배치, data/supply-area)가 쌓이면 이 보간표 자체를
// 대체할 예정.
const PY_ANCHORS = [
  [39, 16], [49, 20], [59, 24], [74, 30], [84, 34],
  [101, 40], [114, 45], [130, 51], [150, 58], [165, 64],
];
function areaToPy(area) {
  if (!area || area <= 0) return 0;
  const A = PY_ANCHORS;
  if (area <= A[0][0]) {
    const [a0, p0] = A[0], [a1, p1] = A[1];
    return Math.round(p0 + ((area - a0) * (p1 - p0)) / (a1 - a0));
  }
  for (let i = 0; i < A.length - 1; i++) {
    const [a0, p0] = A[i], [a1, p1] = A[i + 1];
    if (area >= a0 && area <= a1) {
      return Math.round(p0 + ((area - a0) * (p1 - p0)) / (a1 - a0));
    }
  }
  const [a0, p0] = A[A.length - 2], [a1, p1] = A[A.length - 1];
  const slope = (p1 - p0) / (a1 - a0);
  return Math.round(p1 + (area - a1) * slope);
}

// 공급면적 정확화(2026.08) — data/supply-area/<lawd>.json에 그 단지·면적타입의 건축HUB 실측
// 공급면적(전유+공용)이 있으면 그걸로 평형을 계산하고, 없으면 위 PY_ANCHORS 보간으로 폴백한다.
// (collect-supply-area.mjs가 채워둔 형식: { "단지명": [{exclusiveArea, supplyArea}, ...] })
const norm = (s) => String(s || "").replace(/\s/g, "");
const SQM_PER_PY = 3.3058; // 1평 = 3.3058㎡ (공급면적 → 평형 정밀 환산)
function resolvePy(supplyMap, apt, area) {
  const rounded = Math.round(area);
  const measured = supplyMap && supplyMap[norm(apt)];
  if (measured) {
    const hit = measured.find((t) => Math.round(t.exclusiveArea) === rounded);
    if (hit) return Math.round(hit.supplyArea / SQM_PER_PY);
  }
  return areaToPy(rounded);
}
// items 배열에 py를 한 번에 부여 — static/live 등 출처와 무관하게 항상 이 시점에만 계산해서
// (PY_ANCHORS 개편 때와 동일한 이유로) 오래된 캐시·정적 파일의 옛 py 값에 의존하지 않는다.
function attachPy(items, supplyMap) {
  for (const it of items) it.py = resolvePy(supplyMap, it.apt, it.area);
  return items;
}
// GitHub Actions 배치가 커밋해둔 단지별 실측 공급면적 — lawd당 1개 파일이라 요청당 한 번만 로드해
// 이번 요청에서 다루는 모든 월·모든 거래에 재사용한다. 분구 지역(HS-/BC-/IC-)은 아직 수집 대상이
// 아니라 파일 자체가 없어 자동으로 null(=보간 폴백)이 된다.
async function fetchSupplyAreaMap(origin, lawd) {
  try {
    const r = await fetch(`${origin}/data/supply-area/${encodeURIComponent(lawd)}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.items && typeof j.items === "object" ? j.items : null;
  } catch (e) { return null; }
}

function xtag(b, name) {
  // 태그 속성·공백 허용 (포맷 변동 대비)
  const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1].trim() : "";
}
const R1 = (x) => Math.round(x * 10) / 10;

function parseItems(xml, ymFallback) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const amtRaw = xtag(b, "dealAmount").replace(/,/g, "");
    if (!amtRaw) continue;
    if (xtag(b, "cdealType") === "O") continue;
    const area = parseFloat(xtag(b, "excluUseAr")) || 0;
    items.push({
      apt: xtag(b, "aptNm"),
      umd: xtag(b, "umdNm"),
      area,
      // py는 여기서 계산하지 않음 — fetchShard()에서 supply-area 실측 유무를 반영해 한 번에 계산(attachPy 참고)
      amt: R1(parseInt(amtRaw, 10) / 10000),
      ym: (xtag(b, "dealYear") + xtag(b, "dealMonth").padStart(2, "0")) || ymFallback,
      d: xtag(b, "dealDay").padStart(2, "0"),
      floor: xtag(b, "floor"),
      build: xtag(b, "buildYear"),
      direct: xtag(b, "dealingGbn").includes("직") ? 1 : 0,
      // 2026.08 추가 — 건축HUB(건축물대장) API로 실제 전유/공용면적을 조회하려면 주소 코드(시군구+법정동+본번+부번)가
      // 필요한데, RTMS 응답에 본번(bonbun)·부번(bubun)이 이미 포함되어 있어 따로 추출. 법정동코드(umd명→5자리 코드)
      // 매핑 테이블은 별도 준비 필요(수민이 국토부 법정동코드 전체자료를 구해주면 연결) — 그 전까지는 미사용 필드.
      bonbun: xtag(b, "bonbun"),
      bubun: xtag(b, "bubun"),
    });
  }
  return items;
}

const FETCH_TIMEOUT_MS = 8000; // 국토부 API가 느려질 때 무한 대기하지 않도록 요청당 타임아웃

async function fetchText(key, lawd, ym, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(`${RTMS}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=2000&pageNo=1`, { signal: ac.signal });
      const t = await r.text();
      if (t && /<item[\s>]|<header>|SERVICE/.test(t)) return { text: t, failed: false }; // 정상 응답(빈 결과 포함) 형태 확인
      if (i === retries) return { text: t || "", failed: true }; // 형식이 이상한 응답 — 마지막 시도까지 실패로 간주
    } catch (e) {
      if (i === retries) return { text: "", failed: true }; // 타임아웃(abort) 포함 — 마지막 시도까지 실패로 간주
    } finally {
      clearTimeout(timer);
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1))); // 재시도 전 짧게 대기
  }
  return { text: "", failed: true };
}

// 인천 전용: 제물포구=옛 중구(섬 동 제외)+옛 동구(전체) / 영종구=옛 중구 중 섬 동만
// 서해구=옛 서구(검단 동 제외) / 검단구=옛 서구 중 검단 동만 — 옛 코드끼리 겹치는 범위가 없어 화성/부천처럼 중복 제거가 필요 없음
async function fetchShardIncheon(key, guName, yms) {
  const cfg = SPLIT_REGIONS["IC-"];
  const code = cfg.codes[guName];
  if (!code) return { error: "구 선택 오류" };
  const oldMs = yms.filter((ym) => ym < cfg.split);
  const newMs = yms.filter((ym) => ym >= cfg.split);

  const newRes = await Promise.all(newMs.map((ym) => fetchText(key, code, ym)));
  const items = newMs.flatMap((ym, i) => parseItems(newRes[i].text, ym));

  let oldItems = [];
  let oldRes = [];
  if (oldMs.length) {
    if (guName === "제물포구") {
      const [c110, c140] = await Promise.all([
        Promise.all(oldMs.map((ym) => fetchText(key, "28110", ym))),
        Promise.all(oldMs.map((ym) => fetchText(key, "28140", ym))),
      ]);
      oldRes = [...c110, ...c140];
      const mainland = oldMs.flatMap((ym, i) => parseItems(c110[i].text, ym)).filter((t) => !cfg.islandDongs.includes(t.umd));
      const dong = oldMs.flatMap((ym, i) => parseItems(c140[i].text, ym));
      oldItems = [...mainland, ...dong];
    } else if (guName === "영종구") {
      oldRes = await Promise.all(oldMs.map((ym) => fetchText(key, "28110", ym)));
      oldItems = oldMs.flatMap((ym, i) => parseItems(oldRes[i].text, ym)).filter((t) => cfg.islandDongs.includes(t.umd));
    } else if (guName === "서해구") {
      oldRes = await Promise.all(oldMs.map((ym) => fetchText(key, "28260", ym)));
      oldItems = oldMs.flatMap((ym, i) => parseItems(oldRes[i].text, ym)).filter((t) => !cfg.geomdanDongs.includes(t.umd));
    } else if (guName === "검단구") {
      oldRes = await Promise.all(oldMs.map((ym) => fetchText(key, "28260", ym)));
      oldItems = oldMs.flatMap((ym, i) => parseItems(oldRes[i].text, ym)).filter((t) => cfg.geomdanDongs.includes(t.umd));
    }
  }
  const anyFailed = [...newRes, ...oldRes].some((r) => r.failed);
  return { items: [...items, ...oldItems], anyFailed };
}

async function fetchShardLive(key, lawd, yms) {
  if (lawd.startsWith("IC-")) return fetchShardIncheon(key, lawd.slice(3), yms);
  const prefix = Object.keys(SPLIT_REGIONS).find((p) => lawd.startsWith(p));
  if (prefix) {
    const cfg = SPLIT_REGIONS[prefix];
    const gu = lawd.slice(prefix.length);
    const code = cfg.codes[gu];
    const dongs = cfg.dongs[gu];
    if (!code) return { error: "구 선택 오류" };
    const oldMs = yms.filter((ym) => ym < cfg.split);
    const newMs = yms.filter((ym) => ym >= cfg.split);
    // 과거 월은 신규 구코드 + 폐지 통합코드(41590) 양쪽 병렬 조회 후 병합
    // (국토부의 과거분 이관 여부와 무관하게 어느 쪽에 있든 수집)
    const [newRes, oldGuRes, oldUniRes] = await Promise.all([
      Promise.all(newMs.map((ym) => fetchText(key, code, ym))),
      Promise.all(oldMs.map((ym) => fetchText(key, code, ym))),
      Promise.all(oldMs.map((ym) => fetchText(key, cfg.oldCode, ym))),
    ]);
    const anyFailed = [...newRes, ...oldGuRes, ...oldUniRes].some((r) => r.failed);
    const items = newMs.flatMap((ym, i) => parseItems(newRes[i].text, ym));
    const oldGu = oldMs.flatMap((ym, i) => parseItems(oldGuRes[i].text, ym)); // 구코드 응답은 이미 해당 구 범위
    const oldUni = oldMs
      .flatMap((ym, i) => parseItems(oldUniRes[i].text, ym))
      .filter((t) => dongs.includes(t.umd)); // 통합코드는 법정동 필터
    // 중복 제거 (동일 거래가 양쪽에 있을 수 있음)
    const seen = new Set();
    for (const t of [...oldGu, ...oldUni]) {
      const k = `${t.apt}|${t.umd}|${t.area}|${t.amt}|${t.ym}|${t.d}|${t.floor}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(t);
    }
    return { items, anyFailed };
  }
  const results = await Promise.all(yms.map((ym) => fetchText(key, lawd, ym)));
  const anyFailed = results.some((r) => r.failed);
  const joined = results.map((r) => r.text).join(" ");
  if (!results.some((r) => /<item[\s>]/.test(r.text))) {
    if (joined.includes("SERVICE_KEY") || joined.includes("SERVICE ERROR"))
      return { error: "공공데이터 API 키 오류 — 키 상태를 확인하세요." };
    if (joined.includes("EXCEEDS") || joined.includes("LIMITED"))
      return { error: "일일 호출 한도 초과" };
  }
  return { items: yms.flatMap((ym, i) => parseItems(results[i].text, ym)), anyFailed };
}

// GitHub Actions 배치가 미리 수집해 리포에 커밋해둔 정적 JSON(data/analyze/<lawd>/<ym>.json)을 먼저 확인.
// publish=".", 이므로 Netlify가 이 파일들도 그대로 정적 호스팅 + CDN 캐시함 — 있으면 국토부 API 호출 자체를 생략.
// 없거나(아직 배치가 못 돈 최신월 등) 읽기 실패 시 조용히 기존 라이브 조회로 폴백(동작 자체엔 영향 없음).
async function fetchStaticMonth(origin, lawd, ym) {
  try {
    const r = await fetch(`${origin}/data/analyze/${encodeURIComponent(lawd)}/${ym}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.items)) return null;
    // 저장된 py는 정적 파일이 커밋된 시점 기준(옛 PY_ANCHORS 또는 그때까지의 supply-area 커버리지)이라
    // 그대로 믿지 않음 — area는 그대로 두고 py는 fetchShard()의 attachPy()가 최신 로직으로 한 번에
    // 다시 계산한다(2026.08 PY_ANCHORS 개편 때 확립된 패턴, 공급면적 실측 도입에도 동일 적용).
    return j.items;
  } catch (e) { return null; }
}

// 오늘 기준 "최근 2개월"(당월+전월) — 이 범위는 실거래 신고가 계속 들어와 배치가 격주로만 돌아도
// static JSON이 금방 낡아버리므로, 하이브리드 모드에서는 static 존재 여부와 무관하게 항상 실시간 호출한다.
function currentAndPrevYm() {
  const d = new Date();
  const cur = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  d.setMonth(d.getMonth() - 1);
  const prev = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { cur, prev };
}

async function fetchShard(key, lawd, yms, origin) {
  if (!origin) {
    const r = await fetchShardLive(key, lawd, yms);
    if (r.items) attachPy(r.items, null); // origin 없이 호출된 경우(라이브 전용) — supply-area 없이 보간만 적용
    return r;
  }

  const { cur, prev } = currentAndPrevYm();
  const isRecent = (ym) => ym === cur || ym === prev;
  const historicalYms = yms.filter((ym) => !isRecent(ym)); // 2개월 이전 — static 우선
  const recentYms = yms.filter(isRecent); // 최근 2개월 — 무조건 실시간

  // recentYms는 static을 아예 확인하지 않고 무조건 live이므로, static 조회(historicalYms) 완료를
  // 기다렸다가 순차로 live를 쏘면 그만큼 불필요하게 늦어진다 — 캐시 미스(30분 만료 직후) 시
  // 체감 지연의 주 원인이라 static 조회와 동시에 바로 병렬로 쏜다 (2026.07 추가)
  // supply-area 실측 맵도 같이 병렬로 로드 — py 계산은 아래에서 items가 다 모인 뒤 한 번에 하므로
  // (attachPy) 이 시점엔 그냥 나머지와 동시에 시작해두기만 하면 됨(순서 의존성 없음).
  const [supplyMap, staticHits, recentLive] = await Promise.all([
    fetchSupplyAreaMap(origin, lawd),
    historicalYms.length
      ? Promise.all(historicalYms.map((ym) => fetchStaticMonth(origin, lawd, ym)))
      : [],
    recentYms.length ? fetchShardLive(key, lawd, recentYms) : { items: [], anyFailed: false },
  ]);
  const missingHistorical = historicalYms.filter((_, i) => staticHits[i] === null); // static 배치가 아직 못 받은 과거월
  const staticItems = staticHits.filter((h) => h !== null).flat();

  // 최근월 live 자체가 실패하면(키 오류·한도 초과 등) 기존과 동일하게 처리 — static이라도 있으면 그거라도 반환
  if (recentLive.error) {
    if (!staticItems.length) return recentLive;
    attachPy(staticItems, supplyMap);
    return { items: staticItems, anyFailed: true };
  }

  if (!missingHistorical.length) {
    const items = [...staticItems, ...recentLive.items];
    attachPy(items, supplyMap);
    return { items, anyFailed: recentLive.anyFailed };
  }

  // static에서 못 찾은 과거월만 추가로 live 조회 (recentYms와는 별개 호출 — recentYms는 위에서 이미 끝났음)
  const missingLive = await fetchShardLive(key, lawd, missingHistorical);
  if (missingLive.error) {
    const items = [...staticItems, ...recentLive.items]; // 최근월 live는 이미 성공했으니 그 데이터는 살리고 과거 누락분만 에러 취급
    if (!items.length) return missingLive;
    attachPy(items, supplyMap);
    return { items, anyFailed: true };
  }
  const items = [...staticItems, ...recentLive.items, ...missingLive.items];
  attachPy(items, supplyMap);
  return { items, anyFailed: recentLive.anyFailed || missingLive.anyFailed };
}

export default async (req) => {
  const url = new URL(req.url);
  let lawd, yms;
  if (req.method === "GET") {
    lawd = (url.searchParams.get("lawd") || "").trim();
    yms = (url.searchParams.get("yms") || "").split(",").filter((y) => /^\d{6}$/.test(y)).slice(0, 15);
  } else if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "잘못된 요청" }, { status: 400 }); }
    lawd = (body.lawd || "").trim();
    yms = Array.isArray(body.yms) ? body.yms.filter((y) => /^\d{6}$/.test(y)).slice(0, 15) : [];
  } else {
    return Response.json({ error: "GET/POST only" }, { status: 405 });
  }

  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return Response.json({ error: "서버에 DATA_GO_KR_KEY가 설정되지 않았습니다." }, { status: 500 });

  if (!/^\d{5}$/.test(lawd) && !Object.keys(SPLIT_REGIONS).some((p) => lawd.startsWith(p)))
    return Response.json({ error: "지역 코드 오류" }, { status: 400 });
  if (!yms.length) return Response.json({ error: "조회 월 없음" }, { status: 400 });

  const r = await fetchShard(key, lawd, yms, url.origin);
  if (r.error) return Response.json({ error: r.error }, { status: 502 });

  // 캐시 전략: 최신 2개월이 섞이거나 재시도까지 실패한 달이 있으면 30분, 전부 과거월이고 완전 성공이면 30일 (CDN 캐시)
  // (재시도해도 실패한 달이 섞인 응답을 30일씩 박제해버리면, 그 사이 국토부 API가 정상화돼도 CDN이 계속 빈 데이터를 돌려주게 됨)
  const { cur, prev } = currentAndPrevYm();
  const stable = yms.every((ym) => ym !== cur && ym !== prev) && !r.anyFailed;
  return new Response(JSON.stringify({ items: r.items }), {
    headers: {
      "Content-Type": "application/json",
      "Netlify-CDN-Cache-Control": stable
        ? "public, durable, max-age=2592000"
        : "public, max-age=1800",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
};
