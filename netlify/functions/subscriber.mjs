import {
  sameValue, createSession, subscriberCookie as sessionCookie,
} from "../../shared/sessions.mjs";
import { createLoginThrottle, tooManyAttempts } from "../../shared/login-throttle.mjs";
import {
  findByCode, isActive, createPersonalSession, getSubscriberSession, touchDevice,
} from "../../shared/subscribers.mjs";

// 비공개 탭 로그인. 코드는 두 종류 — 공용 비번(SUBSCRIBER_CODE, 설정돼 있을 때만)과
// 운영자가 stats.html에서 발급한 구독자별 개인 코드(shared/subscribers.mjs).
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

export default async (request, context) => {
  const accessCode = process.env.SUBSCRIBER_CODE;
  const sessionSecret = process.env.SUBSCRIBER_SESSION_SECRET;

  if (!sessionSecret) {
    return response({ error: "subscriber_auth_not_configured" }, { status: 503 });
  }

  if (request.method === "GET") {
    const session = await getSubscriberSession(request, sessionSecret);
    if (session?.kind === "personal") await touchDevice(session.sub.id, session.did);
    return response({ subscribed: !!session });
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
  if (typeof code === "string" && code.length <= 256) {
    if (accessCode && sameValue(code, accessCode)) {
      await throttle.success();
      return response({ subscribed: true }, { headers: { "Set-Cookie": sessionCookie(createSession(sessionSecret, accessCode)) } });
    }
    const sub = await findByCode(code);
    if (sub) {
      // 해지·만료된 코드는 "맞는 코드"라 무작위 대입이 아니므로 시도 횟수에 넣지 않고 사유를 알려준다.
      if (!isActive(sub)) return response({ error: sub.revoked ? "code_revoked" : "code_expired" }, { status: 403 });
      await throttle.success();
      const { token, did, maxAge } = createPersonalSession(sessionSecret, sub);
      await touchDevice(sub.id, did, true);
      return response({ subscribed: true }, { headers: { "Set-Cookie": sessionCookie(token, maxAge) } });
    }
  }

  const r = await throttle.fail();
  if (r.locked) return tooManyAttempts(response, r.retryAfter);
  return response({ error: "invalid_code", remaining: r.remaining }, { status: 401 });
};
