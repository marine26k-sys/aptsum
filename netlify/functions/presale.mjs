import { currentAndPrevYm, collectMonths } from "../../shared/month-fetch.mjs";
// Netlify Function — 국토부 아파트 분양권전매 실거래 월 데이터 샤드 조회 (분석은 클라이언트에서)
// 환경변수: DATA_GO_KR_KEY(필수, analyze.mjs와 공용)
// 매매(analyze.mjs)와 별개 API: 준공 전 분양권 + 재건축/재개발 입주권을 함께 제공
// (ownershipGbn: "분"=분양권, "입"=입주권 / buildYear·aptDong 필드 자체가 없음)

// Rate Limiting 없음 — 국토부 API 일 100만 콜 한도 확보, 여러 사용자가 동시에 쓰는 플랫폼이라 의도적으로 제한을 걸지 않음
export const config = {
  path: "/api/presale",
};

const RTMS = "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade";

// 행정구역 개편 지역: analyze.mjs와 동일 설정 (화성시 2026.02 분구 / 부천시 2024.01 구 재설치 / 인천 2026.07 행정체제 개편)
const SPLIT_REGIONS = {
  "HS-": {
    oldCode: "41590", split: "202602",
    codes: { "동탄구": "41597", "만세구": "41591", "병점구": "41595", "효행구": "41593" },
    dongs: {
      "동탄구": ["오산동","청계동","영천동","중동","신동","목동","산척동","장지동","송동","방교동","금곡동","능동","반송동","석우동","여울동"],
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
  // 서구(28260) 분구: 검단신도시만 분리→검단구, 나머지→서해구 (fetchShardIncheon()에서 별도 처리)
  "IC-": {
    split: "202607",
    codes: { "제물포구": "28125", "영종구": "28155", "서해구": "28275", "검단구": "28290" },
    islandDongs: ["운북동", "중산동", "운남동", "운서동", "을왕동", "남북동", "덕교동", "무의동"],
    geomdanDongs: ["마전동", "불로동", "대곡동", "원당동", "당하동", "오류동", "왕길동", "백석동", "시천동"],
  },
};

// 전용면적(㎡) → 평형 환산: analyze.mjs와 동일 앵커 테이블(2026.08 3차 개편 버전으로 통일, 2026.09 —
// rent.mjs와 같은 이유로 구버전 앵커를 쓰고 있으면 분양권과 매매가 같은 84㎡인데 서로 다른 평형
// 라벨(33평 vs 34평)로 갈려 신고가 등 매매+분양권 병합 랭킹에서 그룹이 잘못 쪼개짐 — analyze.mjs
// 앵커로 교체해 통일.
const PY_ANCHORS = [
  [29, 14], [37, 15], [39, 18], [49, 21], [50, 21], [53, 21],
  [59, 25], [60, 25], [63, 26], [68, 28], [76, 31], [77, 31],
  [84, 33],
  // 2026.09 5차 개편(미세조정) — 92~124㎡ 구간은 이미 실측(위 4차 개편과 같은 소스)과 ±1평 이내로
  // 거의 정확했지만, 95/97/99/109/110 다섯 지점만 정확히 맞춰서 완전히 일치시킴.
  [95, 39], [97, 39], [99, 39], [105, 41], [109, 44],
  [110, 44], [113, 44], [114, 44], [116, 44], [119, 46],
  // 2026.09 4차 개편 — 125~165㎡ 구간을 data/supply-area 실측 데이터(79개 지역, 5,682개 타입, 각 지점
  // 표본 10~68개)로 교체(scripts/derive-py-anchors.mjs, 가중 PAVA 스무딩). 166㎡ 이상은 아직 표본이
  // 2~4개뿐이고 한남더힐·아크로서울포레스트 등 초고가 단지가 섞여 튀는 값이 나와서 이번엔 보류 —
  // 167 지점만 165→167 추세에 맞게 소폭 조정(66→63), 그 이상은 지금처럼 마지막 두 점 기울기로 추정.
  [125, 49], [130, 50], [135, 50], [140, 57], [145, 57],
  [150, 59], [155, 59], [160, 62], [165, 62], [167, 63],
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

// 2026.09 추가 — data/supply-area/<lawd>.json(건축HUB 실측 공급면적 배치 결과)에 해당 단지+전용면적이
// 있으면 그 실측값 기준으로 평형을 다시 계산하고, 없으면 기존 areaToPy() 보간값을 그대로 쓴다.
// fetchStaticMonth와 동일하게 매 요청마다 fetch()로 실시간 조회(재배포 안 해도 배치 결과 바로 반영).
// (analyze.mjs의 동일 로직 별도 사본)
// 2026.09 — 전용률(전용면적÷공급면적) 상한. 아파트는 계단·복도·엘리베이터 같은 주거공용이 반드시
// 있어서 전용률이 85%를 넘을 수 없다. 그보다 높게 나온 건 실측이 아니라 "건축HUB 스캔이 그 세대의
// 공용 행을 다 못 잡은 것"(수집 실패)이다 — 전체 13,680개 타입 중 23.4%가 여기 해당했고, 그중 13.7%는
// 공용이 아예 0이었다. 아래 ±3평 가드로는 이게 안 걸러진다(예: 전용 59㎡가 22평으로 나와도 보간값
// 25평과 3평 차이라 그대로 통과) → 잘못된 평형이 화면에 그대로 나갔음.
const MAX_EXCLUSIVE_RATIO = 0.85;
const SQM_PER_PY = 3.3058;
const norm = (s) => String(s || "").replace(/\s/g, "");
const supplyAreaCache = new Map();
async function loadSupplyAreaMap(origin, lawd) {
  if (supplyAreaCache.has(lawd)) return supplyAreaCache.get(lawd);
  let map = null;
  try {
    const r = await fetch(`${origin}/data/supply-area/${encodeURIComponent(lawd)}.json`);
    if (r.ok) {
      const j = await r.json();
      map = new Map();
      for (const [name, types] of Object.entries(j.items || {})) map.set(norm(name), types);
    }
  } catch (e) { map = null; }
  supplyAreaCache.set(lawd, map);
  return map;
}
async function hubPyOverride(items, lawd, origin) {
  if (!origin || !lawd || !/^\d{5}$/.test(lawd)) return items;
  const map = await loadSupplyAreaMap(origin, lawd);
  if (!map) return items;
  return items.map((t) => {
    const types = map.get(norm(t.apt));
    if (!Array.isArray(types)) return t; // 2026.09 방어 — 데이터 형식이 예상과 다르면 조용히 폴백(throw로 요청 전체가 죽는 것 방지)
    const rounded = Math.round(t.area);
    const match = types.find((ty) => Math.round(ty.exclusiveArea) === rounded);
    if (!match || !Number.isFinite(match.supplyArea)) return t; // supplyArea가 없거나 숫자가 아니면 NaN평 표시 방지
    if (!(match.supplyArea > 0) || match.exclusiveArea / match.supplyArea > MAX_EXCLUSIVE_RATIO) return t; // 공용 누락된 수집 실패분
    const hubPy = Math.round(match.supplyArea / SQM_PER_PY);
    // 2026.09 — 실측값이 기존 보간값(t.py)과 너무 동떨어지면 실측값을 버리고 보간값을 그대로 씀
    // (analyze.mjs 주석 참고 — 주상복합 등 특이 케이스에서 실측값이 시장 관행 라벨과 크게 벌어지는
    // 사례가 실제로 확인됨). 3평 이상 차이나면 신뢰하지 않음.
    if (Math.abs(hubPy - t.py) > 3) return t;
    return { ...t, py: hubPy };
  });
}

function xtag(b, name) {
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
    if (xtag(b, "cdealType") === "O") continue; // 해제거래 제외
    const apt = xtag(b, "aptNm");
    if (!apt) continue; // 단지명 미확정 건(초기 분양권 등)은 집계 불가하므로 제외
    const area = parseFloat(xtag(b, "excluUseAr")) || 0;
    const gbn = xtag(b, "ownershipGbn"); // "분"(분양권) | "입"(입주권)
    items.push({
      apt,
      umd: xtag(b, "umdNm"),
      area,
      py: areaToPy(Math.round(area)),
      amt: R1(parseInt(amtRaw, 10) / 10000),
      ym: (xtag(b, "dealYear") + xtag(b, "dealMonth").padStart(2, "0")) || ymFallback,
      d: xtag(b, "dealDay").padStart(2, "0"),
      floor: xtag(b, "floor"),
      ownership: gbn === "분" ? "분양권" : gbn === "입" ? "입주권" : "",
      direct: xtag(b, "dealingGbn").includes("직") ? 1 : 0,
    });
  }
  return items;
}

const FETCH_TIMEOUT_MS = 8000; // 국토부 API가 느려질 때 무한 대기하지 않도록 요청당 타임아웃

// 응답 실패 판정 — data.go.kr은 정상이든 오류든 항상 <header>를 달고 응답하기 때문에, 예전처럼
// "<header>나 SERVICE 문자열이 있으면 성공"으로 보면 호출 한도 초과·키 오류 같은 에러 응답까지
// "거래 0건인 정상적인 달"로 통과해버린다(2026.09 발견 — 배치 쪽에선 그 0건이 파일로 커밋돼 강남구
// 202608이 통째로 빈 채 박제돼 있었음. shared/rtms-parse.mjs에 같은 수정 적용).
// 모르는 성공 코드 때문에 전부 실패 처리되는 일이 없도록 "확실한 오류"만 실패로 본다.
function rtmsFailed(t) {
  if (!t) return true;
  if (/<item[\s>]/.test(t)) return false;                        // 거래 데이터가 실제로 들어있음
  if (/<totalCount>\s*0\s*<\/totalCount>/.test(t)) return false; // 거래가 정말 없는 달(정상 빈 응답)
  const m = t.match(/<resultCode>\s*([^<]*?)\s*<\/resultCode>/);
  if (m) return m[1].replace(/^0+/, "") !== "";                  // 00/000/0 만 정상, 그 외는 오류코드
  return true;                                                   // header도 resultCode도 없는 이상한 응답
}

async function fetchText(key, lawd, ym, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(`${RTMS}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=2000&pageNo=1`, { signal: ac.signal });
      const t = await r.text();
      if (!rtmsFailed(t)) return { text: t, failed: false };
      if (i === retries) return { text: t || "", failed: true };
    } catch (e) {
      if (i === retries) return { text: "", failed: true }; // 타임아웃(abort) 포함
    } finally {
      clearTimeout(timer);
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  return { text: "", failed: true };
}

// 인천 전용: analyze.mjs의 fetchShardIncheon()과 동일한 로직 (분양권 API용)
async function fetchShardIncheon(key, guName, yms, origin) {
  const cfg = SPLIT_REGIONS["IC-"];
  const code = cfg.codes[guName];
  if (!code) return { error: "구 선택 오류" };
  const oldMs = yms.filter((ym) => ym < cfg.split);
  const newMs = yms.filter((ym) => ym >= cfg.split);

  const newRes = await Promise.all(newMs.map((ym) => fetchText(key, code, ym)));
  const items = await hubPyOverride(newMs.flatMap((ym, i) => parseItems(newRes[i].text, ym)), code, origin);

  let oldItems = [];
  let oldRes = [];
  if (oldMs.length) {
    if (guName === "제물포구") {
      const [c110, c140] = await Promise.all([
        Promise.all(oldMs.map((ym) => fetchText(key, "28110", ym))),
        Promise.all(oldMs.map((ym) => fetchText(key, "28140", ym))),
      ]);
      oldRes = [...c110, ...c140];
      const mainlandAll = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(c110[i].text, ym)), "28110", origin);
      const mainland = mainlandAll.filter((t) => !cfg.islandDongs.includes(t.umd));
      const dong = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(c140[i].text, ym)), "28140", origin);
      oldItems = [...mainland, ...dong];
    } else if (guName === "영종구") {
      oldRes = await Promise.all(oldMs.map((ym) => fetchText(key, "28110", ym)));
      const all = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(oldRes[i].text, ym)), "28110", origin);
      oldItems = all.filter((t) => cfg.islandDongs.includes(t.umd));
    } else if (guName === "서해구") {
      oldRes = await Promise.all(oldMs.map((ym) => fetchText(key, "28260", ym)));
      const all = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(oldRes[i].text, ym)), "28260", origin);
      oldItems = all.filter((t) => !cfg.geomdanDongs.includes(t.umd));
    } else if (guName === "검단구") {
      oldRes = await Promise.all(oldMs.map((ym) => fetchText(key, "28260", ym)));
      const all = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(oldRes[i].text, ym)), "28260", origin);
      oldItems = all.filter((t) => cfg.geomdanDongs.includes(t.umd));
    }
  }
  const anyFailed = [...newRes, ...oldRes].some((r) => r.failed);
  return { items: [...items, ...oldItems], anyFailed };
}

async function fetchShardLive(key, lawd, yms, origin) {
  if (lawd.startsWith("IC-")) return fetchShardIncheon(key, lawd.slice(3), yms, origin);
  const prefix = Object.keys(SPLIT_REGIONS).find((p) => lawd.startsWith(p));
  if (prefix) {
    const cfg = SPLIT_REGIONS[prefix];
    const gu = lawd.slice(prefix.length);
    const code = cfg.codes[gu];
    const dongs = cfg.dongs[gu];
    if (!code) return { error: "구 선택 오류" };
    const oldMs = yms.filter((ym) => ym < cfg.split);
    const newMs = yms.filter((ym) => ym >= cfg.split);
    const [newRes, oldGuRes, oldUniRes] = await Promise.all([
      Promise.all(newMs.map((ym) => fetchText(key, code, ym))),
      Promise.all(oldMs.map((ym) => fetchText(key, code, ym))),
      Promise.all(oldMs.map((ym) => fetchText(key, cfg.oldCode, ym))),
    ]);
    const anyFailed = [...newRes, ...oldGuRes, ...oldUniRes].some((r) => r.failed);
    const items = await hubPyOverride(newMs.flatMap((ym, i) => parseItems(newRes[i].text, ym)), code, origin);
    const oldGu = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(oldGuRes[i].text, ym)), code, origin);
    const oldUniAll = await hubPyOverride(oldMs.flatMap((ym, i) => parseItems(oldUniRes[i].text, ym)), cfg.oldCode, origin);
    const oldUni = oldUniAll.filter((t) => dongs.includes(t.umd));
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
  return { items: await hubPyOverride(yms.flatMap((ym, i) => parseItems(results[i].text, ym)), lawd, origin), anyFailed };
}

async function fetchStaticMonth(origin, lawd, ym) {
  try {
    const r = await fetch(`${origin}/data/presale/${encodeURIComponent(lawd)}/${ym}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.items)) return null;
    // area는 그대로, py만 지금 코드의 PY_ANCHORS로 다시 계산(2026.08 — analyze.mjs와 동일한 이유)
    return await hubPyOverride(j.items.map((it) => ({ ...it, py: areaToPy(Math.round(it.area)) })), lawd, origin);
  } catch (e) { return null; }
}



async function fetchShard(key, lawd, yms, origin) {
  if (!origin) return fetchShardLive(key, lawd, yms);

  const { cur, prev } = currentAndPrevYm();
  const isRecent = (ym) => ym === cur || ym === prev;
  const historicalYms = yms.filter((ym) => !isRecent(ym));
  const recentYms = yms.filter(isRecent);

  // recentYms는 static을 아예 확인하지 않고 무조건 live이므로, static 조회(historicalYms) 완료를
  // 기다렸다가 순차로 live를 쏘면 그만큼 불필요하게 늦어진다 — 캐시 미스(30분 만료 직후) 시
  // 체감 지연의 주 원인이라 static 조회와 동시에 바로 병렬로 쏜다 (2026.07 추가, analyze.mjs와 동일)
  const [staticHits, recentLive] = await Promise.all([
    historicalYms.length
      ? Promise.all(historicalYms.map((ym) => fetchStaticMonth(origin, lawd, ym)))
      : [],
    recentYms.length ? fetchShardLive(key, lawd, recentYms) : { items: [], anyFailed: false },
  ]);
  const missingHistorical = historicalYms.filter((_, i) => staticHits[i] === null);
  const staticItems = staticHits.filter((h) => h !== null).flat();

  if (recentLive.error) return staticItems.length ? { items: staticItems, anyFailed: true } : recentLive;

  if (!missingHistorical.length) {
    return { items: [...staticItems, ...recentLive.items], anyFailed: recentLive.anyFailed };
  }

  const missingLive = await fetchShardLive(key, lawd, missingHistorical);
  if (missingLive.error) {
    const items = [...staticItems, ...recentLive.items];
    return items.length ? { items, anyFailed: true } : missingLive;
  }
  return { items: [...staticItems, ...recentLive.items, ...missingLive.items], anyFailed: recentLive.anyFailed || missingLive.anyFailed };
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
    lawd = String(body?.lawd || "").trim();
    yms = Array.isArray(body.yms) ? body.yms.filter((y) => /^\d{6}$/.test(y)).slice(0, 15) : [];
  } else {
    return Response.json({ error: "GET/POST only" }, { status: 405 });
  }

  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return Response.json({ error: "서버에 DATA_GO_KR_KEY가 설정되지 않았습니다." }, { status: 500 });

  if (!/^\d{5}$/.test(lawd) && !Object.keys(SPLIT_REGIONS).some((p) => lawd.startsWith(p)))
    return Response.json({ error: "지역 코드 오류" }, { status: 400 });
  if (!yms.length) return Response.json({ error: "조회 월 없음" }, { status: 400 });

  const r = await collectMonths(yms, (ym) => fetchShard(key, lawd, [ym], url.origin));
  if (r.error) return Response.json({ error: r.error }, { status: 502 });

  const { cur, prev } = currentAndPrevYm();
  const stable = yms.every((ym) => ym !== cur && ym !== prev) && !r.anyFailed;
  return new Response(JSON.stringify({ items: r.items, failedMonths: r.failedMonths }), {
    headers: {
      "Content-Type": "application/json",
      "Netlify-CDN-Cache-Control": r.anyFailed ? "no-store" : stable
        ? "public, durable, max-age=2592000"
        : "public, max-age=1800",
      "Cache-Control": r.anyFailed ? "no-store" : "public, max-age=0, must-revalidate",
    },
  });
};
