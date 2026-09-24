// 비공개 탭 원스톱 신청(2026.09, 운영자 요청) — 네이버폼 → PayApp 링크 → 운영자 수동 코드 발급으로 이어지던
// 절차를 aptsum.kr 안에서 한 번에 처리한다.
//
//   1) apply.html에서 조건(지역·금액대·평수·입주 여부·층/세대/연차)과 연락처·메일을 받는다
//   2) 운영자가 PayApp에 만들어 둔 결제 링크(PAYAPP_LINK_URL) 결제창을 새 창으로 연다
//      — 처음엔 REST API(payrequest) 결제창을 썼는데, 그 화면엔 판매자 실명·개인 휴대폰 번호가 노출돼서
//        상점명("아파트썸")만 보이는 결제 링크 화면으로 바꿨다(운영자 요청).
//   3) PayApp이 결제 완료를 "공통 통보 URL"(/api/payapp-feedback)로 알려오면, 결제창에 입력한 휴대폰 번호로
//      결제 대기 중인 신청서를 찾아 개인 코드를 자동 발급한다(코드 발급·만료·해지는 shared/subscribers.mjs).
//      신청서 없이 결제 링크로 바로 결제한 경우에도 코드를 만들어 두고 stats.html에 "신청서 없음"으로 표시한다.
//   4) 신청 페이지는 신청서 확인 토큰(claim)으로 결과를 계속 물어보고, 결제됐으면 코드를 보여주며 바로 로그인시킨다
//
// 결제 여부는 오직 PayApp의 서버 통보(연동 KEY/VALUE 확인 + 금액 확인)로만 판단한다.
// 공통 통보 URL은 판매자의 모든 결제를 알려오므로, 금액이 이 상품(APPLY_PRICE)과 같은 것만 처리한다.
//
// 저장소(Netlify Blobs "applications"):
//   app:<id>       { id, createdAt, status, price, region, budget, size, movein, condition, phone, email,
//                    mulNo, subId, paidAt, delivered, unmatched }
//   phone:<번호>    { id }  — 그 번호로 가장 최근에 낸 신청서(결제 통보를 신청서에 잇는 색인)
//   mul:<결제번호>   { id }  — 결제 완료된 신청서(같은 통보 재전송·환불 통보를 찾는 색인)
//   status: pending(결제 대기) → paid(결제 완료·코드 발급) | refunded(결제 취소·코드 해지)
//
// 환경변수: PAYAPP_USERID(판매자 아이디), PAYAPP_LINKKEY(연동 KEY), PAYAPP_LINKVAL(연동 VALUE)
//           PAYAPP_LINK_URL(결제 링크, 기본 https://www.payapp.kr/L/z4l7c4)
//           APPLY_PRICE(기본 9900원 — 결제 링크 상품과 같은 금액), APPLY_DAYS(이용 기간, 기본 30일)
import { createHmac, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { sameValue } from "./sessions.mjs";
import { createSubscriber, getSubscriber, subscriberStore } from "./subscribers.mjs";

export const DEFAULT_LINK_URL = "https://www.payapp.kr/L/z4l7c4";
// 신청서를 낸 뒤 이 시간 안에 들어온 같은 번호 결제만 그 신청서의 결제로 본다
export const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

export const applicationStore = () => getStore("applications");

export function applyConfig(env = process.env) {
  const price = Number.parseInt(env.APPLY_PRICE || "9900", 10);
  const days = Number.parseInt(env.APPLY_DAYS || "30", 10);
  return {
    price: price > 0 ? price : 9900,
    days: days > 0 ? days : 30,
    payUrl: env.PAYAPP_LINK_URL || DEFAULT_LINK_URL,
    paymentEnabled: !!(env.PAYAPP_USERID && env.PAYAPP_LINKKEY && env.PAYAPP_LINKVAL),
  };
}

// 신청서 항목 — 네이버폼 1~7번과 같다. 자유 입력이라 길이만 제한한다.
const TEXT_FIELDS = { region: 100, budget: 60, size: 60, movein: 60, condition: 100 };

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

export function validateApplication(body) {
  const data = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    const v = String(body?.[key] ?? "").trim();
    if (!v) return { error: `${key}_required` };
    if (v.length > max) return { error: `${key}_too_long` };
    data[key] = v;
  }
  const phone = normalizePhone(body?.phone);
  if (!/^01[016789]\d{7,8}$/.test(phone)) return { error: "invalid_phone" };
  const email = String(body?.email ?? "").trim();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid_email" };
  if (body?.agree !== true) return { error: "agree_required" };
  return { data: { ...data, phone, email } };
}

// 신청한 사람이 자기 신청서 결과를 볼 수 있게 주는 토큰 — 신청서 id + 서명
function claimSig(secret, id) {
  return createHmac("sha256", secret).update(`apply-claim:${id}`).digest("base64url").slice(0, 22);
}
export function createClaim(secret, id) {
  return `${id}.${claimSig(secret, id)}`;
}
export function readClaim(secret, claim) {
  const [id, sig, extra] = String(claim || "").split(".");
  if (!id || !sig || extra || id.length > 32) return null;
  return sameValue(sig, claimSig(secret, id)) ? id : null;
}

export function newApplication(data, price, now = Date.now()) {
  return {
    id: randomBytes(9).toString("base64url"), createdAt: now, status: "pending", price, ...data,
    mulNo: null, subId: null, paidAt: null, delivered: false,
  };
}

// 신청서 저장 + 휴대폰 번호 색인(같은 번호로 다시 신청하면 최신 신청서로 덮어쓴다)
export async function saveApplication(app, store = applicationStore()) {
  await store.setJSON(`app:${app.id}`, app);
  await store.setJSON(`phone:${app.phone}`, { id: app.id });
}

// "YYYY-MM-DD"(KST) — 오늘로부터 days일 뒤
export function expiryDateAfter(days, now = Date.now()) {
  return new Date(now + 9 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}

async function getJSON(store, key) {
  return store.get(key, { type: "json", consistency: "strong" });
}

// 결제 통보를 받을 신청서 찾기: 이미 처리한 결제번호 → 같은 번호의 결제 대기 신청서(24시간 이내)
async function findApplication(store, mulNo, phone, now) {
  if (mulNo) {
    const idx = await getJSON(store, `mul:${mulNo}`);
    const app = idx && await getJSON(store, `app:${idx.id}`);
    if (app) return app;
  }
  if (phone) {
    const idx = await getJSON(store, `phone:${phone}`);
    const app = idx && await getJSON(store, `app:${idx.id}`);
    if (app && app.status === "pending" && now - app.createdAt <= MATCH_WINDOW_MS) return app;
  }
  return null;
}

// PayApp 통보 처리. 반환값의 ok가 false면 연동 정보가 틀린 요청(위조 가능성) — 그 외엔 PayApp에 "SUCCESS"를 돌려준다
// (같은 통보를 여러 번 받아도 결과가 같게 처리).
//   pay_state 4 = 결제 완료, 9·64 = 승인 취소(환불), 1 = 결제 요청(무시)
export async function handleFeedback(p, {
  env = process.env, appStore = applicationStore(), subStore = subscriberStore(), now = Date.now(),
} = {}) {
  const cfg = applyConfig(env);
  if (!cfg.paymentEnabled) return { ok: false, reason: "not_configured" };
  if (!sameValue(p.userid || "", env.PAYAPP_USERID)
    || !sameValue(p.linkkey || "", env.PAYAPP_LINKKEY)
    || !sameValue(p.linkval || "", env.PAYAPP_LINKVAL)) {
    return { ok: false, reason: "bad_credentials" };
  }
  const state = String(p.pay_state || "");
  const mulNo = String(p.mul_no || "");
  const phone = normalizePhone(p.recvphone);

  if (state === "4") {
    // 공통 통보 URL은 판매자의 모든 결제를 알려오므로 이 상품 금액만 처리한다
    if (Number(p.price) !== cfg.price) return { ok: true, result: "other_product" };
    let app = await findApplication(appStore, mulNo, phone, now);
    if (app?.subId) return { ok: true, result: "already_issued" };
    if (!app) {
      // 신청서 없이 결제 링크로 바로 결제했거나, 결제창에 신청서와 다른 번호를 넣은 경우 — 코드는 만들어 두고
      // 운영자가 stats.html에서 보고 전달한다
      app = newApplication({ region: "", budget: "", size: "", movein: "", condition: "", phone, email: "" }, cfg.price, now);
      app.unmatched = true;
    }
    const [y, m, d] = expiryDateAfter(cfg.days, now).split("-");
    const sub = await createSubscriber({
      name: `${app.unmatched ? "결제" : "신청"} ${phone.slice(-4) || mulNo}`,
      expiresAt: Date.parse(`${y}-${m}-${d}T23:59:59+09:00`),
      orderId: app.id,
    }, subStore);
    Object.assign(app, { status: "paid", subId: sub.id, paidAt: now, mulNo: mulNo || null });
    await appStore.setJSON(`app:${app.id}`, app);
    if (mulNo) await appStore.setJSON(`mul:${mulNo}`, { id: app.id });
    return { ok: true, result: app.unmatched ? "issued_unmatched" : "issued", subId: sub.id, appId: app.id };
  }

  if (state === "9" || state === "64") {
    const idx = mulNo ? await getJSON(appStore, `mul:${mulNo}`) : null;
    const app = idx && await getJSON(appStore, `app:${idx.id}`);
    if (!app) return { ok: true, result: "unknown_payment" };
    if (app.subId) {
      const sub = await getSubscriber(app.subId, subStore);
      if (sub && !sub.revoked) { sub.revoked = true; await subStore.setJSON(`sub:${sub.id}`, sub); }
    }
    app.status = "refunded";
    await appStore.setJSON(`app:${app.id}`, app);
    return { ok: true, result: "refunded" };
  }

  return { ok: true, result: "ignored" };
}
