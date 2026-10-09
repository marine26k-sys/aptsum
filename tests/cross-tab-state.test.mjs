import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('share URL preserves build-year and weekly-new-high state', () => {
  const start = html.indexOf('function buildShareURL(');
  const end = html.indexOf('async function initFromURL(', start);
  const ctx = vm.createContext({ URLSearchParams, location:{ pathname:'/index.html' } });
  vm.runInContext(html.slice(start, end), ctx);
  const url = ctx.buildShareURL({
    mode:'newhigh', mN:'36', fM:'0', by:'under10', nh7:true,
    cmp:[], lawd:'41135', q:'', regionSel:[], pym:[], rp:'', pbp:'', pb:''
  });
  const params = new URL('https://example.test'+url).searchParams;
  assert.equal(params.get('by'), 'under10');
  assert.equal(params.get('nh7'), '1');
});

test('subscriber state is closure-protected and URL restore waits for session check', () => {
  assert.doesNotMatch(html, /window\.aptsumSubscriberVerified\s*=/);
  assert.match(html, /const aptsumSubscriberGate = \(\(\) => \{/);
  assert.match(html, /return Object\.freeze\(\{ ready, isVerified:/);
  assert.match(html, /async function initFromURL\(\)[\s\S]*?await aptsumSubscriberGate\.ready/);
  assert.match(html, /if\(!setMode\(requestedMode, true\)\)/);
});
test('네이버 실매물 기준 제목을 세 번 누르면 코드 세션에서 로그아웃한다', async () => {
  const listeners = {};
  const element = () => ({style:{},classList:{remove(){}},addEventListener(type,handler){listeners.title=handler;}});
  const title = element();
  const nodes = Object.fromEntries(['tabNL','tabLPD','tabNH7','tabPBR','tabSubDivider','tabApply'].map(id=>[id,element()]));
  let now=1000, logouts=0, reloads=0;
  const context={
    document:{addEventListener(type,handler){listeners.ready=handler;},getElementById(id){return nodes[id]||null;},querySelector(){return title;}},
    aptsumSession:{check:async()=>Response.json({subscribed:true,scope:'all'}),logout:async()=>{logouts++;return Response.json({subscribed:false});}},
    Date:{now:()=>now},location:{reload(){reloads++;}},alert(){throw new Error('unexpected alert');},
  };
  vm.runInNewContext(html.slice(html.indexOf('const aptsumSubscriberGate = (() => {'),html.indexOf('const SUBSCRIBER_APPLY_LINK')),context);
  listeners.ready();
  await Promise.resolve();
  await listeners.title();now+=400;
  await listeners.title();now+=400;
  assert.equal(logouts,0);
  await listeners.title();
  assert.equal(logouts,1);
  assert.equal(reloads,1);
});

test('build-year is restored for shared URLs and browser history', () => {
  assert.match(html, /p\.get\('by'\)[\s\S]*?setBuildYearValue\(p\.get\('by'\)\)/);
  assert.match(html, /setBuildYearValue\(inp\.by \|\| ''\)/);
});

test('complex comparison rejects named apartments without regions', () => {
  assert.match(html, /filledCmpItems\.some\(x=>!x\.lawd\)[\s\S]*?각 단지의 지역을 선택해 주세요/);
});
