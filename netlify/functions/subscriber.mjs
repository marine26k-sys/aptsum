import {
  COOKIE_NAME, MAX_AGE_SECONDS, sameValue, createSession, hasValidSession,
} from "../../shared/sessions.mjs";

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

export default async (request) => {
  const accessCode = process.env.SUBSCRIBER_CODE;
  const sessionSecret = process.env.SUBSCRIBER_SESSION_SECRET;

  if (!accessCode || !sessionSecret) {
    return response({ error: "subscriber_auth_not_configured" }, { status: 503 });
  }

  if (request.method === "GET") {
    return response({ subscribed: hasValidSession(request, sessionSecret) });
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

  const code = payload?.code;
  if (typeof code !== "string" || code.length > 256 || !sameValue(code, accessCode)) {
    return response({ error: "invalid_code" }, { status: 401 });
  }

  const token = createSession(sessionSecret);
  return response(
    { subscribed: true },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
};
