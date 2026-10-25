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

function normalize(value) {
  return clean(value, 200).normalize('NFKC').replace(/[\s().·_-]/g, '').toLowerCase();
}

function findAreaCandidates(results, region) {
  const rows = Array.isArray(results) ? results : [];
  const district = normalize(region.split(/\s+/).filter(Boolean).at(-1) || '');
  return rows.filter((row) => {
    const address = normalize(row.address);
    return !district || address.includes(district);
  });
}

function identityMatch(expected, overview, sourceName) {
  const sourceAddress = normalize(`${overview.address?.road || ''} ${overview.address?.jibun || ''}`);
  const district = normalize(expected.region.split(/\s+/).filter(Boolean).at(-1) || '');
  if (expected.umd && !sourceAddress.includes(normalize(expected.umd))) return false;
  if (district && !sourceAddress.includes(district)) return false;
  const expectedYear = Number.parseInt(expected.year, 10);
  const sourceYear = Number.parseInt(String(overview.construct_date || '').slice(0, 4), 10);
  const expectedHouseholds = Number(expected.households);
  const sourceHouseholds = Number(overview.households);
  const checks = [];
  if (expectedYear >= 1800 && expectedYear <= 2200 && sourceYear >= 1800 && sourceYear <= 2200) {
    checks.push(Math.abs(expectedYear - sourceYear) <= 1);
  }
  if (expectedHouseholds > 0 && sourceHouseholds > 0) {
    checks.push(Math.abs(expectedHouseholds - sourceHouseholds) <= Math.max(30, expectedHouseholds * 0.05));
  }
  // Require all available identity fields to agree. If Richgo omits both,
  // only an exact name in the correct dong can be used; never take row zero.
  return checks.length ? checks.every(Boolean) : normalize(sourceName) === normalize(expected.name);
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
  const year = clean(query.get('year'), 4);
  const households = clean(query.get('households'), 8);
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 });

  const expected = { name, region, umd, year, households };
  const key = JSON.stringify([name, region, umd, year, households]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Response.json(cached.data, { headers: { 'Cache-Control': 'public, max-age=86400' } });

  try {
    const search = await callTool(1, 'search_apartments', { query: [region, umd, name].filter(Boolean).join(' ') });
    const areaCandidates = findAreaCandidates(search?.results, region);
    if (!areaCandidates.length) return Response.json({ error: 'apartment_not_found', schools: [] }, { status: 404 });
    const exactCandidates = areaCandidates.filter((candidate) => normalize(candidate.name) === normalize(name));
    const candidates = exactCandidates.length ? exactCandidates : areaCandidates;
    const profiles = await Promise.all(candidates.slice(0, 10).map(async (candidate) => {
      try {
        const overview = await callTool(2, 'get_apartment_overview', { danji_id: candidate.danji_id });
        return identityMatch(expected, overview, overview.name || candidate.name)
          ? { candidate, overview }
          : null;
      } catch {
        return null;
      }
    }));
    const verified = profiles.filter(Boolean);
    if (!verified.length) return Response.json({ error: 'apartment_identity_mismatch', schools: [] }, { status: 409 });
    if (verified.length !== 1) return Response.json({ error: 'apartment_ambiguous', schools: [] }, { status: 409 });
    const { candidate: apartment } = verified[0];
    const district = await callTool(3, 'get_school_district', { danji_id: apartment.danji_id, per_level: 10 });
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
