// 국토부 실거래 XML 파싱 공용 유틸 — scripts/collect-trades.mjs 전용
// (netlify/functions/*.mjs의 로직과 동일하지만, 서버 함수 코드는 건드리지 않기 위해 별도 사본으로 둔다)

// 2026.08 3차 개편 — netlify/functions/analyze.mjs와 동일 앵커로 통일(운영자 실측 10개 단지 교차검증,
// 가중 PAVA 스무딩). 배경 설명은 analyze.mjs의 PY_ANCHORS 주석 참고.
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
export function areaToPy(area) {
  if (!area || area <= 0) return 0;
  const A = PY_ANCHORS;
  if (area <= A[0][0]) {
    const [a0, p0] = A[0], [a1, p1] = A[1];
    return Math.round(p0 + ((area - a0) * (p1 - p0)) / (a1 - a0));
  }
  for (let i = 0; i < A.length - 1; i++) {
    const [a0, p0] = A[i], [a1, p1] = A[i + 1];
    if (area >= a0 && area <= a1) return Math.round(p0 + ((area - a0) * (p1 - p0)) / (a1 - a0));
  }
  const [a0, p0] = A[A.length - 2], [a1, p1] = A[A.length - 1];
  const slope = (p1 - p0) / (a1 - a0);
  return Math.round(p1 + (area - a1) * slope);
}

export function xtag(b, name) {
  const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1].trim() : "";
}
export const R1 = (x) => Math.round(x * 10) / 10;

export function parseTrade(xml, ymFallback) {
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
      apt: xtag(b, "aptNm"), umd: xtag(b, "umdNm"), area, py: areaToPy(Math.round(area)),
      amt: R1(parseInt(amtRaw, 10) / 10000),
      ym: (xtag(b, "dealYear") + xtag(b, "dealMonth").padStart(2, "0")) || ymFallback,
      d: xtag(b, "dealDay").padStart(2, "0"), floor: xtag(b, "floor"), build: xtag(b, "buildYear"),
      direct: xtag(b, "dealingGbn").includes("직") ? 1 : 0,
    });
  }
  return items;
}

export function parsePresale(xml, ymFallback) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const amtRaw = xtag(b, "dealAmount").replace(/,/g, "");
    if (!amtRaw) continue;
    if (xtag(b, "cdealType") === "O") continue;
    const apt = xtag(b, "aptNm");
    if (!apt) continue;
    const area = parseFloat(xtag(b, "excluUseAr")) || 0;
    const gbn = xtag(b, "ownershipGbn");
    items.push({
      apt, umd: xtag(b, "umdNm"), area, py: areaToPy(Math.round(area)),
      amt: R1(parseInt(amtRaw, 10) / 10000),
      ym: (xtag(b, "dealYear") + xtag(b, "dealMonth").padStart(2, "0")) || ymFallback,
      d: xtag(b, "dealDay").padStart(2, "0"), floor: xtag(b, "floor"),
      ownership: gbn === "분" ? "분양권" : gbn === "입" ? "입주권" : "",
      direct: xtag(b, "dealingGbn").includes("직") ? 1 : 0,
    });
  }
  return items;
}

export function parseRent(xml, ymFallback) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const apt = xtag(b, "aptNm");
    if (!apt) continue;
    const depositRaw = xtag(b, "deposit").replace(/,/g, "");
    if (!depositRaw) continue;
    const monthlyRentRaw = xtag(b, "monthlyRent").replace(/,/g, "");
    if (monthlyRentRaw && parseInt(monthlyRentRaw, 10) > 0) continue;
    const area = parseFloat(xtag(b, "excluUseAr")) || 0;
    items.push({
      apt, umd: xtag(b, "umdNm"), area, py: areaToPy(Math.round(area)),
      amt: R1(parseInt(depositRaw, 10) / 10000),
      ym: (xtag(b, "dealYear") + xtag(b, "dealMonth").padStart(2, "0")) || ymFallback,
      d: xtag(b, "dealDay").padStart(2, "0"), floor: xtag(b, "floor"), build: xtag(b, "buildYear"),
    });
  }
  return items;
}

// 응답 실패 판정 — data.go.kr은 정상이든 오류든 항상 <header>를 달고 응답하기 때문에, 예전처럼
// "<header>나 SERVICE 문자열이 있으면 성공"으로 보면 호출 한도 초과·키 오류 같은 에러 응답까지
// "거래 0건인 정상적인 달"로 통과해버린다. 배치(collect-trades.mjs)는 그 0건을 그대로 파일로 저장하고
// git에 커밋하므로, 실제로는 거래가 있는 달이 통째로 빈 채 박제된다
// (2026.09 발견 — 강남구 202608이 0건으로 저장돼 있었고, 같은 1분 사이에 조회된 화성 병점구도 동일).
// resultCode로 판정하되, 모르는 성공 코드 때문에 전부 실패 처리되는 일이 없도록 "확실한 오류"만
// 실패로 본다 — 실패로 보면 파일을 안 남기고 다음 실행 때 재시도하므로 데이터가 오염되지 않는다.
export function rtmsFailed(t) {
  if (!t) return true;
  if (/<item[\s>]/.test(t)) return false;                        // 거래 데이터가 실제로 들어있음
  if (/<totalCount>\s*0\s*<\/totalCount>/.test(t)) return false; // 거래가 정말 없는 달(정상 빈 응답)
  const m = t.match(/<resultCode>\s*([^<]*?)\s*<\/resultCode>/);
  if (m) return m[1].replace(/^0+/, "") !== "";                  // 00/000/0 만 정상, 그 외는 오류코드
  return true;                                                   // header도 resultCode도 없는 이상한 응답
}

export async function fetchText(rtmsUrl, key, lawd, ym, retries = 2, timeoutMs = 20000) {
  for (let i = 0; i <= retries; i++) {
    try {
      // 요청당 20초 타임아웃: data.go.kr이 응답 없이 커넥션만 붙잡고 있으면 이 워커가 무한정
      // 막혀서 pool() 전체가 안 끝나고(=Promise.all이 절대 resolve 안 됨) 300분을 그냥 날리게 되는 걸 방지
      const r = await fetch(`${rtmsUrl}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=2000&pageNo=1`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const t = await r.text();
      if (!rtmsFailed(t)) return { text: t, failed: false };
      if (i === retries) return { text: t || "", failed: true };
    } catch (e) {
      if (i === retries) return { text: "", failed: true }; // 타임아웃(AbortError)도 여기서 실패로 잡혀 재시도됨
    }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return { text: "", failed: true };
}
