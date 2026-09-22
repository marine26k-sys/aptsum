// 세션 쿠키 공용 유틸 — 2026.09 신설.
// 구독자 세션: /api/subscriber(발급·확인)와 /api/listings(구독 전용 실매물 데이터 조회)가 같이 쓴다.
// 관리자(통계) 세션: stats-auth.mjs가 발급하는 쿠키 — /api/listings의 엑셀 업로드 권한 확인에 쓴다.
// 원래 subscriber.mjs 안에만 있던 코드를 옮긴 것(검증 규칙이 여러 곳에서 달라지지 않도록).
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "__Host-aptsum_subscriber";
export const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function cookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function sameValue(left, right) {
  const leftBytes = Buffer.from(String(left), "utf8");
  const rightBytes = Buffer.from(String(right), "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(secret) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
  }), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function hasValidSession(request, secret) {
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

// stats-auth.mjs가 발급하는 관리자 세션({exp} 서명 쿠키) 확인 — 발급 규칙은 stats-auth.mjs가 원본이다.
// 구독자 쿠키와 비밀키는 같지만 페이로드 형식(version/expiresAt vs exp)과 쿠키 이름이 달라 서로 대신 쓸 수 없다.
export const STATS_COOKIE_NAME = "__Host-aptsum_stats";
export function hasValidStatsSession(request, secret) {
  const value = cookieValue(request, STATS_COOKIE_NAME);
  if (!value) return false;

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !sameValue(signature, sign(payload, secret))) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isInteger(exp) && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
