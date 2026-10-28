// Netlify Function — 상세 방문자 통계 조회 (stats.html 전용)
// 관리자 세션이 확인된 요청만 Netlify Blobs의 집계 데이터를 읽을 수 있다.
import { hasValidStatsSession as hasValidSession } from "../../shared/sessions.mjs";
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/stats",
};

const PAGES = [
  { page: "index", label: "메인 (실거래 분석)" },
  { page: "tier", label: "급지 분석" },
  { page: "subway", label: "교통 호재" },
];
const TREND_DAYS = 30;

function json(data, { status = 200 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      vary: "Cookie",
    },
  });
}

function ymd(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function asCount(value) {
  const number = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isLedger(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.days && typeof value.days === "object"
    && value.pageTotals && typeof value.pageTotals === "object";
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const secret = process.env.SUBSCRIBER_SESSION_SECRET;
  const accessCode = process.env.STATS_ACCESS_CODE;
  if (!secret || !accessCode) {
    return json({ error: "stats_auth_not_configured" }, { status: 503 });
  }

  if (!hasValidSession(request, secret)) {
    return json({ error: "stats_auth_required" }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = ymd(now);

    const trendDates = Array.from({ length: TREND_DAYS }, (_, i) => {
      const d = new Date(now.getTime() - (TREND_DAYS - 1 - i) * 24 * 60 * 60 * 1000);
      return ymd(d);
    });

    // 원장이 있으면 한 번만 읽는다. JSON 손상이나 읽기 실패 시 과거 저장소로 복구한다.
    let ledger = null;
    try {
      const value = await getStore("visit-ledger").get("v2", { type: "json", consistency: "strong" });
      if (isLedger(value)) ledger = value;
      else if (value != null) console.error("stats ledger has an unexpected shape");
    } catch (error) {
      console.error("stats ledger read failed; falling back to legacy counters", error);
    }

    let total, todayCount, trend, pages;
    if (ledger) {
      total = asCount(ledger.total);
      todayCount = asCount(ledger.days?.[today]?.total);
      trend = trendDates.map((date) => ({ date, count: asCount(ledger.days?.[date]?.total) }));
      pages = PAGES.map((p) => ({
        page: p.page,
        label: p.label,
        total: asCount(ledger.pageTotals?.[p.page]),
        today: asCount(ledger.days?.[today]?.pages?.[p.page]),
      }));
    } else {
      // 원장이 만들어지기 전의 기존 저장 방식과 초기 누적 자료를 계속 지원한다.
      const store = getStore("visits");
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
      total = asCount(totalRaw);
      todayCount = asCount(todayRaw);
      trend = trendDates.map((date, i) => ({ date, count: asCount(trendRaw[i]) }));
      pages = PAGES.map((p, i) => ({
        page: p.page,
        label: p.label,
        total: asCount(pageRaws[i][0]),
        today: asCount(pageRaws[i][1]),
      }));
    }

    return json({ total, today: todayCount, trend, pages });
  } catch (error) {
    console.error("visitor stats request failed", error);
    return json({ error: "stats_data_unavailable" }, { status: 503 });
  }
};
