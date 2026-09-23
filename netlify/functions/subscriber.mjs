import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  COOKIE_NAME, MAX_AGE_SECONDS, sameValue, createSession, hasValidSession,
} from "../../shared/sessions.mjs";

// 로그인 시도 제한(2026.09, 운영자 요청) — 같은 IP에서 접근 코드를 5번 틀리면 30분 동안 로그인 시도를
// 막는다(무작위 대입 방지). 성공하면 기록을 지운다. IP는 원문 대신 비밀키와 섞은 해시로만 저장한다.
// 저장소(Netlify Blobs) 오류로 로그인 자체가 막히지 않도록 기록 실패는 무시한다(fail-open).
export const MAX_FAILS = 5;
export const LOCK_MS = 30 * 60 * 1000;
const throttleStore = () => getStore("subscriber-throttle");

function clientIp(request, context) {
  return context?.ip
    || request.headers.get("x-nf-client-connection-ip")
    || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}
function throttleKey(ip, secret) {
  return "ip:" + createHash("sha256").update(`${secret}|${ip}`).digest("base64url").slice(0, 32);
}
async function readThrottle(key) {
  try { return (await throttleStore().get(key, { type: "json", consistency: "strong" })) || null; }
  catch { return null; }
}
async function writeThrottle(key, value) {
  try { value ? await throttleStore().setJSON(key, value) : await throttleStore().delete(key); }
  catch { /* fail-open */ }
}

export const config = {
  path: "/api/subscriber",
};

function response(body, { status = 200, headers = {} } = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Vary": "Cookie",
      ...headers,
    },
  });
}

function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export default async (request, context) => {
  const accessCode = process.env.SUBSCRIBER_CODE;
  const sessionSecret = process.env.SUBSCRIBER_SESSION_SECRET;

  if (!accessCode || !sessionSecret) {
    return response({ error: "subscriber_auth_not_configured" }, { status: 503 });
  }

  if (request.method === "GET") {
    return response({ subscribed: hasValidSession(request, sessionSecret, accessCode) });
  }

  if (request.method !== "POST") {
    return response(
      { error: "method_not_allowed" },
      { status: 405, headers: { "Allow": "GET, POST" } }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return response({ error: "invalid_request" }, { status: 400 });
  }

  const key = throttleKey(clientIp(request, context), sessionSecret);
  const now = Date.now();
  const stored = await readThrottle(key);
  // 잠금이 풀렸거나, 마지막 실패 후 30분이 지났으면 실패 횟수를 새로 센다(띄엄띄엄 틀린 것까지 누적되지 않게)
  const expired = stored && ((stored.lockedUntil && stored.lockedUntil <= now) || (!stored.lockedUntil && now - (stored.lastFail || 0) > LOCK_MS));
  const record = expired ? null : stored;
  if (record && record.lockedUntil > now) {
    const retryAfter = Math.ceil((record.lockedUntil - now) / 1000);
    return response({ error: "too_many_attempts", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const code = payload?.code;
  if (typeof code !== "string" || code.length > 256 || !sameValue(code, accessCode)) {
    const fails = (record?.fails || 0) + 1;
    const locked = fails >= MAX_FAILS;
    await writeThrottle(key, { fails, lastFail: now, lockedUntil: locked ? now + LOCK_MS : 0 });
    if (locked) {
      const retryAfter = Math.ceil(LOCK_MS / 1000);
      return response({ error: "too_many_attempts", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    }
    return response({ error: "invalid_code", remaining: MAX_FAILS - fails }, { status: 401 });
  }
  if (stored) await writeThrottle(key, null);

  const token = createSession(sessionSecret, accessCode);
  return response(
    { subscribed: true },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
};
