// 비공개 탭 원스톱 신청(2026.09, 운영자 요청) — 네이버폼 → PayApp 링크 → 운영자 수동 코드 발급으로 이어지던
// 절차를 aptsum.kr 안에서 한 번에 처리한다.
//
//   1) apply.html에서 조건(지역·금액대·평수·입주 여부·층/세대/연차)과 연락처·메일을 받는다
//   2) 서버가 PayApp REST API(payrequest)로 결제창을 만들고 그 주소로 보낸다
//   3) PayApp이 결제 완료를 feedbackurl(/api/payapp-feedback)로 알려오면 개인 코드를 자동 발급한다
//      (코드 발급·만료·해지는 기존 구독자 코드와 같은 저장소 — shared/subscribers.mjs)
//   4) 결제 후 돌아온 apply.html이 신청서 확인 토큰(claim)으로 결과를 물어보고, 결제됐으면 바로 로그인시킨다
//
// 결제 여부는 오직 PayApp의 서버 통보(연동 KEY/VALUE 확인 + 금액 확인)로만 판단한다 — returnurl로 돌아온 것만으로는
// 코드를 주지 않는다(주소만 알면 누구나 열 수 있으므로).
//
// 저장소(Netlify Blobs "applications"):
//   app:<id>  { id, createdAt, status, price, region, budget, size, movein, condition, phone, email,
//               mulNo, subId, paidAt, delivered }
//   status: pending(결제 대기) → paid(결제 완료·코드 발급) | canceled(결제 요청 취소) | refunded(결제 취소·코드 해지)
//           | mismatch(금액 불일치 — 코드 미발급, 운영자 확인 필요)
//
// 환경변수: PAYAPP_USERID(판매자 아이디), PAYAPP_LINKKEY(연동 KEY), PAYAPP_LINKVAL(연동 VALUE)
//           APPLY_PRICE(기본 9900원 — PayApp 결제 링크 상품과 같은 금액), APPLY_DAYS(이용 기간, 기본 30일)
import { createHmac, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { sameValue } from "./sessions.mjs";
import { createSubscriber, getSubscriber, subscriberStore } from "./subscribers.mjs";

export const PAYAPP_API = "https://api.payapp.kr/oapi/apiLoad.html";
export const GOOD_NAME = "실매물 분석 탭 (1개월) + 아파트썸 매물 선별 (1회)";

export const applicationStore = () => getStore("applications");

export function applyConfig(env = process.env) {
  const price = Number.parseInt(env.APPLY_PRICE || "9900", 10);
  const days = Number.parseInt(env.APPLY_DAYS || "30", 10);
  return {
    price: price > 0 ? price : 9900,
    days: days > 0 ? days : 30,
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

// 결제 후 돌아온 사람이 자기 신청서 결과를 볼 수 있게 주는 토큰 — 신청서 id + 서명
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

// PayApp 결제 요청 — 성공 시 { payurl, mulNo }, 실패 시 { error }
export async function requestPayment(app, { origin, claim, env = process.env, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    cmd: "payrequest",
    userid: env.PAYAPP_USERID,
    goodname: GOOD_NAME,
    price: String(app.price),
    recvphone: app.phone,
    memo: `아파트썸 신청 ${app.id}`,
    smsuse: "n", // 결제창은 바로 띄우므로 결제 링크 문자는 보내지 않는다
    reqaddr: "0",
    feedbackurl: `${origin}/api/payapp-feedback`,
    returnurl: `${origin}/apply.html?claim=${encodeURIComponent(claim)}`,
    var1: app.id,
    checkretry: "y", // 통보 실패 시 PayApp이 다시 보내도록
  });
  let text;
  try {
    const res = await fetchImpl(PAYAPP_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: params.toString(),
    });
    text = await res.text();
  } catch {
    return { error: "payapp_unreachable" };
  }
  const r = new URLSearchParams(text);
  if (r.get("state") !== "1" || !r.get("payurl")) {
    return { error: "payapp_error", message: (r.get("errorMessage") || "").slice(0, 200) };
  }
  return { payurl: r.get("payurl"), mulNo: r.get("mul_no") || null };
}

// "YYYY-MM-DD"(KST) — 오늘로부터 days일 뒤
export function expiryDateAfter(days, now = Date.now()) {
  return new Date(now + 9 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}

// PayApp 통보 처리. PayApp에는 항상 "SUCCESS"를 돌려주고(같은 통보를 여러 번 받아도 결과가 같게 처리),
// 연동 정보가 틀린 요청만 거부한다. 반환값은 로그·테스트용.
//   pay_state 4 = 결제 완료, 9·64 = 승인 취소(환불), 8·16·32 = 요청 취소
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
  const id = String(p.var1 || "");
  const key = `app:${id}`;
  const app = id ? await appStore.get(key, { type: "json", consistency: "strong" }) : null;
  if (!app) return { ok: true, result: "unknown_application" };
  if (app.mulNo && p.mul_no && String(p.mul_no) !== String(app.mulNo)) return { ok: true, result: "mul_no_mismatch" };

  const state = String(p.pay_state || "");
  if (state === "4") {
    if (app.subId) return { ok: true, result: "already_issued" };
    if (Number(p.price) !== app.price) {
      app.status = "mismatch";
      await appStore.setJSON(key, app);
      return { ok: true, result: "price_mismatch" };
    }
    const [y, m, d] = expiryDateAfter(cfg.days, now).split("-");
    const sub = await createSubscriber({
      name: `신청 ${app.phone.slice(-4)}`,
      expiresAt: Date.parse(`${y}-${m}-${d}T23:59:59+09:00`),
      orderId: app.id,
    }, subStore);
    Object.assign(app, { status: "paid", subId: sub.id, paidAt: now, mulNo: app.mulNo || p.mul_no || null });
    await appStore.setJSON(key, app);
    return { ok: true, result: "issued", subId: sub.id };
  }
  if (state === "9" || state === "64") {
    if (app.subId) {
      const sub = await getSubscriber(app.subId, subStore);
      if (sub && !sub.revoked) { sub.revoked = true; await subStore.setJSON(`sub:${sub.id}`, sub); }
    }
    app.status = "refunded";
    await appStore.setJSON(key, app);
    return { ok: true, result: "refunded" };
  }
  if ((state === "8" || state === "16" || state === "32") && app.status === "pending") {
    app.status = "canceled";
    await appStore.setJSON(key, app);
    return { ok: true, result: "canceled" };
  }
  return { ok: true, result: "ignored" };
}
