// PayApp 결제 통보(feedbackurl) — 결제 완료 시 개인 코드 자동 발급, 결제 취소 시 코드 해지.
// 처리 규칙은 shared/applications.mjs의 handleFeedback. PayApp은 본문이 "SUCCESS"인 200 응답을 받아야 통보를 끝낸다.
import { handleFeedback } from "../../shared/applications.mjs";

export const config = { path: "/api/payapp-feedback" };

const text = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export default async (request) => {
  if (request.method !== "POST") return text("method_not_allowed", 405);
  let params;
  try {
    params = Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return text("invalid_request", 400);
  }
  let r;
  try {
    r = await handleFeedback(params);
  } catch (e) {
    // 저장소 오류 등 — SUCCESS를 주지 않아야 PayApp이 다시 보내준다(checkretry=y)
    console.error("payapp feedback error", e);
    return text("FAIL", 500);
  }
  if (!r.ok) {
    console.warn("payapp feedback rejected", r.reason);
    return text("FAIL", 403);
  }
  console.log("payapp feedback", params.var1, params.pay_state, r.result);
  return text("SUCCESS");
};
