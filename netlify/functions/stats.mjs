// Netlify Function — 상세 방문자 통계 조회 (stats.html 전용)
// visits.mjs가 Netlify Blobs에 쌓아둔 전체/페이지별/일별 카운트를 읽어서 한 번에 내려줌.
// 쓰기는 하지 않고 읽기만 하는 함수라 consistency: "strong"으로 항상 최신값을 봄.
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/stats",
};

const PAGES = [
  { page: "index", label: "메인 (실거래 분석)" },
  { page: "tier", label: "급지 분석" },
  { page: "subway", label: "교통 호재" },
];

const TREND_DAYS = 14;

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

export default async () => {
  const store = getStore("visits");
  const now = new Date();
  const today = ymd(now);

  const trendDates = Array.from({ length: TREND_DAYS }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (TREND_DAYS - 1 - i));
    return ymd(d);
  });

  const [totalRaw, todayRaw, trendRaw, pageRaws] = await Promise.all([
    store.get("total", { consistency: "strong" }),
    store.get(`day-${today}`, { consistency: "strong" }),
    Promise.all(trendDates.map((d) => store.get(`day-${d}`, { consistency: "strong" }))),
    Promise.all(
      PAGES.map((p) =>
        Promise.all([
          store.get(`page:${p.page}:total`, { consistency: "strong" }),
          store.get(`page:${p.page}:day:${today}`, { consistency: "strong" }),
        ])
      )
    ),
  ]);

  const total = parseInt(totalRaw, 10) || 0;
  const todayCount = parseInt(todayRaw, 10) || 0;

  const trend = trendDates.map((date, i) => ({
    date,
    count: parseInt(trendRaw[i], 10) || 0,
  }));

  const pages = PAGES.map((p, i) => ({
    page: p.page,
    label: p.label,
    total: parseInt(pageRaws[i][0], 10) || 0,
    today: parseInt(pageRaws[i][1], 10) || 0,
  }));

  return new Response(JSON.stringify({ total, today: todayCount, trend, pages }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
