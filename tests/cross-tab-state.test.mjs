import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('share URL preserves build-year and weekly-new-high state', () => {
  const start = html.indexOf('function buildShareURL(');
  const end = html.indexOf('// 공유 링크 진입 시 자동 검색', start);
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

test('build-year is restored for shared URLs and browser history', () => {
  assert.match(html, /p\.get\('by'\)[\s\S]*?getElementById\('buildYear'\)\.value = p\.get\('by'\)/);
  assert.match(html, /getElementById\('buildYear'\)\.value = inp\.by \|\| ''/);
});

test('complex comparison rejects named apartments without regions', () => {
  assert.match(html, /filledCmpItems\.some\(x=>!x\.lawd\)[\s\S]*?각 단지의 지역을 선택해 주세요/);
});
