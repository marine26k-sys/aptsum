// Netlify Function — 국토부 아파트 분양권전매 실거래 월 데이터 샤드 조회 (분석은 클라이언트에서)
// 환경변수: DATA_GO_KR_KEY(필수, analyze.mjs와 공용)
// 매매(analyze.mjs)와 별개 API: 준공 전 분양권 + 재건축/재개발 입주권을 함께 제공
// (ownershipGbn: "분"=분양권, "입"=입주권 / buildYear·aptDong 필드 자체가 없음)

// Rate Limiting 없음 — 국토부 API 일 100만 콜 한도 확보, 여러 사용자가 동시에 쓰는 플랫폼이라 의도적으로 제한을 걸지 않음
export const config = {
  path: "/api/presale",
};

const RTMS = "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade";

// 공급면적 실측값 캐시 — 값이 있으면 정확한 평형, 없으면 아래 areaToPy 보간으로 폴백 (shared/supply-area.mjs 참고)
import { resolvePy } from "../../shared/supply-area.mjs";

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

// 전용면적(㎡) → 평형 환산: analyze.mjs와 동일 앵커 테이블
const PY_ANCHORS = [
  [39, 18], [49, 21], [59, 25], [74, 30], [84, 33],
  [99, 38], [110, 42], [130, 49], [150, 58], [165, 65],
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
    const umd = xtag(b, "umdNm");
    const gbn = xtag(b, "ownershipGbn"); // "분"(분양권) | "입"(입주권)
    items.push({
      apt,
      umd,
      area,
      py: resolvePy(apt, umd, area, areaToPy),
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

async function fetchText(key, lawd, ym, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(`${RTMS}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=2000&pageNo=1`, { signal: ac.signal });
      const t = await r.text();
      if (t && /<item[\s>]|<header>|SERVICE/.test(t)) return { text: t, failed: false };
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
    const [newRes, oldGuRes, oldUniRes] = await Promise.all([
      Promise.all(newMs.map((ym) => fetchText(key, code, ym))),
      Promise.all(oldMs.map((ym) => fetchText(key, code, ym))),
      Promise.all(oldMs.map((ym) => fetchText(key, cfg.oldCode, ym))),
    ]);
    const anyFailed = [...newRes, ...oldGuRes, ...oldUniRes].some((r) => r.failed);
    const items = newMs.flatMap((ym, i) => parseItems(newRes[i].text, ym));
    const oldGu = oldMs.flatMap((ym, i) => parseItems(oldGuRes[i].text, ym));
    const oldUni = oldMs
      .flatMap((ym, i) => parseItems(oldUniRes[i].text, ym))
      .filter((t) => dongs.includes(t.umd));
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

async function fetchStaticMonth(origin, lawd, ym) {
  try {
    const r = await fetch(`${origin}/data/presale/${encodeURIComponent(lawd)}/${ym}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !Array.isArray(j.items)) return null;
    return j.items;
  } catch (e) { return null; }
}

function currentAndPrevYm() {
  const d = new Date();
  const cur = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  d.setMonth(d.getMonth() - 1);
  const prev = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { cur, prev };
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
