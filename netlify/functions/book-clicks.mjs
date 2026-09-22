// Netlify Function — 추천 부동산 서적(쿠팡 파트너스 배너) 클릭 집계 — 2026.09 신규.
//
//   POST {book, page}  클릭 기록(assets/book-clicks.js가 sendBeacon으로 보냄) — 인증 없음
//   GET                관리자(통계) 세션 필요 — 책별 누적·오늘·최근 14일, 페이지별 누적
//
// 같은 사람(IP+브라우저)이 같은 책을 하루에 여러 번 눌러도 1회로 센다 — 방문 통계(visits.mjs)와 같은 방식.
// 새로고침 연타·감지 중복·악의적 반복 호출로 수치가 부풀지 않게 하기 위함. 전체 집계는 하나의 ledger를
// 조건부 쓰기(etag)로 갱신해 동시 요청에서도 카운트가 유실되지 않는다.
import { createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { hasValidStatsSession } from "../../shared/sessions.mjs";

export const config = { path: "/api/book-clicks" };

// 배너에 들어간 책(쿠팡 링크 코드) — couponBannerHTML()의 순서와 같게 유지할 것.
const BOOKS = [
  { book: "cpwXdE", label: "왼쪽 책" },
  { book: "cpwXWl", label: "가운데 책" },
  { book: "cpwYpC", label: "오른쪽 책" },
];
const BOOK_IDS = new Set(BOOKS.map((b) => b.book));
const PAGES = [
  { page: "index", label: "메인 (실거래 분석)" },
  { page: "subway", label: "교통 호재" },
];
const PAGE_IDS = new Set(PAGES.map((p) => p.page));
const LEDGER_KEY = "v1";
const MAX_RETRIES = 8;
const TREND_DAYS = 14;
const KEEP_DAYS = 400; // 일별 기록은 약 1년치만 보관(ledger 크기 제한)

const ymd = (date) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });

function fingerprint(context, req, day) {
  const ip = context?.ip, secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(`book\n${day}\n${ip}\n${req.headers.get("user-agent") || ""}`).digest("base64url");
}

function normalize(data, day) {
  const s = data && typeof data === "object" ? data : { version: 1, totals: {}, pageTotals: {}, days: {}, seenDay: day, seen: {} };
  s.totals ||= {}; s.pageTotals ||= {}; s.days ||= {}; s.seen ||= {};
  if (s.seenDay !== day) {
    s.seenDay = day; s.seen = {};
    const cutoff = ymd(new Date(Date.now() - KEEP_DAYS * 86400000));
    for (const d of Object.keys(s.days)) if (d < cutoff) delete s.days[d];
  }
  s.days[day] ||= {};
  return s;
}

async function record(day, book, page, visitor) {
  const store = getStore("book-clicks");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const entry = await store.getWithMetadata(LEDGER_KEY, { consistency: "strong" });
    const s = normalize(entry ? JSON.parse(entry.data) : null, day);
    const seenKey = `${book}:${visitor}`;
    if (visitor && s.seen[seenKey]) return { counted: false };
    if (visitor) s.seen[seenKey] = 1;
    s.totals[book] = (s.totals[book] || 0) + 1;
    s.pageTotals[page] ||= {};
    s.pageTotals[page][book] = (s.pageTotals[page][book] || 0) + 1;
    s.days[day][book] = (s.days[day][book] || 0) + 1;
    const saved = await store.set(LEDGER_KEY, JSON.stringify(s), entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (saved.modified) return { counted: true };
  }
  throw new Error("book_click_ledger_contention");
}

async function summary() {
  const raw = await getStore("book-clicks").get(LEDGER_KEY, { consistency: "strong" });
  const s = raw ? JSON.parse(raw) : { totals: {}, pageTotals: {}, days: {} };
  const now = new Date();
  const today = ymd(now);
  const dates = Array.from({ length: TREND_DAYS }, (_, i) => ymd(new Date(now.getTime() - (TREND_DAYS - 1 - i) * 86400000)));
  return {
    books: BOOKS.map((b) => ({
      ...b,
      total: s.totals?.[b.book] || 0,
      today: s.days?.[today]?.[b.book] || 0,
      pages: PAGES.map((p) => ({ ...p, total: s.pageTotals?.[p.page]?.[b.book] || 0 })),
    })),
    trend: dates.map((date) => ({ date, count: BOOKS.reduce((n, b) => n + (s.days?.[date]?.[b.book] || 0), 0) })),
  };
}

export default async (req, context) => {
  if (req.method === "GET") {
    const secret = process.env.SUBSCRIBER_SESSION_SECRET;
    if (!secret) return json({ error: "stats_auth_not_configured" }, 503);
    if (!hasValidStatsSession(req, secret)) return json({ error: "stats_auth_required" }, 401);
    return json(await summary());
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body;
  try { body = JSON.parse(await req.text()); } catch { return json({ error: "invalid_json" }, 400); }
  const book = String(body?.book || ""), page = String(body?.page || "");
  if (!BOOK_IDS.has(book) || !PAGE_IDS.has(page)) return json({ error: "invalid_book" }, 400);
  const day = ymd(new Date());
  try {
    return json(await record(day, book, page, fingerprint(context, req, day)));
  } catch (error) {
    console.error("book click ledger failed", error);
    return json({ error: "book_click_unavailable" }, 503);
  }
};
