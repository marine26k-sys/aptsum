import { createHmac, timingSafeEqual } from "node:crypto";

export const config = {
  path: "/api/subscriber",
};

const COOKIE_NAME = "__Host-aptsum_subscriber";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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

function cookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return part.slice(index + 1).trim();
  }
  return null;
}

function sameValue(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSession(secret) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
  }), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function hasValidSession(request, secret) {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return false;

  const pieces = token.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return false;
  if (!sameValue(pieces[1], sign(pieces[0], secret))) return false;

  try {
    const payload = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    return payload?.version === 1 && Number.isFinite(payload.expiresAt) && payload.expiresAt > Date.now();
  } catch {
    return false;
  }
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
