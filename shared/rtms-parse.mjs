// 국토부 실거래 XML 파싱 공용 유틸 — scripts/collect-trades.mjs 전용
// (netlify/functions/*.mjs의 로직과 동일하지만, 서버 함수 코드는 건드리지 않기 위해 별도 사본으로 둔다)

const PY_ANCHORS = [
  [39, 18], [49, 21], [59, 25], [74, 30], [84, 33],
  [99, 38], [110, 42], [130, 49], [150, 58], [165, 65],
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

export async function fetchText(rtmsUrl, key, lawd, ym, retries = 2, timeoutMs = 20000) {
  for (let i = 0; i <= retries; i++) {
    try {
      // 요청당 20초 타임아웃: data.go.kr이 응답 없이 커넥션만 붙잡고 있으면 이 워커가 무한정
      // 막혀서 pool() 전체가 안 끝나고(=Promise.all이 절대 resolve 안 됨) 300분을 그냥 날리게 되는 걸 방지
      const r = await fetch(`${rtmsUrl}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=2000&pageNo=1`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const t = await r.text();
      if (t && /<item[\s>]|<header>|SERVICE/.test(t)) return { text: t, failed: false };
      if (i === retries) return { text: t || "", failed: true };
    } catch (e) {
      if (i === retries) return { text: "", failed: true }; // 타임아웃(AbortError)도 여기서 실패로 잡혀 재시도됨
    }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return { text: "", failed: true };
}
