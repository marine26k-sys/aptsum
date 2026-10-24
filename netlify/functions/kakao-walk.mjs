export const config = { path: '/api/kakao-walk' };

export default async (request) => {
  const key = process.env.KAKAO_REST_API_KEY;
  const query = new URL(request.url).searchParams;
  const startX = query.get('startX'), startY = query.get('startY');
  const endX = query.get('endX'), endY = query.get('endY');
  if (!key) return Response.json({ error: 'kakao_rest_key_missing' }, { status: 503 });
  if (![startX, startY, endX, endY].every(value => value && /^-?\d+(\.\d+)?$/.test(value))) {
    return Response.json({ error: 'invalid_coordinates' }, { status: 400 });
  }
  const params = new URLSearchParams({ start_x: startX, start_y: startY, end_x: endX, end_y: endY, route_mode: 'SHORTEST' });
  try {
    const response = await fetch(`https://dapi.kakao.com/v2/routing/walk?${params}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json();
    const route = payload?.route?.properties;
    if (!response.ok || payload?.status !== 'OK' || !route) return Response.json({ error: 'walk_route_unavailable' }, { status: 502 });
    return Response.json({ distance: Number(route.totalDistance), duration: Number(route.totalTime), landingUrl: route.landingUrl || '' }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return Response.json({ error: 'walk_route_unavailable' }, { status: 502 });
  }
};
