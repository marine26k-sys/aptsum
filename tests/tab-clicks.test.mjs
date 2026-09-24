import test from 'node:test';
import assert from 'node:assert/strict';
import { recordTabs, TAB_IDS } from '../netlify/functions/tab-clicks.mjs';
import { readFileSync } from 'node:fs';

// Netlify Blobs의 조건부 쓰기(etag)를 흉내 내는 메모리 저장소
function fakeStore() {
  const m = new Map(); let ver = 0;
  return {
    m,
    async getWithMetadata(key) { const v = m.get(key); return v ? { data: v.data, etag: v.etag } : null; },
    async set(key, data, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      m.set(key, { data, etag: String(++ver) }); return { modified: true };
    },
  };
}
const count = (s, day) => JSON.parse(s.m.get(`count:${day}`)?.data || '{}');

test('counts each tab once per visitor per day', async () => {
  const s = fakeStore();
  assert.deepEqual(await recordTabs(s, '2026-09-24', 'v1', ['tabC', 'tabR']), ['tabC', 'tabR']);
  assert.deepEqual(await recordTabs(s, '2026-09-24', 'v1', ['tabR', 'tabGap']), ['tabGap']);
  assert.deepEqual(await recordTabs(s, '2026-09-24', 'v2', ['tabR']), ['tabR']);
  assert.deepEqual(await recordTabs(s, '2026-09-24', 'v1', ['tabC']), []);
  assert.deepEqual(count(s, '2026-09-24'), { tabC: 1, tabR: 2, tabGap: 1 });
  // 다음 날은 다시 센다
  await recordTabs(s, '2026-09-25', 'v1', ['tabC']);
  assert.deepEqual(count(s, '2026-09-25'), { tabC: 1 });
});

test('concurrent visitors do not overwrite each other', async () => {
  const s = fakeStore();
  await Promise.all(Array.from({ length: 5 }, (_, i) => recordTabs(s, '2026-09-24', `v${i}`, ['tabC'])));
  assert.deepEqual(count(s, '2026-09-24'), { tabC: 5 });
});

test('every tab id in index.html is tracked', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/class="tab[^"-][^"]*" id="(tab[A-Za-z0-9]+)"|class="tab" id="(tab[A-Za-z0-9]+)"/g)].map(m => m[1] || m[2]);
  assert.deepEqual([...new Set(ids)].sort(), [...TAB_IDS].sort());
});
