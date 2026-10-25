// Fetch a single apartment's basic profile from Richgo's public MCP on demand.
export const config = { path: '/api/richgo-complex-info' };

const ENDPOINT = 'https://m.richgo.ai/api/mcp';

function clean(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function normalize(value) {
  return clean(value, 200).normalize('NFKC').replace(/[\s().·_-]/g, '').toLowerCase();
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

function matchesIdentity(expected, overview, sourceName) {
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
  // When both records have both identity fields, require both to agree. If
  // only one is available, require that one; use exact name only when neither
  // source exposes comparable metadata.
  const identityMatches = checks.length ? checks.every(Boolean) : normalize(sourceName) === normalize(expected.name);
  return { identityMatches, exactName: normalize(sourceName) === normalize(expected.name), matchedFields: checks.filter(Boolean).length };
}

function findAreaCandidates(results, region, umd) {
  const rows = Array.isArray(results) ? results : [];
  const district = normalize(region.split(/\s+/).filter(Boolean).at(-1) || '');
  return rows.filter((row) => {
    const address = normalize(row.address);
    return (!umd || address.includes(normalize(umd))) && (!district || address.includes(district));
  });
}

export default async (request) => {
  const query = new URL(request.url).searchParams;
  const name = clean(query.get('name'));
  const region = clean(query.get('region'));
  const umd = clean(query.get('umd'));
  const year = clean(query.get('year'), 4);
  const households = clean(query.get('households'), 8);
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 });

  try {
    const search = await callTool(1, 'search_apartments', { query: [region, umd, name].filter(Boolean).join(' ') });
    const areaCandidates = findAreaCandidates(search?.results, region, umd);
    if (!areaCandidates.length) return Response.json({ error: 'apartment_not_found' }, { status: 404 });
    const exactCandidates = areaCandidates.filter((candidate) => normalize(candidate.name) === normalize(name));
    const candidates = exactCandidates.length ? exactCandidates : areaCandidates;
    const expected = { name, year, households };
    const profiles = await Promise.all(candidates.slice(0, 10).map(async (candidate) => {
      try {
        const overview = await callTool(2, 'get_apartment_overview', { danji_id: candidate.danji_id });
        return { candidate, overview, ...matchesIdentity(expected, overview, overview.name || candidate.name) };
      } catch {
        return null;
      }
    }));
    const available = profiles.filter(Boolean);
    if (!available.length) return Response.json({ error: 'richgo_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const verified = available.filter((profile) => profile.identityMatches);
    if (!verified.length) return Response.json({ error: 'apartment_identity_mismatch' }, { status: 409 });
    const bestScore = Math.max(...verified.map((profile) => profile.matchedFields * 2 + Number(profile.exactName)));
    const best = verified.filter((profile) => profile.matchedFields * 2 + Number(profile.exactName) === bestScore);
    if (best.length !== 1) return Response.json({ error: 'apartment_ambiguous' }, { status: 409 });
    const { candidate, overview } = best[0];
    return Response.json({
      source: '리치고(Richgo) m.richgo.ai',
      danjiId: candidate.danji_id,
      name: overview.name || candidate.name,
      address: overview.address || {},
      constructDate: overview.construct_date || null,
      households: overview.households ?? null,
      floorAreaRatioPct: overview.floor_area_ratio_pct ?? null,
      buildingCoveragePct: overview.building_coverage_pct ?? null,
      parking: overview.parking || null,
      heating: overview.heating || null,
      entranceType: overview.entrance_type || null,
      builder: overview.builder || null,
      url: overview.url || candidate.url || '',
    }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return Response.json({ error: 'richgo_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
