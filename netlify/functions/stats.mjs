// Netlify Function — 상세 방문자 통계 조회 (stats.html 전용)
// 관리자 세션이 확인된 요청만 Netlify Blobs의 집계 데이터를 읽을 수 있다.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/stats",
};

const COOKIE_NAME = "__Host-aptsum_stats";
const PAGES = [
  { page: "index", label: "메인 (실거래 분석)" },
  { page: "tier", label: "급지 분석" },
  { page: "subway", label: "교통 호재" },
];
const TREND_DAYS = 14;

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

function getCookie(request, name) {
  const prefix = \`\${name}=\`;
  return (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function equal(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function hasValidSession(request, secret) {
  const value = getCookie(request, COOKIE_NAME);
  if (!value) return false;

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!equal(signature, expected)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isInteger(exp) && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function ymd(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

  const store = getStore("visits");
  const now = new Date();
  const today = ymd(now);

  const trendDates = Array.from({ length: TREND_DAYS }, (_, i) => {
    const d = new Date(now.getTime() - (TREND_DAYS - 1 - i) * 24 * 60 * 60 * 1000);
    return ymd(d);
  });

  const [totalRaw, todayRaw, trendRaw, pageRaws] = await Promise.all([
    store.get("total", { consistency: "strong" }),
    store.get(\`day-\${today}\`, { consistency: "strong" }),
    Promise.all(trendDates.map((d) => store.get(\`day-\${d}\`, { consistency: "strong" }))),
    Promise.all(
      PAGES.map((p) =>
        Promise.all([
          store.get(\`page:\${p.page}:total\`, { consistency: "strong" }),
          store.get(\`page:\${p.page}:day:\${today}\`, { consistency: "strong" }),
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

  return json({ total, today: todayCount, trend, pages });
};
