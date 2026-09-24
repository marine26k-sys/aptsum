// 구독자별 개인 코드(2026.09, 운영자 요청) — 공용 비번(SUBSCRIBER_CODE) 하나를 모두가 쓰던 방식에 더해,
// 운영자가 stats.html에서 사람마다 코드를 발급하고 해지·재발급·만료일을 따로 관리할 수 있게 한다.
//
// 저장소(Netlify Blobs "subscribers"):
//   sub:<id>        { id, name, code, gen, createdAt, expiresAt(ms|null), revoked } — 관리자만 쓴다
//   code:<코드>      { id }   — 로그인 시 코드로 구독자를 찾는 색인(코드는 정규화: 대문자, 영숫자만)
//   dev:<id>:<did>  { t }    — 기기별 마지막 접속 시각. 구독자 접속이 sub 레코드를 다시 쓰지 않도록 따로 둔다
//                              (같이 두면 접속 기록 저장이 관리자의 해지·만료일 변경을 옛 값으로 덮어쓸 수 있음).
//
// 세션 쿠키(이름은 공용 비번과 같은 COOKIE_NAME):
//   version 1 = 공용 비번 세션(shared/sessions.mjs) — 공용 비번이 설정돼 있는 동안 계속 유효
//   version 2 = 개인 코드 세션 { sid, gen, did, expiresAt } — 매 확인마다 저장소를 조회해서
//               해지(revoked)·재발급(gen 변경)·만료가 즉시 반영된다(쿠키 30일을 기다리지 않음).
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { COOKIE_NAME, MAX_AGE_SECONDS, cookieValue, sameValue, sign, hasValidSession } from "./sessions.mjs";

export const DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // "최근 접속 기기" 집계 기간
const DEVICE_TOUCH_MS = 6 * 60 * 60 * 1000; // 같은 기기 접속 기록은 6시간에 한 번만 갱신(저장소 쓰기 절약)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외

export const subscriberStore = () => getStore("subscribers");

export function normalizeCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function newCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// "YYYY-MM-DD" → 그날 KST 23:59:59까지 유효
export function expiryFromDate(date) {
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  return Date.parse(`${date}T23:59:59+09:00`);
}

export function isActive(sub, now = Date.now()) {
  return !!sub && !sub.revoked && !(sub.expiresAt && sub.expiresAt <= now);
}

// 새 코드를 뽑아 색인(code:)에 등록하고 sub.code에 넣는다(sub 레코드 저장은 호출한 쪽에서).
export async function assignCode(store, sub) {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const key = `code:${normalizeCode(code)}`;
    if (await store.get(key, { consistency: "strong" })) continue; // 이미 쓰는 코드면 다시 뽑기
    await store.setJSON(key, { id: sub.id });
    sub.code = code;
    return;
  }
  throw new Error("code_generation_failed");
}

// 새 구독자 발급 — stats.html 수동 발급과 결제 완료 자동 발급(shared/applications.mjs)이 같이 쓴다.
// extra: 자동 발급 때 붙이는 신청서 id 등(orderId)
export async function createSubscriber({ name, expiresAt = null, ...extra }, store = subscriberStore()) {
  const sub = { id: randomBytes(6).toString("base64url"), name, gen: 1, createdAt: Date.now(), expiresAt, revoked: false, ...extra };
  await assignCode(store, sub);
  await store.setJSON(`sub:${sub.id}`, sub);
  return sub;
}

export async function getSubscriber(id, store = subscriberStore()) {
  if (!id) return null;
  try { return (await store.get(`sub:${id}`, { type: "json", consistency: "strong" })) || null; }
  catch { return null; }
}

export async function findByCode(code) {
  const norm = normalizeCode(code);
  if (norm.length !== 8) return null;
  try {
    const idx = await subscriberStore().get(`code:${norm}`, { type: "json", consistency: "strong" });
    const sub = idx ? await getSubscriber(idx.id) : null;
    return sub && normalizeCode(sub.code) === norm ? sub : null;
  } catch { return null; }
}

function personalKey(secret) {
  return createHmac("sha256", secret).update("subscriber-personal").digest("base64url");
}

export function createPersonalSession(secret, sub) {
  const now = Date.now();
  // 구독 만료일은 쿠키에 새기지 않는다 — 확인할 때마다 저장소의 만료일을 보므로, 운영자가 연장하면 다시
  // 로그인하지 않아도 이어서 쓸 수 있다.
  const expiresAt = now + MAX_AGE_SECONDS * 1000;
  const did = randomBytes(9).toString("base64url"); // 기기(브라우저) 구분용 — "최근 접속 기기 수" 집계
  const payload = Buffer.from(JSON.stringify({ version: 2, sid: sub.id, gen: sub.gen, did, expiresAt }), "utf8").toString("base64url");
  return { token: `${payload}.${sign(payload, personalKey(secret))}`, did, maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)) };
}

function readPersonalToken(request, secret) {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (data?.version !== 2) return null;
  if (!sameValue(signature, sign(payload, personalKey(secret)))) return null;
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) return null;
  return data;
}

// 구독자 세션 확인 — { kind: "shared" } | { kind: "personal", sub, did } | null
export async function getSubscriberSession(request, secret) {
  if (hasValidSession(request, secret, process.env.SUBSCRIBER_CODE)) return { kind: "shared" };
  const data = readPersonalToken(request, secret);
  if (!data) return null;
  const sub = await getSubscriber(data.sid);
  if (!isActive(sub) || sub.gen !== data.gen) return null;
  return { kind: "personal", sub, did: data.did };
}

// 접속 기기 기록 — 로그인할 때와, 세션 확인 때 6시간에 한 번. 실패해도 로그인에는 영향 없음.
export async function touchDevice(subId, did, force = false) {
  const store = subscriberStore();
  const key = `dev:${subId}:${did}`;
  try {
    if (!force) {
      const prev = await store.get(key, { type: "json" });
      if (prev && Date.now() - prev.t < DEVICE_TOUCH_MS) return;
    }
    await store.setJSON(key, { t: Date.now() });
  } catch { /* 기록 실패는 무시 */ }
}

// 관리자 목록용 — 구독자 id -> 최근 30일 기기별 마지막 접속 시각 배열. 30일 지난 기록은 여기서 지운다.
export async function loadDevices() {
  const store = subscriberStore();
  const now = Date.now();
  const bySub = new Map();
  const { blobs } = await store.list({ prefix: "dev:" });
  await Promise.all(blobs.map(async ({ key }) => {
    const v = await store.get(key, { type: "json" }).catch(() => null);
    if (!v || now - v.t > DEVICE_WINDOW_MS) { await store.delete(key).catch(() => {}); return; }
    const subId = key.split(":")[1];
    if (!bySub.has(subId)) bySub.set(subId, []);
    bySub.get(subId).push(v.t);
  }));
  return bySub;
}

export async function clearDevices(subId) {
  const store = subscriberStore();
  const { blobs } = await store.list({ prefix: `dev:${subId}:` });
  await Promise.all(blobs.map(({ key }) => store.delete(key)));
}
