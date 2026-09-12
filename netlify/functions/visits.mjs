// Netlify Function — 방문자 카운터 (Netlify Blobs 기반)
// 기존 visitor-badge.laobi.icu(제3자 뱃지 이미지 서비스) 대체 — 새로고침마다 중복 카운트되고
// 광고 차단기에 이미지 트래킹 픽셀로 오인돼 막히는 문제가 있어, 자체 서버리스 함수 + Netlify Blobs로 교체.
// 정확한 유니크 방문자 집계가 아니라 페이지 로드 수 카운트(기존 뱃지와 동일한 개념)이며,
// 동시 요청 시 정확히 원자적이진 않지만(get→set) 개인 트래픽 규모에서는 문제되지 않음.
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/visits",
};

export default async () => {
  const store = getStore("visits");
  const today = new Date().toISOString().slice(0, 10); // UTC 날짜 기준 일일 카운터 키

  // consistency: "strong" 필수 — 기본값(eventual)은 방금 쓴 값을 바로 못 읽어와 계속 0으로 보일 수 있음
  const [totalRaw, todayRaw] = await Promise.all([
    store.get("total", { consistency: "strong" }),
    store.get(`day-${today}`, { consistency: "strong" }),
  ]);

  const total = (parseInt(totalRaw, 10) || 0) + 1;
  const todayCount = (parseInt(todayRaw, 10) || 0) + 1;

  await Promise.all([
    store.set("total", String(total)),
    store.set(`day-${today}`, String(todayCount)),
  ]);

  return new Response(JSON.stringify({ total, today: todayCount }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
