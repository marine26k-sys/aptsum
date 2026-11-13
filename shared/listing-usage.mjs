export const LISTING_USAGE_WARN_PER_HOUR = 120;
export const LISTING_USAGE_LIMIT_PER_HOUR = 300;
export const LISTING_USAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const hourStamp = time => new Date(time).toISOString().slice(0, 13).replace(/[-T:]/g, "");
const hourStart = stamp => Date.parse(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(8,10)}:00:00Z`);
const minuteStamp = time => new Date(time).toISOString().slice(0, 16).replace(/[-T:]/g, "");
const minuteStart = stamp => Date.parse(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(8,10)}:${stamp.slice(10,12)}:00Z`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// One aggregate blob per account and UTC hour. ETag conditional writes avoid lost increments
// when a subscriber opens several regions at once.
export async function recordListingRequest(store, accountId, { lawd = "search", route = "current", now = Date.now(), enforceLimit = true } = {}) {
  const stamp = hourStamp(now);
  const key = `hour:${accountId}:${stamp}`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const prior = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    const data = prior?.data;
    if (data?.blockedAt) return { allowed: false, requests: data.requests, blockedAt: data.blockedAt };

    const next = data ? { ...data } : { accountId, hour: stamp, requests: 0, regions: {}, routes: {}, minutes: {}, regionMinutes: {}, lastAt: 0 };
    if (enforceLimit && next.requests >= LISTING_USAGE_LIMIT_PER_HOUR) {
      next.blockedAt = now;
      const result = await store.setJSON(key, next, { onlyIfMatch: prior.etag });
      if (result.modified) return { allowed: false, requests: next.requests, blockedAt: next.blockedAt };
    } else {
      next.requests++;
      next.lastAt = now;
      next.regions[lawd] = (next.regions[lawd] || 0) + 1;
      next.routes[route] = (next.routes[route] || 0) + 1;
      const minute = minuteStamp(now);
      next.minutes[minute] = (next.minutes[minute] || 0) + 1;
      next.regionMinutes[minute] ||= {};
      next.regionMinutes[minute][lawd] = (next.regionMinutes[minute][lawd] || 0) + 1;
      const result = prior
        ? await store.setJSON(key, next, { onlyIfMatch: prior.etag })
        : await store.setJSON(key, next, { onlyIfNew: true });
      if (result.modified) return { allowed: true, requests: next.requests, blockedAt: null };
    }
    await delay(4 + Math.random() * 12);
  }
  throw new Error("listing_usage_write_conflict");
}

export async function listListingUsage(store, subscribers, now = Date.now()) {
  const windowStart = now - 24 * 60 * 60 * 1000;
  const queryStart = windowStart - 60 * 60 * 1000;
  const cutoff = now - LISTING_USAGE_RETENTION_MS;
  const { blobs } = await store.list({ prefix: "hour:" });
  const grouped = new Map();
  const staleKeys = [];
  for (let offset = 0; offset < blobs.length; offset += 50) await Promise.all(blobs.slice(offset, offset + 50).map(async ({ key }) => {
    const stamp = key.slice(-10);
    const timestamp = hourStart(stamp);
    if (!Number.isFinite(timestamp)) return;
    if (timestamp < cutoff) {
      if (staleKeys.length < 100) staleKeys.push(key);
      return;
    }
    if (timestamp < queryStart || timestamp > now) return;
    const data = await store.get(key, { type: "json", consistency: "strong" });
    if (!data) return;
    if (Math.max(Number(data.lastAt) || 0, Number(data.blockedAt) || 0) < windowStart) return;
    const entry = grouped.get(data.accountId) || { accountId: data.accountId, requests24h: 0, peakHour: 0, peakHours: new Map(), searches24h: 0, regions: new Set(), lastAt: 0, blockedAt: 0 };
    entry.lastAt = Math.max(entry.lastAt, Number(data.lastAt) || 0);
    entry.blockedAt = Math.max(entry.blockedAt, Number(data.blockedAt) || 0);
    for (const [minute, count] of Object.entries(data.minutes || {})) {
      const minuteTime = minuteStart(minute);
      if (minuteTime >= windowStart && minuteTime <= now) {
        const requests = Number(count) || 0;
        entry.requests24h += requests;
        entry.peakHours.set(hourStamp(minuteTime), (entry.peakHours.get(hourStamp(minuteTime)) || 0) + requests);
      }
    }
    for (const [minute, regions] of Object.entries(data.regionMinutes || {})) {
      const minuteTime = minuteStart(minute);
      if (minuteTime < windowStart || minuteTime > now) continue;
      for (const [code, count] of Object.entries(regions || {})) {
        if (code === "search") entry.searches24h += Number(count) || 0;
        else entry.regions.add(code);
      }
    }
    entry.peakHour = Math.max(entry.peakHour, ...entry.peakHours.values(), 0);
    grouped.set(data.accountId, entry);
  }));
  await Promise.all(staleKeys.map(key => store.delete(key).catch(() => {})));

  const names = new Map(subscribers.map(sub => [sub.id, sub.name]));
  return [...grouped.values()].map(entry => ({
    accountId: entry.accountId,
    name: entry.accountId === "shared" ? "공용 코드" : (names.get(entry.accountId) || "삭제된 구독자"),
    requests24h: entry.requests24h,
    peakHour: entry.peakHour,
    searches24h: entry.searches24h,
    regions24h: entry.regions.size,
    lastAt: entry.lastAt,
    blockedAt: entry.blockedAt || null,
    suspicious: entry.peakHour >= LISTING_USAGE_WARN_PER_HOUR,
  })).sort((a, b) => Number(!!b.blockedAt) - Number(!!a.blockedAt) || Number(b.suspicious) - Number(a.suspicious) || b.requests24h - a.requests24h);
}
