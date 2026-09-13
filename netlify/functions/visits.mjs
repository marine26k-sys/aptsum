// Netlify Function — 방문자 카운터 (Netlify Blobs 기반)
// 기존 visitor-badge.laobi.icu(제3자 뱃지 이미지 서비스) 대체 — 새로고침마다 중복 카운트되고
// 광고 차단기에 이미지 트래킹 픽셀로 오인돼 막히는 문제가 있어, 자체 서버리스 함수 + Netlify Blobs로 교체.
// 정확한 유니크 방문자 집계가 아니라 페이지 로드 수 카운트(기존 뱃지와 동일한 개념)이며,
// 동시 요청 시 정확히 원자적이진 않지만(get→set) 개인 트래픽 규모에서는 문제되지 않음.
// ?page= 쿼리로 페이지별 카운트도 함께 쌓아서 /api/stats(상세 통계 페이지)에서 페이지별 분석에 사용.
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/visits",
};

const KNOWN_PAGES = ["index", "tier", "subway"];

// 일일 카운터 키를 한국 시간(KST, UTC+9) 자정 기준으로 끊기 위한 헬퍼 — 9시간을 더한 뒤
// toISOString()으로 UTC 구성요소를 읽으면 그게 곧 원래 시각의 KST 날짜가 된다.
function kstYmd(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async (req) => {
  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page");
  const page = KNOWN_PAGES.includes(pageParam) ? pageParam : "index";

  const store = getStore("visits");
  const today = kstYmd(new Date()); // 한국 시간(KST) 자정 기준 일일 카운터 키(2026.09부터 UTC→KST로 변경)

  // consistency: "strong" 필수 — 기본값(eventual)은 방금 쓴 값을 바로 못 읽어와 계속 0으로 보일 수 있음
  const [totalRaw, todayRaw, pageTotalRaw, pageTodayRaw] = await Promise.all([
    store.get("total", { consistency: "strong" }),
    store.get(`day-${today}`, { consistency: "strong" }),
    store.get(`page:${page}:total`, { consistency: "strong" }),
    store.get(`page:${page}:day:${today}`, { consistency: "strong" }),
  ]);

  const total = (parseInt(totalRaw, 10) || 0) + 1;
  const todayCount = (parseInt(todayRaw, 10) || 0) + 1;
  const pageTotal = (parseInt(pageTotalRaw, 10) || 0) + 1;
  const pageToday = (parseInt(pageTodayRaw, 10) || 0) + 1;

  await Promise.all([
    store.set("total", String(total)),
    store.set(`day-${today}`, String(todayCount)),
    store.set(`page:${page}:total`, String(pageTotal)),
    store.set(`page:${page}:day:${today}`, String(pageToday)),
  ]);

  return new Response(JSON.stringify({ total, today: todayCount }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
