// 비공개 탭 원스톱 신청(2026.09, 운영자 요청) — 네이버폼 → PayApp 링크 → 운영자 수동 코드 발급으로 이어지던
// 절차를 aptsum.kr 안에서 한 번에 처리한다.
//
//   1) apply.html에서 조건(지역·금액대·평수·입주 여부·층/세대/연차)과 연락처·메일을 받는다
//   2) 새 신청은 payment.html에서 PayApp JS 결제창을 연다(휴대폰은 결제창에서만 입력).
//      기존 고정 결제 링크와 휴대폰 매칭도 유지해 이전 신청의 결제를 처리한다.
//   3) PayApp 서버 통보의 서명된 var1로 신청서를 찾아 개인 코드를 자동 발급한다(코드 발급·만료·해지는 shared/subscribers.mjs).
//      신청서 없이 결제 링크로 바로 결제한 경우에도 코드를 만들어 두고 stats.html에 "신청서 없음"으로 표시한다.
//   4) 신청 페이지는 신청서 확인 토큰(claim)으로 결과를 계속 물어보고, 결제됐으면 코드를 보여주며 바로 로그인시킨다
//
// 결제 여부는 오직 PayApp의 서버 통보(연동 KEY/VALUE 확인 + 금액 확인)로만 판단한다.
// 공통 통보 URL은 판매자의 모든 결제를 알려오므로 4,900원·9,900원 상품 금액만 처리한다.
//
// 저장소(Netlify Blobs "applications"):
//   app:<id>       { id, createdAt, status, price, region, budget, size, movein, condition, phone, email,
//                    mulNo, subId, paidAt, delivered, unmatched }
//   phone:<번호>    { id }  — 그 번호로 가장 최근에 낸 신청서(결제 통보를 신청서에 잇는 색인)
//   mul:<결제번호>   { id }  — 결제 완료된 신청서(같은 통보 재전송·환불 통보를 찾는 색인)
//   status: pending(결제 대기) → paid(결제 완료·코드 발급) | refunded(결제 취소·코드 해지)
//           | canceled(결제 요청 취소 — PayApp에서 요청을 취소했거나 운영자가 stats.html에서 정리. 같은 신청서로 다시
//             결제하면 그대로 결제 완료로 이어진다)
//
// 환경변수: PAYAPP_USERID(판매자 아이디), PAYAPP_LINKKEY(연동 KEY), PAYAPP_LINKVAL(연동 VALUE)
//           PAYAPP_LINK_URL(결제 링크, 기본 https://www.payapp.kr/L/z4l7c4)
//           PAYAPP_LISTINGS_LINK_URL(4,900원 결제 링크, 기본 https://www.payapp.kr/L/z4lCk5)
//           APPLY_DAYS(이용 기간, 기본 30일)
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

export function applyProducts(env = process.env) {
  const cfg = applyConfig(env);
  return [
    { id: "listings", name: "네이버 실매물 이용권", price: 4900, days: cfg.days, includesMail: false, payUrl: env.PAYAPP_LISTINGS_LINK_URL || "https://www.payapp.kr/L/z4lCk5", paymentEnabled: cfg.paymentEnabled },
    { id: "selection", name: "실매물 이용권 + 아파트썸 단지 선별 메일", price: 9900, days: cfg.days, includesMail: true, payUrl: cfg.payUrl, paymentEnabled: cfg.paymentEnabled },
  ];
}
export const includesSelectionMail = app => app.includesMail ?? app.product !== "listings";

// 신청서 항목 — 네이버폼 1~7번과 같다. 자유 입력이라 길이만 제한한다.
const TEXT_FIELDS = { region: 100, budget: 60, size: 60, movein: 60, condition: 100 };

export function normalizePhone(phone) {
  return String(phone || "").replace(/[^0-9]/g, "");
}

export function validateApplication(body) {
  const product = body?.product || "selection";
  if (!["listings", "selection"].includes(product)) return { error: "invalid_product" };
  const data = { product };
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    const v = String(body?.[key] ?? "").trim();
    if (!v && product === "selection") return { error: `${key}_required` };
    if (v.length > max) return { error: `${key}_too_long` };
    data[key] = product === "selection" ? v : "";
  }
  const phone = normalizePhone(body?.phone);
  if (phone && !/^01[016789]\d{7,8}$/.test(phone)) return { error: "invalid_phone" };
  const email = product === "selection" ? String(body?.email ?? "").trim() : "";
  if (email.length > 120 || ((email || product === "selection") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: "invalid_email" };
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

// 결제 연결 토큰은 결과 확인 토큰과 별도로 서명한다. 결제창에 결과 조회 권한을 전달하지 않는다.
export function createPaymentRef(secret, id) {
  const sig=createHmac("sha256",secret).update(`apply-payment:${id}`).digest("base64url").slice(0,22);
  return `aptsum:${id}.${sig}`;
}
export function readPaymentRef(secret, value) {
  if(!secret || !String(value||"").startsWith("aptsum:"))return null;
  const [id,sig,extra]=String(value).slice(7).split(".");
  if(!id||id.length>32||!sig||extra)return null;
  return sameValue(value,createPaymentRef(secret,id))?id:null;
}
export function createPaymentParameters(app, env, origin) {
  const product=applyProducts(env).find(p=>p.id===app.product);
  return {userid:env.PAYAPP_USERID,shopname:'아파트썸',goodname:product.name,price:app.price,
    var1:createPaymentRef(env.SUBSCRIBER_SESSION_SECRET,app.id),
    feedbackurl:`${origin}/api/payapp-feedback`,returnurl:`${origin}/apply.html`,
    smsuse:'n',redirectpay:'1'};
}
export function applicationPayUrl(app, secret, origin) {
  return app.paymentMode==='order' ? `${origin}/payment.html?order=${encodeURIComponent(createPaymentRef(secret,app.id))}` : '';
}

export function newApplication(data, price, now = Date.now()) {
  return {
    id: randomBytes(9).toString("base64url"), createdAt: now, status: "pending", ...data, price, product: data.product || "selection", includesMail: (data.product || "selection") === "selection",
    mulNo: null, subId: null, paidAt: null, delivered: false,
  };
}

// 신청서 저장 + 휴대폰 번호 색인(같은 번호로 다시 신청하면 최신 신청서로 덮어쓴다)
export async function saveApplication(app, store = applicationStore()) {
  await store.setJSON(`app:${app.id}`, app);
  if(app.phone){
    await store.setJSON(`phone:${app.phone}`, { id: app.id });
    await store.setJSON(`phone:${app.phone}:${app.product || "selection"}`, { id: app.id });
  }
}

// "YYYY-MM-DD"(KST) — 오늘로부터 days일 뒤
export function expiryDateAfter(days, now = Date.now()) {
  return new Date(now + 9 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}

async function getJSON(store, key) {
  return store.get(key, { type: "json", consistency: "strong" });
}

// 결제 통보를 받을 신청서 찾기: 이미 처리한 결제번호 → 같은 번호의 결제 대기 신청서(24시간 이내)
async function findApplication(store, mulNo, phone, now, product, orderId) {
  if (mulNo) {
    const idx = await getJSON(store, `mul:${mulNo}`);
    const app = idx && await getJSON(store, `app:${idx.id}`);
    if (app) return app;
  }
  if(orderId){
    const app=await getJSON(store,`app:${orderId}`);
    return app || null;
  }
  if (phone) {
    const idx = await getJSON(store, `phone:${phone}:${product.id}`) || await getJSON(store, `phone:${phone}`);
    const app = idx && await getJSON(store, `app:${idx.id}`);
    if (app && app.price === product.price && (app.product || "selection") === product.id && (app.status === "pending" || app.status === "canceled") && now - app.createdAt <= MATCH_WINDOW_MS) return app;
  }
  return null;
}

// PayApp 통보 처리. 반환값의 ok가 false면 연동 정보가 틀린 요청(위조 가능성) — 그 외엔 PayApp에 "SUCCESS"를 돌려준다
// (같은 통보를 여러 번 받아도 결과가 같게 처리).
//   pay_state 4 = 결제 완료, 9·64 = 승인 취소(환불), 8·16·32 = 결제 요청 취소, 1 = 결제 요청(무시)
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
  const hasOrderRef=String(p.var1||'').startsWith('aptsum:');
  const orderId=hasOrderRef?readPaymentRef(env.SUBSCRIBER_SESSION_SECRET,p.var1):null;
  if(hasOrderRef&&!orderId)return {ok:false,reason:'invalid_payment_ref'};
  if(orderId){
    const app=await getJSON(appStore,`app:${orderId}`);
    if(!app)return {ok:false,reason:'unknown_application'};
    if(app.price!==Number(p.price))return {ok:false,reason:'payment_product_mismatch'};
    if(app.status==='refunded' && state==='4')return {ok:true,result:'refunded'};
  }

  if (state === "4") {
    if(orderId && (!mulNo || !/^01[016789]\d{7,8}$/.test(phone)))return {ok:false,reason:'invalid_payment_details'};
    // 공통 통보 URL은 판매자의 모든 결제를 알려오므로 이 상품 금액만 처리한다
    const product = applyProducts(env).find(v => v.price === Number(p.price));
    if (!product) return { ok: true, result: "other_product" };
    let app = await findApplication(appStore, mulNo, phone, now, product, orderId);
    if (app && (app.price !== product.price || (app.product || "selection") !== product.id)) return { ok: false, reason: "payment_product_mismatch" };
    if (app?.subId) return { ok: true, result: "already_issued" };
    if (!app) {
      // 신청서 없이 결제 링크로 바로 결제했거나, 결제창에 신청서와 다른 번호를 넣은 경우 — 코드는 만들어 두고
      // 운영자가 stats.html에서 보고 전달한다
      app = newApplication({ region: "", budget: "", size: "", movein: "", condition: "", phone, email: "", product: product.id }, product.price, now);
      app.unmatched = true;
    }
    // 같은 결제 통보가 동시에 두 번 오면(PayApp은 같은 통보를 여러 번 보낼 수 있다) 코드가 두 개 발급될 수 있어,
    // 결제번호 색인을 "없을 때만 쓰기"로 먼저 선점한 요청만 발급한다. 이미 색인이 있는데 여기까지 왔다면
    // 앞선 요청이 발급 도중 실패한 경우라(위 findApplication이 subId 없는 신청서를 돌려줌) 그대로 이어서 발급한다.
    if (mulNo && !(await getJSON(appStore, `mul:${mulNo}`))) {
      const claimed = await appStore.setJSON(`mul:${mulNo}`, { id: app.id }, { onlyIfNew: true });
      if (claimed && claimed.modified === false) return { ok: true, result: "already_issued" };
    }
    const [y, m, d] = expiryDateAfter(cfg.days, now).split("-");
    const sub = await createSubscriber({
      name: `${app.unmatched ? "결제" : "신청"} ${phone.slice(-4) || mulNo}`,
      expiresAt: Date.parse(`${y}-${m}-${d}T23:59:59+09:00`),
      orderId: app.id, scope: "listings", product: product.id,
    }, subStore);
    Object.assign(app, { phone: phone || app.phone || "", status: "paid", subId: sub.id, paidAt: now, mulNo: mulNo || null });
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

  if (state === "8" || state === "16" || state === "32") {
    // 결제 요청 취소 — 결제번호로 이어진 신청서가 없으면 같은 번호의 최근 결제 대기 신청서를 찾는다
    const idx = mulNo ? await getJSON(appStore, `mul:${mulNo}`) : null;
    let app = idx && await getJSON(appStore, `app:${idx.id}`);
    if (!app && (phone || orderId)) {
      const product = applyProducts(env).find(v => v.price === Number(p.price));
      if (!product) return { ok: true, result: "ignored" };
      app = await findApplication(appStore, "", phone, now, product, orderId);
    }
    if (!app || app.status !== "pending") return { ok: true, result: "ignored" };
    app.status = "canceled";
    await appStore.setJSON(`app:${app.id}`, app);
    return { ok: true, result: "canceled" };
  }

  return { ok: true, result: "ignored" };
}
