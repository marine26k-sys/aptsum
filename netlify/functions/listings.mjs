import { getStore } from "@netlify/blobs";
import { hasValidStatsSession } from "../../shared/sessions.mjs";
import { getSubscriberSession } from "../../shared/subscribers.mjs";
import { REGIONS, ALL_LAWDS } from "../../shared/regions.mjs";

// 구독 전용 "저평가 실매물 (입주가능, 중층 이상)" 탭 데이터 — 2026.09 신규.
//
// 운영자가 stats.html에서 네이버 실매물 크롤링 엑셀을 올리면, 브라우저가 단지·전용면적별로 요약(조회 시점까지
// 실거래 최고가 + 입주가능·중층 이상 최저 호가)한 결과만 이 함수로 보내고, 여기서 지역(lawd)별로 Netlify Blobs에 저장한다.
// 원본 엑셀·요약 데이터 모두 GitHub(=정적 배포 루트)에 올리지 않기 위한 구조다.
//
//   GET  ?lawd=<코드>   구독자(또는 관리자) 세션 필요 — 그 지역 요약 {asOf, items}. 단 TRIAL_LAWDS(강남구)는 누구나
//   GET  ?lawd=<코드>&history=1   같은 지역 인증 규칙으로 최근 12회 업로드의 최저 호가 이력 조회
//   GET  ?meta=1        관리자 세션 필요 — 마지막 업로드 정보
//   POST {action:"put", uploadId, asOf, regions:{"시|구": items[]}}  관리자 — 지역 묶음 저장(여러 번 나눠 보냄)
//   POST {action:"finish", uploadId, asOf, lawds[], rows, types}     관리자 — 이번 업로드에 없는 지역 삭제·메타 기록
//
// 요청 본문 한도(약 6MB) 때문에 put은 클라이언트가 1MB 안팎으로 쪼개 보낸다.
export const config = {
  path: "/api/listings",
};

const LAWDS = new Set(ALL_LAWDS);
const TRIAL_LAWDS = new Set(["11680"]); // 인증 없이 무료 체험으로 열어 두는 지역(강남구) — index.html의 LISTING_TRIAL_LAWD와 같게 유지
const GU_TO_LAWD = new Map();
for (const [si, list] of REGIONS) for (const [gu, code] of list) GU_TO_LAWD.set(`${si}|${gu}`, code);

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" },
  });
}

const str = (v, max = 200) => String(v ?? "").slice(0, max);
const num = (v) => (Number.isFinite(+v) ? +v : null);
const historyKey = (lawd, uploadId) => `history:${lawd}:${uploadId}`;
const historyIndexKey = (lawd) => `history-index:${lawd}`;

// 같은 기준일을 다시 올려도 직전 날짜와 비교할 수 있게 날짜별 마지막 업로드만 조회한다.
// 원본 스냅샷과 색인은 모두 보존한다.
export function dailyHistoryIndex(index) {
  const days = new Map();
  for (const x of index) {
    const date = String(x.asOf || "").replace(/[^0-9]/g, "");
    const key = date.length === 8 ? date : `upload:${x.uploadId}`;
    days.set(key, x);
  }
  return [...days.values()];
}

export async function saveSnapshot(store, lawd, data) {
  if (!data?.uploadId || !Array.isArray(data.items)) return;
  const indexKey = historyIndexKey(lawd);
  const index = (await store.get(indexKey, { type: "json", consistency: "strong" })) || [];
  if (index.some(x => x.uploadId === data.uploadId)) return;
  await store.setJSON(historyKey(lawd, data.uploadId), data);
  index.push({ uploadId: data.uploadId, asOf: data.asOf || "" });
  await store.setJSON(indexKey, index);
}

// 클라이언트가 보낸 항목을 필요한 필드만 남겨 정리한다(엉뚱한 값·과대 문자열이 저장되지 않도록).
export function cleanItem(x) {
  const peak = num(x?.peak), ask = num(x?.ask), ex = num(x?.ex);
  if (!(peak > 0) || !(ask > 0) || !(ex > 0)) return null;
  const url = str(x.url, 300);
  return {
    nid: str(x.nid, 20), apt: str(x.apt, 80), umd: str(x.umd, 30), hh: num(x.hh), built: str(x.built, 10),
    occupancy: x.occupancy === "tenant" ? "tenant" : "available",
    ex, py: num(x.py), peak, peakYm: str(x.peakYm, 6), ask, n: num(x.n) || 1,
    fl: str(x.fl, 12), dong: str(x.dong, 20), d: str(x.d, 8), urgent: x.urgent ? 1 : 0,
    url: /^https:\/\/(fin\.land|new\.land|m\.land|land)\.naver\.com\//.test(url) ? url : "",
  };
}

export function snapshotForHistory(data, occupancy, details = false) {
  if (!data) return null;
  const items = (data.items || []).filter(i => (i.occupancy || "available") === occupancy);
  return { asOf:data.asOf, uploadId:data.uploadId,
    items:details ? items : items.map(i => ({nid:i.nid, ex:i.ex, ask:i.ask})) };
}

export default async (request) => {
  const secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!secret) return json({ error: "auth_not_configured" }, 503);
  const store = getStore("listings");
  const isAdmin = hasValidStatsSession(request, secret);

  if (request.method === "GET") {
    const q = new URL(request.url).searchParams;
    if (q.get("meta")) {
      if (!isAdmin) return json({ error: "stats_auth_required" }, 401);
      return json((await store.get("meta", { type: "json", consistency: "strong" })) || null);
    }
    const lawd = q.get("lawd") || "";
    if (!LAWDS.has(lawd)) return json({ error: "invalid_lawd" }, 400);
    // 무료 체험(2026.09 운영자 요청): 강남구는 인증 없이도 조회 가능 — 나머지 지역은 구독자·관리자만
    if (!TRIAL_LAWDS.has(lawd) && !isAdmin && !(await getSubscriberSession(request, secret))) return json({ error: "subscriber_required" }, 401);
    const occupancy = q.get("occupancy") || "available";
    if (!["available", "tenant"].includes(occupancy)) return json({error:"invalid_occupancy"},400);
    const selectedItems = items => (items || []).filter(i => (i.occupancy || "available") === occupancy);
    if (q.get("history") === "1") {
      const index = (await store.get(historyIndexKey(lawd), { type: "json", consistency: "strong" })) || [];
      // 기준일별 마지막 업로드에서 최신 12일분만 전송한다. 저장된 스냅샷은 삭제하지 않는다.
      const recent = dailyHistoryIndex(index).slice(-12);
      const recentIds = new Set(recent.map(x => x.uploadId));
      const detailIds = new Set(index.filter(x => recentIds.has(x.uploadId)).slice(-3).map(x => x.uploadId));
      const snapshots = await Promise.all(recent.map(async x => {
        const data = await store.get(historyKey(lawd, x.uploadId), { type: "json", consistency: "strong" });
        return snapshotForHistory(data, occupancy, q.get("detail") === "1" && detailIds.has(x.uploadId));
      }));
      return json({ snapshots: snapshots.filter(Boolean) });
    }
    const data = await store.get(`lawd:${lawd}`, { type: "json", consistency: "strong" });
    return json(data ? {...data,items:selectedItems(data.items)} : { asOf: null, items: [] }); // 업로드된 엑셀에 없는 지역 — 오류가 아니라 "매물 없음"
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAdmin) return json({ error: "stats_auth_required" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const uploadId = str(body?.uploadId, 40), asOf = str(body?.asOf, 10);
  if (!uploadId) return json({ error: "invalid_upload" }, 400);

  if (body.action === "put") {
    const saved = [], unknown = [];
    for (const [key, items] of Object.entries(body.regions || {})) {
      const lawd = GU_TO_LAWD.get(key);
      if (!lawd) { unknown.push(key); continue; }
      const clean = (Array.isArray(items) ? items : []).map(cleanItem).filter(Boolean);
      const latestKey = `lawd:${lawd}`;
      const previous = await store.get(latestKey, { type: "json", consistency: "strong" });
      // 배포 전 최신본도 첫 새 업로드 때 이력으로 편입한다.
      if (previous) await saveSnapshot(store, lawd, previous);
      const next = { asOf, uploadId, items: clean };
      await saveSnapshot(store, lawd, next);
      await store.setJSON(latestKey, next);
      saved.push(lawd);
    }
    return json({ saved, unknown });
  }

  if (body.action === "finish") {
    const keep = new Set((body.lawds || []).filter((l) => LAWDS.has(l)));
    // 이전 업로드에만 있던 지역은 지워야 옛 호가가 계속 보이지 않는다.
    const { blobs } = await store.list({ prefix: "lawd:" });
    const removed = [];
    for (const b of blobs) {
      const lawd = b.key.slice(5);
      if (!keep.has(lawd)) { await store.delete(b.key); removed.push(lawd); }
    }
    const meta = {
      uploadId, asOf, uploadedAt: new Date().toISOString(), regions: keep.size,
      rows: num(body.rows), types: num(body.types), fileName: str(body.fileName, 120),
    };
    await store.setJSON("meta", meta);
    return json({ ok: true, removed, meta });
  }

  return json({ error: "invalid_action" }, 400);
};
