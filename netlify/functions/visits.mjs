// Netlify Function — 방문자 수 집계 (Netlify Blobs 기반)
// 동시 요청도 조건부 쓰기(ETag)로 안전하게 더하고, 같은 IP·브라우저의 같은 페이지 요청은
// KST 하루에 한 번만 반영한다. 중복 판정용 값은 서버 비밀값으로 HMAC 처리하므로 원본 IP를 저장하지 않는다.
import { createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/visits",
};

const KNOWN_PAGES = ["index", "tier", "subway"];
const MAX_INCREMENT_ATTEMPTS = 8;

function kstYmd(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function toCount(value) {
  return parseInt(value, 10) || 0;
}

function visitorFingerprint(context, req, today) {
  const ip = context?.ip;
  const secret = process.env.SUBSCRIBER_SESSION_SECRET;
  if (!ip || !secret) return null;

  const userAgent = req.headers.get("user-agent") || "";
  return createHmac("sha256", secret)
    .update(\`\${today}\\n\${ip}\\n\${userAgent}\`)
    .digest("base64url");
}

// Netlify Blobs의 onlyIfMatch/onlyIfNew를 이용한 낙관적 잠금.
// 충돌이 난 요청은 최신 ETag를 다시 읽어 재시도하므로 get → set 레이스로 인한 유실을 막는다.
async function incrementCounter(store, key) {
  for (let attempt = 0; attempt < MAX_INCREMENT_ATTEMPTS; attempt += 1) {
    const entry = await store.getWithMetadata(key, { consistency: "strong" });
    const next = toCount(entry?.data) + 1;
    const result = await store.set(
      key,
      String(next),
      entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true }
    );

    if (result.modified) return next;
  }

  throw new Error(\`Counter update contention for \${key}\`);
}

async function readTotals(store, page, today) {
  const [totalRaw, todayRaw] = await Promise.all([
    store.get("total", { consistency: "strong" }),
    store.get(\`day-\${today}\`, { consistency: "strong" }),
  ]);

  return { total: toCount(totalRaw), today: toCount(todayRaw) };
}

export default async (req, context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { allow: "GET", "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page");
  const page = KNOWN_PAGES.includes(pageParam) ? pageParam : "index";
  const today = kstYmd(new Date());

  const store = getStore("visits");
  const fingerprint = visitorFingerprint(context, req, today);

  // Netlify 프로덕션에서는 context.ip와 세션 비밀값이 항상 있으므로, 새로고침·직접 호출의
  // 중복을 하루/페이지 단위로 막는다. 로컬 개발처럼 IP가 제공되지 않는 환경에서는 카운터만 갱신한다.
  if (fingerprint) {
    const dedupeStore = getStore("visit-dedupe");
    const seen = await dedupeStore.set(\`seen:\${today}:\${page}:\${fingerprint}\`, "", {
      onlyIfNew: true,
    });

    if (!seen.modified) {
      const totals = await readTotals(store, page, today);
      return new Response(JSON.stringify(totals), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  }

  const [total, todayCount] = await Promise.all([
    incrementCounter(store, "total"),
    incrementCounter(store, \`day-\${today}\`),
    incrementCounter(store, \`page:\${page}:total\`),
    incrementCounter(store, \`page:\${page}:day:\${today}\`),
  ]);

  return new Response(JSON.stringify({ total, today: todayCount }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
