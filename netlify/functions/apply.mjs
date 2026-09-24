// 비공개 탭 원스톱 신청 API(2026.09) — 흐름·저장 형식은 shared/applications.mjs 참고.
//
//   GET                                  가격·이용 기간·결제 연동 여부(apply.html 표시용)
//   GET  ?list=1                         신청 목록(관리자 세션 필요 — stats.html)
//   POST {action:"create", ...신청서}     신청서 저장 → { payurl(PayApp 결제 링크), claim }
//   POST {action:"claim", claim}         결제 결과 확인 — 결제 완료면 개인 코드를 알려주고 바로 로그인 쿠키를 준다
//   POST {action:"delivered", id, delivered}  맞춤 선별 메일 보냄 표시(관리자)
import { hasValidStatsSession, subscriberCookie } from "../../shared/sessions.mjs";
import { createLoginThrottle, tooManyAttempts } from "../../shared/login-throttle.mjs";
import { getSubscriber, isActive, createPersonalSession, touchDevice } from "../../shared/subscribers.mjs";
import {
  applicationStore, applyConfig, validateApplication, newApplication, saveApplication, createClaim, readClaim,
} from "../../shared/applications.mjs";

export const config = { path: "/api/apply" };

const json = (body, { status = 200, headers = {} } = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie", ...headers } });

function adminView(app, sub) {
  return {
    id: app.id, createdAt: app.createdAt, status: app.status, price: app.price,
    region: app.region, budget: app.budget, size: app.size, movein: app.movein, condition: app.condition,
    phone: app.phone, email: app.email, paidAt: app.paidAt, delivered: !!app.delivered, unmatched: !!app.unmatched,
    code: sub?.code || null, expiresAt: sub?.expiresAt || null,
  };
}

export default async (request, context) => {
  const secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!secret) return json({ error: "auth_not_configured" }, { status: 503 });
  const cfg = applyConfig();
  const store = applicationStore();

  if (request.method === "GET") {
    if (new URL(request.url).searchParams.get("list") !== "1") {
      return json({ price: cfg.price, days: cfg.days, paymentEnabled: cfg.paymentEnabled, payUrl: cfg.payUrl });
    }
    if (!hasValidStatsSession(request, secret)) return json({ error: "stats_auth_required" }, { status: 401 });
    const { blobs } = await store.list({ prefix: "app:" });
    const apps = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json", consistency: "strong" })))).filter(Boolean);
    // 결제 안 하고 나간 신청서(7일 지난 pending)와, 보유 기간(이용 기간 + 1개월, 개인정보처리방침)이 지난 신청서는 지운다
    const now = Date.now();
    const stale = apps.filter((a) => now - a.createdAt > (a.status === "pending" ? 7 : cfg.days + 31) * 86400000);
    await Promise.all(stale.map(async (a) => {
      await store.delete(`app:${a.id}`).catch(() => {});
      if (a.mulNo) await store.delete(`mul:${a.mulNo}`).catch(() => {});
      const idx = await store.get(`phone:${a.phone}`, { type: "json" }).catch(() => null);
      if (idx?.id === a.id) await store.delete(`phone:${a.phone}`).catch(() => {});
    }));
    const live = apps.filter((a) => !stale.includes(a)).sort((a, b) => b.createdAt - a.createdAt);
    const subs = await Promise.all(live.map((a) => (a.subId ? getSubscriber(a.subId) : null)));
    return json({ applications: live.map((a, i) => adminView(a, subs[i])), paymentEnabled: cfg.paymentEnabled });
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET, POST" } });

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }

  if (body?.action === "create") {
    if (!cfg.paymentEnabled) return json({ error: "payment_not_configured" }, { status: 503 });
    const v = validateApplication(body);
    if (v.error) return json({ error: v.error }, { status: 400 });
    // 같은 IP에서 30분에 5건까지만(신청서 도배 방지) — 로그인 시도 제한 모듈을 재사용
    const throttle = createLoginThrottle("apply-throttle", request, context, secret);
    const lockedFor = await throttle.lockedFor();
    if (lockedFor) return tooManyAttempts(json, lockedFor);
    await throttle.fail();

    const app = newApplication(v.data, cfg.price);
    await saveApplication(app, store);
    return json({ payurl: cfg.payUrl, claim: createClaim(secret, app.id) });
  }

  if (body?.action === "claim") {
    const id = readClaim(secret, body.claim);
    if (!id) return json({ error: "invalid_claim" }, { status: 400 });
    const app = await store.get(`app:${id}`, { type: "json", consistency: "strong" });
    if (!app) return json({ error: "not_found" }, { status: 404 });
    // 결제창에 같은 번호를 넣으라고 안내할 수 있게 가린 번호를 같이 준다(010-****-5678)
    if (app.status !== "paid") return json({ status: app.status, phone: `${app.phone.slice(0, 3)}-****-${app.phone.slice(-4)}` });
    const sub = await getSubscriber(app.subId);
    if (!isActive(sub)) return json({ status: "ended" });
    const { token, did, maxAge } = createPersonalSession(secret, sub);
    await touchDevice(sub.id, did, true);
    return json(
      { status: "paid", code: sub.code, expiresAt: sub.expiresAt, email: app.email },
      { headers: { "Set-Cookie": subscriberCookie(token, maxAge) } },
    );
  }

  if (body?.action === "delivered") {
    if (!hasValidStatsSession(request, secret)) return json({ error: "stats_auth_required" }, { status: 401 });
    const key = `app:${String(body.id || "")}`;
    const app = await store.get(key, { type: "json", consistency: "strong" });
    if (!app) return json({ error: "not_found" }, { status: 404 });
    app.delivered = body.delivered === true;
    await store.setJSON(key, app);
    return json({ ok: true });
  }

  return json({ error: "invalid_action" }, { status: 400 });
};
