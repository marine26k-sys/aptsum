// 로그인 시도 제한(2026.09, 운영자 요청) — 같은 IP에서 코드를 5번 틀리면 30분 동안 로그인 시도를 막는다
// (무작위 대입 방지). 성공하면 기록을 지운다. IP는 원문 대신 비밀키와 섞은 해시로만 저장한다.
// 저장소(Netlify Blobs) 오류로 로그인 자체가 막히지 않도록 기록 실패는 무시한다(fail-open).
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const MAX_FAILS = 5;
export const LOCK_MS = 30 * 60 * 1000;

function clientIp(request, context) {
  return context?.ip
    || request.headers.get("x-nf-client-connection-ip")
    || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

// storeName: 비공개 탭은 "subscriber-throttle", 관리자(stats.html)는 "stats-throttle" — 한쪽에서 잠겨도
// 다른 쪽 로그인에는 영향이 없도록 저장소를 분리한다.
export function createLoginThrottle(storeName, request, context, secret) {
  const store = () => getStore(storeName);
  const key = "ip:" + createHash("sha256").update(`${secret}|${clientIp(request, context)}`).digest("base64url").slice(0, 32);
  let stored = null;
  let record = null;

  async function write(value) {
    try { value ? await store().setJSON(key, value) : await store().delete(key); }
    catch { /* fail-open */ }
  }

  return {
    // 잠겨 있으면 남은 초, 아니면 0
    async lockedFor() {
      try { stored = (await store().get(key, { type: "json", consistency: "strong" })) || null; }
      catch { stored = null; }
      const now = Date.now();
      // 잠금이 풀렸거나, 마지막 실패 후 30분이 지났으면 실패 횟수를 새로 센다(띄엄띄엄 틀린 것까지 누적되지 않게)
      const expired = stored && ((stored.lockedUntil && stored.lockedUntil <= now) || (!stored.lockedUntil && now - (stored.lastFail || 0) > LOCK_MS));
      record = expired ? null : stored;
      return record && record.lockedUntil > now ? Math.ceil((record.lockedUntil - now) / 1000) : 0;
    },
    // 실패 기록 — 이번에 잠겼으면 { locked: true, retryAfter }, 아니면 { locked: false, remaining }
    async fail() {
      const now = Date.now();
      const fails = (record?.fails || 0) + 1;
      const locked = fails >= MAX_FAILS;
      await write({ fails, lastFail: now, lockedUntil: locked ? now + LOCK_MS : 0 });
      return locked ? { locked: true, retryAfter: Math.ceil(LOCK_MS / 1000) } : { locked: false, remaining: MAX_FAILS - fails };
    },
    async success() {
      if (stored) await write(null);
    },
  };
}

export function tooManyAttempts(json, retryAfter) {
  return json({ error: "too_many_attempts", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}
