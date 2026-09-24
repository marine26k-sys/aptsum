// 구독자별 개인 코드 관리 — 2026.09 신규. 관리자(통계) 세션이 있어야 쓸 수 있다(stats.html에서 호출).
//
//   GET                                   구독자 목록(이름·코드·만료일·최근 30일 접속 기기 수·마지막 접속)
//   POST {action:"create", name, expires}  새 코드 발급(expires: "YYYY-MM-DD" 또는 빈 값=무기한)
//   POST {action:"expires", id, expires}   만료일 변경
//   POST {action:"revoke", id}             해지 — 그 사람은 즉시 로그아웃되고 코드로도 다시 못 들어온다
//   POST {action:"restore", id}            해지 취소
//   POST {action:"reissue", id}            코드 새로 바꾸기 — 옛 코드·기존 로그인 기기 모두 무효(공유 의심 시)
//   POST {action:"delete", id}             목록에서 삭제
import { hasValidStatsSession } from "../../shared/sessions.mjs";
import {
  subscriberStore, getSubscriber, normalizeCode, expiryFromDate, loadDevices, clearDevices, assignCode, createSubscriber,
} from "../../shared/subscribers.mjs";

export const config = { path: "/api/subscribers" };

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });

function view(sub, seen = []) {
  return {
    id: sub.id, name: sub.name, code: sub.code, createdAt: sub.createdAt, expiresAt: sub.expiresAt || null,
    revoked: !!sub.revoked, devices: seen.length, lastSeen: seen.length ? Math.max(...seen) : null,
  };
}

export default async (request) => {
  const secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!secret) return json({ error: "auth_not_configured" }, 503);
  if (!hasValidStatsSession(request, secret)) return json({ error: "stats_auth_required" }, 401);

  const store = subscriberStore();

  if (request.method === "GET") {
    const { blobs } = await store.list({ prefix: "sub:" });
    const subs = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json", consistency: "strong" })))).filter(Boolean);
    subs.sort((a, b) => b.createdAt - a.createdAt);
    const devices = await loadDevices();
    return json({ subscribers: subs.map((s) => view(s, devices.get(s.id))), sharedCodeEnabled: !!process.env.SUBSCRIBER_CODE });
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = body?.action;

  if (action === "create") {
    const name = String(body.name || "").trim().slice(0, 40);
    if (!name) return json({ error: "name_required" }, 400);
    const expiresAt = expiryFromDate(body.expires);
    if (Number.isNaN(expiresAt)) return json({ error: "invalid_expires" }, 400);
    const sub = await createSubscriber({ name, expiresAt }, store);
    return json({ subscriber: view(sub) });
  }

  const sub = await getSubscriber(String(body?.id || ""));
  if (!sub) return json({ error: "not_found" }, 404);

  if (action === "expires") {
    const expiresAt = expiryFromDate(body.expires);
    if (Number.isNaN(expiresAt)) return json({ error: "invalid_expires" }, 400);
    sub.expiresAt = expiresAt;
  } else if (action === "revoke") {
    sub.revoked = true;
  } else if (action === "restore") {
    sub.revoked = false;
  } else if (action === "reissue") {
    await store.delete(`code:${normalizeCode(sub.code)}`);
    await assignCode(store, sub);
    sub.gen = (sub.gen || 1) + 1; // 기존 로그인 세션 무효화
    await clearDevices(sub.id);
  } else if (action === "delete") {
    await store.delete(`code:${normalizeCode(sub.code)}`);
    await store.delete(`sub:${sub.id}`);
    await clearDevices(sub.id);
    return json({ deleted: true });
  } else {
    return json({ error: "invalid_action" }, 400);
  }

  await store.setJSON(`sub:${sub.id}`, sub);
  return json({ subscriber: view(sub) });
};
