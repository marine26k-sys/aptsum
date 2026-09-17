// Netlify Function — 정확한 방문 통계 집계 (단일 원자적 ledger)
// 같은 방문의 중복 판정과 전체·일별·페이지별 합계를 하나의 조건부 쓰기로 갱신한다.
// 따라서 중간 실패 뒤 재요청해도 일부 카운터만 누락되거나 중복 증가하지 않는다.
import { createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/visits" };
const KNOWN_PAGES = ["index", "tier", "subway"];
const MAX_RETRIES = 8;
const LEDGER_KEY = "v2";

function ymd(date) { return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
function count(value) { return parseInt(value, 10) || 0; }
function fingerprint(context, req, day) {
  const ip = context?.ip, secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(`${day}\\n${ip}\\n${req.headers.get("user-agent") || ""}`).digest("base64url");
}
async function legacyBaseline(day) {
  const old = getStore("visits");
  const [total, today, pages] = await Promise.all([
    old.get("total", { consistency: "strong" }), old.get(`day-${day}`, { consistency: "strong" }),
    Promise.all(KNOWN_PAGES.map((page) => Promise.all([
      old.get(`page:${page}:total`, { consistency: "strong" }), old.get(`page:${page}:day:${day}`, { consistency: "strong" }),
    ]))),
  ]);
  return { total: count(total), today: count(today), pages: Object.fromEntries(KNOWN_PAGES.map((page, i) => [page, { total: count(pages[i][0]), today: count(pages[i][1]) }])) };
}
function initial(day, baseline) {
  return { version: 2, total: baseline.total, pageTotals: Object.fromEntries(KNOWN_PAGES.map((p) => [p, baseline.pages[p].total])), days: { [day]: { total: baseline.today, pages: Object.fromEntries(KNOWN_PAGES.map((p) => [p, baseline.pages[p].today])) } }, seenDay: day, seen: {} };
}
function normalize(data, day) {
  const state = data && typeof data === "object" ? data : { version: 2, total: 0, pageTotals: {}, days: {}, seenDay: day, seen: {} };
  state.pageTotals ||= {}; state.days ||= {}; state.seen ||= {};
  for (const page of KNOWN_PAGES) state.pageTotals[page] ||= 0;
  if (state.seenDay !== day) { state.seenDay = day; state.seen = {}; }
  state.days[day] ||= { total: 0, pages: {} };
  for (const page of KNOWN_PAGES) state.days[day].pages[page] ||= 0;
  return state;
}
async function recordVisit(day, page, visitor) {
  const store = getStore("visit-ledger");
  let baseline;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const entry = await store.getWithMetadata(LEDGER_KEY, { consistency: "strong" });
    const state = entry ? normalize(JSON.parse(entry.data), day) : initial(day, baseline ||= await legacyBaseline(day));
    state.seen[page] ||= {};
    const duplicate = visitor && state.seen[page][visitor];
    if (!duplicate) {
      if (visitor) state.seen[page][visitor] = 1;
      state.total += 1; state.pageTotals[page] += 1; state.days[day].total += 1; state.days[day].pages[page] += 1;
    }
    const saved = await store.set(LEDGER_KEY, JSON.stringify(state), entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (saved.modified) return { total: state.total, today: state.days[day].total };
  }
  throw new Error("visit_ledger_contention");
}
export default async (req, context) => {
  if (req.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
  const page = KNOWN_PAGES.includes(new URL(req.url).searchParams.get("page")) ? new URL(req.url).searchParams.get("page") : "index";
  try { return Response.json(await recordVisit(ymd(new Date()), page, fingerprint(context, req, ymd(new Date()))), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { console.error("visit ledger failed", error); return Response.json({ error: "visit_count_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
};
