// Fill school information for complexes that are not present in the bundled archive.
// Richgo's public MCP endpoint is used only as a lazy fallback; the normal path
// continues to read data/nearby-schools/<lawd>.json.
export const config = { path: '/api/richgo-school' };

const ENDPOINT = 'https://m.richgo.ai/api/mcp';
const cache = new Map();

function clean(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

async function callTool(id, name, arguments_) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: arguments_ } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error(`richgo ${response.status}`);
  const payload = await response.json();
  const structured = payload?.result?.structuredContent;
  if (structured) return structured;
  const text = payload?.result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw Error('richgo empty response');
  return JSON.parse(text);
}

function pickApartment(results, region, umd, name) {
  const rows = Array.isArray(results) ? results : [];
  const norm = (value) => clean(value, 200).replace(/\s/g, '').toLowerCase();
  const wanted = norm(name);
  const regionNeedle = norm(region);
  const umdNeedle = norm(umd);
  return rows.find((row) => {
    const rowName = norm(row.name);
    const address = norm(row.address);
    return rowName === wanted && (!regionNeedle || address.includes(regionNeedle)) && (!umdNeedle || address.includes(umdNeedle));
  }) || rows.find((row) => norm(row.name) === wanted) || rows[0] || null;
}

function normalizeSchool(row) {
  const level = row?.level === 'elementary' ? '초' : row?.level === 'middle' ? '중' : row?.level === 'high' ? '고' : '';
  const distance = Number.isFinite(Number(row?.straight_distance_m))
    ? Number(row.straight_distance_m)
    : Number.isFinite(Number(row?.walk_distance_m)) ? Number(row.walk_distance_m) : null;
  if (!level || !row?.name || !Number.isFinite(distance)) return null;
  return {
    id: row.school_id || null,
    name: row.name,
    level,
    distance,
    type: '',
    grade: row.grade || null,
    rank: row.sd_rank || null,
    source: '리치고',
  };
}

export default async (request) => {
  const query = new URL(request.url).searchParams;
  const name = clean(query.get('name'));
  const region = clean(query.get('region'));
  const umd = clean(query.get('umd'));
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 });

  const key = JSON.stringify([name, region, umd]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Response.json(cached.data, { headers: { 'Cache-Control': 'public, max-age=86400' } });

  try {
    const search = await callTool(1, 'search_apartments', { query: [region, umd, name].filter(Boolean).join(' ') });
    const apartment = pickApartment(search?.results, region, umd, name);
    if (!apartment?.danji_id) return Response.json({ error: 'apartment_not_found', schools: [] }, { status: 404 });
    const district = await callTool(2, 'get_school_district', { danji_id: apartment.danji_id, per_level: 10 });
    const data = {
      source: '리치고(Richgo) m.richgo.ai',
      danjiId: apartment.danji_id,
      name: apartment.name,
      address: apartment.address || '',
      url: apartment.url || '',
      schools: (district?.schools || []).map(normalizeSchool).filter(Boolean),
      note: district?.note || '',
    };
    cache.set(key, { data, expires: Date.now() + 86400000 });
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return Response.json({ error: 'richgo_unavailable', schools: [] }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
