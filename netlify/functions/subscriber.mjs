import {
  COOKIE_NAME, MAX_AGE_SECONDS, sameValue, createSession, hasValidSession,
} from "../../shared/sessions.mjs";
import { createLoginThrottle, tooManyAttempts } from "../../shared/login-throttle.mjs";

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

  // 로그인 시도 제한 — 5번 틀리면 30분 잠금(shared/login-throttle.mjs)
  const throttle = createLoginThrottle("subscriber-throttle", request, context, sessionSecret);
  const lockedFor = await throttle.lockedFor();
  if (lockedFor) return tooManyAttempts(response, lockedFor);

  const code = payload?.code;
  if (typeof code !== "string" || code.length > 256 || !sameValue(code, accessCode)) {
    const r = await throttle.fail();
    if (r.locked) return tooManyAttempts(response, r.retryAfter);
    return response({ error: "invalid_code", remaining: r.remaining }, { status: 401 });
  }
  await throttle.success();

  const token = createSession(sessionSecret, accessCode);
  return response(
    { subscribed: true },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
};
