export const config = { path: "/api/cheongyak-map" };

function addressQueries(address) {
  const base = address
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+(?:일원|일대).*$/, "")
    .replace(/(\d+(?:-\d+)?)번지\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = base.replace(/특례시/g, "시");
  const legacyDongtan = normalized.replace(/화성시\s+동탄구\s+/, "화성시 ");
  return [...new Set([base, normalized, legacyDongtan].filter(Boolean))];
}

async function searchAddress(key, query) {
  const params = new URLSearchParams({ query, analyze_type: "exact" });
  const response = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?${params}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("address_search_failed");
  const payload = await response.json();
  return payload.documents?.find((item) => Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y)));
}

export default async (request) => {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
  const address = new URL(request.url).searchParams.get("address")?.trim() || "";
  if (address.length < 5 || address.length > 180 || /[\u0000-\u001f]/.test(address)) {
    return Response.json({ error: "invalid_address" }, { status: 400 });
  }

  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return Response.json({ error: "map_service_unavailable" }, { status: 503 });

  try {
    for (const query of addressQueries(address)) {
      const item = await searchAddress(key, query);
      if (item) {
        return Response.json(
          { lat: Number(item.y), lng: Number(item.x) },
          { headers: { "Cache-Control": "public, max-age=86400" } },
        );
      }
    }
    return Response.json({ error: "address_not_found" }, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return Response.json({ error: "map_service_unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};
