// 탭별 클릭 집계(2026.09, 운영자 요청) — 어떤 탭을 사람들이 실제로 누르는지 stats.html에서 보기 위한 것.
//
//   POST {tabs:["tabC","tabR",...]}  index.html이 페이지를 떠날 때(pagehide/숨김) 그 방문에서 누른 탭을 한 번에 보낸다
//                                    (navigator.sendBeacon — 탭을 누를 때마다 보내지 않아 요청 수가 방문 1회당 1번).
//   GET                              관리자 세션 필요 — 탭별 오늘/7일/30일 클릭 수 + 같은 기간 메인 페이지 방문자 수
//
// 같은 사람(하루 단위 IP+브라우저 해시, /api/visits와 같은 방식)이 같은 탭을 여러 번 눌러도 하루 1회로 센다.
// 그래서 "클릭 수 ÷ 방문자 수" = 그날 방문자 중 그 탭을 눌러 본 사람 비율이 된다.
//
// 저장소(Netlify Blobs "tab-clicks"):
//   count:<YYYY-MM-DD>  { tabId: n }          — 60일 보관
//   seen:<YYYY-MM-DD>   { 방문자해시: "tabC,tabR" } — 중복 판정용, 이틀 뒤 삭제
import { createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { hasValidStatsSession } from "../../shared/sessions.mjs";

export const config = { path: "/api/tab-clicks" };

// index.html 탭 id — 여기 없는 값은 버린다(아무 문자열이나 쌓이지 않도록)
export const TAB_IDS = [
  "tabC", "tabCmp", "tabTM", "tabSL", "tabSub",
  "tabR", "tabV", "tabPP", "tabGap",
  "tabNH", "tabLTR", "tabJLTR",
  "tabSU", "tabP", "tabLP", "tabINV",
  "tabLPL", "tabLBG", "tabLUR",
  "tabNL", "tabLPD", "tabNH7", "tabPBR",
  "tabApply",
];
const TAB_SET = new Set(TAB_IDS);
const MAX_RETRIES = 8;
const KEEP_COUNT_DAYS = 60;

const ymd = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });

function visitorHash(context, req, day) {
  const ip = context?.ip, secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(`tab|${day}|${ip}|${req.headers.get("user-agent") || ""}`).digest("base64url").slice(0, 16);
}

// 조건부 쓰기(etag)로 읽고-고치고-쓰기를 반복 — 동시에 여러 방문자가 보내도 숫자가 덮어써지지 않는다
async function update(store, key, fn) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const entry = await store.getWithMetadata(key, { consistency: "strong" });
    const data = entry ? JSON.parse(entry.data) : {};
    const result = fn(data);
    if (result === false) return false;
    const saved = await store.set(key, JSON.stringify(data), entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (saved.modified) return true;
  }
  throw new Error("tab_clicks_contention");
}

// 이번 요청에서 새로 센 탭만 돌려준다(같은 방문자가 이미 보낸 탭은 뺀다)
export async function recordTabs(store, day, visitor, tabs) {
  let fresh = tabs;
  if (visitor) {
    await update(store, `seen:${day}`, (seen) => {
      const had = new Set((seen[visitor] || "").split(",").filter(Boolean));
      fresh = tabs.filter((t) => !had.has(t));
      if (!fresh.length) return false;
      seen[visitor] = [...had, ...fresh].join(",");
    });
  }
  if (!fresh.length) return [];
  await update(store, `count:${day}`, (count) => { for (const t of fresh) count[t] = (count[t] || 0) + 1; });
  return fresh;
}

export default async (req, context) => {
  const store = getStore("tab-clicks");
  const now = Date.now();

  if (req.method === "POST") {
    let body;
    try { body = JSON.parse(await req.text()); } catch { return json({ error: "invalid_json" }, 400); }
    const tabs = [...new Set((Array.isArray(body?.tabs) ? body.tabs : []).filter((t) => TAB_SET.has(t)))];
    if (!tabs.length) return json({ ok: true, counted: [] });
    const day = ymd(now);
    try {
      return json({ ok: true, counted: await recordTabs(store, day, visitorHash(context, req, day), tabs) });
    } catch (e) {
      console.error("tab clicks failed", e);
      return json({ error: "unavailable" }, 503);
    }
  }

  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!secret) return json({ error: "auth_not_configured" }, 503);
  if (!hasValidStatsSession(req, secret)) return json({ error: "stats_auth_required" }, 401);

  const days = Array.from({ length: 30 }, (_, i) => ymd(now - i * 86400000)); // [오늘, 어제, ...]
  const counts = await Promise.all(days.map((d) => store.get(`count:${d}`, { type: "json", consistency: "strong" }).catch(() => null)));
  const sum = (n) => {
    const out = {};
    for (const c of counts.slice(0, n)) for (const [t, v] of Object.entries(c || {})) out[t] = (out[t] || 0) + v;
    return out;
  };
  // 같은 기간 메인 페이지 방문자 수(/api/visits가 쌓는 장부) — 비율의 분모
  let visitors = { d1: 0, d7: 0, d30: 0 };
  try {
    const ledger = await getStore("visit-ledger").get("v2", { type: "json", consistency: "strong" });
    const v = (n) => days.slice(0, n).reduce((a, d) => a + (ledger?.days?.[d]?.pages?.index || 0), 0);
    visitors = { d1: v(1), d7: v(7), d30: v(30) };
  } catch { /* 방문자 수가 없어도 클릭 수는 보여준다 */ }

  // 오래된 기록 정리(관리자가 볼 때 한 번씩) — 실패해도 조회에는 영향 없음
  const { blobs } = await store.list().catch(() => ({ blobs: [] }));
  const seenCut = ymd(now - 2 * 86400000), countCut = ymd(now - KEEP_COUNT_DAYS * 86400000);
  await Promise.all(blobs.filter(({ key }) => {
    const [kind, d] = key.split(":");
    return (kind === "seen" && d < seenCut) || (kind === "count" && d < countCut);
  }).map(({ key }) => store.delete(key).catch(() => {})));

  return json({ tabs: TAB_IDS, d1: sum(1), d7: sum(7), d30: sum(30), visitors, since: counts.findLastIndex((c) => c) });
};
