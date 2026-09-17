import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { currentAndPrevYm, collectMonths } from '../shared/month-fetch.mjs';

test('KST month boundaries, month ends and leap years', () => {
  for (const [iso, cur, prev] of [
    ['2026-03-31T03:00:00Z','202603','202602'],
    ['2026-05-31T03:00:00Z','202605','202604'],
    ['2024-03-31T03:00:00Z','202403','202402'],
    ['2026-12-31T15:00:00Z','202701','202612'],
    ['2026-08-31T14:59:59Z','202608','202607'],
    ['2026-08-31T15:00:00Z','202609','202608'],
  ]) assert.deepEqual(currentAndPrevYm(Date.parse(iso)), {cur, prev});
});

test('partial, error and thrown months are excluded; valid empty months succeed', async () => {
  const result = await collectMonths(['202601','202602','202603','202604','202605','202601'], async ym => {
    if (ym === '202602') return {items:[{ym}], anyFailed:true};
    if (ym === '202603') return {error:'upstream error'};
    if (ym === '202604') throw Error('timeout');
    return {items:ym === '202605' ? [] : [{ym}], anyFailed:false};
  });
  assert.deepEqual(result, {items:[{ym:'202601'}], failedMonths:['202602','202603','202604'], anyFailed:true});
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cacheCode = html.slice(html.indexOf('function applyMonthResults('), html.indexOf('async function fetchChunksLimited('));
test('browser cache preserves failed month and timestamp; retry replaces without duplication', () => {
  const ctx = vm.createContext({});
  vm.runInContext(cacheCode, ctx);
  const old = {t:1, items:[{ym:'202602', amt:100}]};
  const cache = {'202602':old};
  ctx.applyMonthResults(cache, ['202601','202602'], {items:[{ym:'202601',amt:200},{ym:'202602',amt:999}], failedMonths:['202602']}, 2);
  assert.equal(cache['202602'], old);
  assert.equal(cache['202601'].items.length, 1);
  ctx.applyMonthResults(cache, ['202602'], {items:[{ym:'202602',amt:300}], failedMonths:[]}, 3);
  assert.equal(cache['202602'].t, 3);
  assert.equal(cache['202602'].items.length, 1);
  assert.equal(cache['202602'].items[0].amt, 300);
  ctx.applyMonthResults(cache, ['202602'], null, 4);
  assert.equal(cache['202602'].t, 3);
  ctx.applyMonthResults(cache, ['202602'], {items:[],failedMonths:[]}, 5);
  assert.equal(cache['202602'].items.length, 0);
});

for (const name of ['analyze','presale','rent']) {
  test(`${name}: actual handler propagates month failures and disables CDN caching`, async () => {
    const source = readFileSync(new URL(`../netlify/functions/${name}.mjs`, import.meta.url), 'utf8');
    const handlerSource = source.slice(source.indexOf('export default async')).replace('export default', 'handler =');
    const ctx = vm.createContext({URL, Response, process:{env:{DATA_GO_KR_KEY:'test-only'}}, SPLIT_REGIONS:{}, currentAndPrevYm:()=>({cur:'202609',prev:'202608'}), collectMonths,
      fetchShard:async (_key,_lawd,[ym])=>({items:[{ym}], anyFailed:ym==='202608'})});
    vm.runInContext(handlerSource, ctx);
    const response = await ctx.handler(new Request('https://example.test/api/'+name+'?lawd=26110&yms=202609,202608'));
    assert.deepEqual(await response.json(), {items:[{ym:'202609'}], failedMonths:['202608']});
    assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),'no-store');
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const ok = await ctx.handler(new Request('https://example.test/api/'+name+'?lawd=26110&yms=202601'));
    assert.deepEqual((await ok.json()).failedMonths, []);
    assert.match(ok.headers.get('Netlify-CDN-Cache-Control'), /2592000/);
  });
}

test('all browser inline scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});

test('total failure stays retryable and successful retry clears warning', async () => {
  const allFailed = await collectMonths(['202601','202602'], async () => { throw Error('offline'); });
  assert.deepEqual(allFailed.failedMonths, ['202601','202602']);
  assert.deepEqual(allFailed.items, []);
  const warning = {hidden:true};
  const start = html.indexOf('const CHUNK_CONCURRENCY =');
  const end = html.indexOf('async function ensureMonths(', start);
  const ctx = vm.createContext({document:{getElementById:()=>warning}});
  vm.runInContext(html.slice(start,end), ctx);
  let fail = true;
  async function fetchMonth() { return fail ? allFailed : {items:[],failedMonths:[]}; }
  await ctx.fetchChunksLimited([['202601','202602']], fetchMonth, '26110');
  assert.equal(warning.hidden, false);
  fail = false;
  await ctx.fetchChunksLimited([['202601','202602']], fetchMonth, '26110');
  assert.equal(warning.hidden, true);
});
