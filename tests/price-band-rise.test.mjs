import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function filterPriceBandRows(');
const end = html.indexOf('function analyzePriceBandRise(', start);
const ctx = vm.createContext({});
vm.runInContext(html.slice(start, end), ctx);

test('selects apartments by their past price band boundaries', () => {
  const rows = [
    { id:'under', pastAvg:4.9 },
    { id:'lower', pastAvg:5.0 },
    { id:'middle', pastAvg:5.9 },
    { id:'upper', pastAvg:6.0 },
  ];
  assert.deepEqual(Array.from(ctx.filterPriceBandRows(rows, 5), x=>x.id), ['lower','middle']);
});

test('30 band includes every apartment at or above 30억원', () => {
  const rows = [{pastAvg:29.9},{pastAvg:30},{pastAvg:42.5}];
  assert.deepEqual(Array.from(ctx.filterPriceBandRows(rows, 30), x=>x.pastAvg), [30,42.5]);
});

test('selects apartments by their current price band when requested', () => {
  const rows = [
    { id:'past-five', pastAvg:5.2, recentAvg:6.9 },
    { id:'lower', pastAvg:6.1, recentAvg:7.0 },
    { id:'middle', pastAvg:7.3, recentAvg:7.9 },
    { id:'upper', pastAvg:8.0, recentAvg:8.0 },
  ];
  assert.deepEqual(Array.from(ctx.filterPriceBandRows(rows, 7, 'current'), x=>x.id), ['lower','middle']);
});

test('subscriber price-band tab has all requested periods and defaults to current band / 12 months', () => {
  const row = html.match(/<div class="row2" id="priceBandRow"[\s\S]*?<\/div>/)?.[0] || '';
  const periods = [...row.matchAll(/<option value="(3|6|9|12|24|36|48|60)"[^>]*>\1개월 전<\/option>/g)].map(m=>Number(m[1]));
  assert.deepEqual(periods, [3,6,9,12,24,36,48,60]);
  assert.match(row, /id="priceBandPeriodN"[\s\S]*?<option value="12" selected>12개월 전<\/option>/);
  assert.match(row, /id="priceBandN"[\s\S]*?<option value="" selected disabled>금액대 선택<\/option>/);
  assert.match(row, /id="priceBandBasis"[\s\S]*?value="current" selected>현재 금액대 기준[\s\S]*?value="past">과거 금액대 기준/);
  assert.match(html, /if\(inp\.pbb==='past'\) p\.set\('pbb', 'past'\)/);
  assert.match(html, /value = inp\.pbb==='past' \? 'past' : 'current'/);
  assert.doesNotMatch(row, /value="(?:3|5)" selected/);
  assert.match(html, /id="tabPBR" style="display:none"/);
  assert.match(html, /needsSubscriberSession\(m\)[\s\S]*?m==='pricebandrise'/);
  assert.match(html, /const isCurrentBasis = d\.priceBandBasis==='current';/);
  assert.match(html, /const focusLabel = isCurrentBasis \? `현재 \$\{d\.priceBandLabel\}` : `\$\{d\.periodM\}개월 전 \$\{d\.priceBandLabel\}`/);
  assert.match(html, /\$\{d\.periodM\}개월 전 평균<\/b><small>\$\{esc\(d\.pastPeriod\)\}/);
  assert.match(html, /최근 1개월 평균<\/b><small>\$\{esc\(d\.recentPeriod\)\}/);
  // 경기 전체 허용 조건은 ggAllAllowed()로 묶였다(2026.09) — 상한(REGION_MAX)과 '+ 경기 전체' 버튼이 둘 다 이 함수를 따른다
  assert.match(html, /function ggAllAllowed\(\)\{[\s\S]*?mode==='pricebandrise'[\s\S]*?\n\}/);
  assert.match(html, /if\(ggAllAllowed\(\)\) return REGION_MAX/);
  assert.match(html, /if\(i===0 && ggAllAllowed\(\)\)\{[\s\S]*?\+ 경기 전체/);
  assert.match(html, /const rows = matchedRows\.slice\(0,100\);/);
  assert.match(html, /matchedCount:matchedRows\.length, isLimited:matchedRows\.length>rows\.length/);
  assert.match(html, /개 중 상위 \$\{d\.rows\.length\}개/);
});

test('search controls use the compact tab-sized density on mobile', () => {
  assert.match(html, /\.search-box\{display:grid;gap:6px[\s\S]*?padding:9px/);
  assert.match(html, /select,input\.q\{[^}]*padding:7px 9px;font-size:12px/);
  assert.match(html, /\.go\{[^}]*padding:8px;font-size:12px/);
  assert.match(html, /\.cmp-row input\{[^}]*padding:7px 9px;font-size:12px/);
  assert.match(html, /\.rgpick\{[\s\S]*?padding:7px 9px;[\s\S]*?font-size:12px/);
});

test('existing sale-change period selector remains unchanged', () => {
  const row = html.match(/<div class="row2" id="risePeriodRow"[\s\S]*?<\/div>/)?.[0] || '';
  const periods = [...row.matchAll(/<option value="(\d+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(periods, [3,6,9,12,24]);
  assert.doesNotMatch(row, /36개월|48개월|60개월/);
});
