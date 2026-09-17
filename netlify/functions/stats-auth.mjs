// Netlify Function — 방문자 통계 관리자 인증
// STATS_ACCESS_CODE는 서버에서만 비교하고, 성공하면 서명된 HttpOnly 쿠키만 내려준다.
import { createHmac, timingSafeEqual } from "node:crypto";

export const config = {
  path: "/api/stats-auth",
};

const COOKIE_NAME = "__Host-aptsum_stats";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      vary: "Cookie",
      ...headers,
    },
  });
}

function getCookie(request, name) {
  const prefix = `${name}=`;
  return (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function equal(left, right) {
  const a = Buffer.from(left || "");
  const b = Buffer.from(right || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSession(secret) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS })
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function hasValidSession(request, secret) {
  const value = getCookie(request, COOKIE_NAME);
  if (!value) return false;

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !equal(signature, sign(payload, secret))) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isInteger(exp) && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function sessionCookie(value) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export default async (request) => {
  const accessCode = process.env.STATS_ACCESS_CODE;
  const secret = process.env.SUBSCRIBER_SESSION_SECRET;

  if (!accessCode || !secret) {
    return json({ error: "stats_auth_not_configured" }, { status: 503 });
  }

  if (request.method === "GET") {
    return json({ authenticated: hasValidSession(request, secret) });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET, POST" } });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body?.code !== "string" || !equal(body.code, accessCode)) {
    return json({ error: "invalid_code" }, { status: 401 });
  }

  return json(
    { authenticated: true },
    { headers: { "set-cookie": sessionCookie(createSession(secret)) } }
  );
};
