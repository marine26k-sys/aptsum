import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function isNewlyCollectedDeal');
const end=html.indexOf('// 준공연도',start);
const context={Date};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);

test('최초 확인 후 7일 이내만 신규 거래로 표시한다',()=>{
  const now=Date.parse('2026-10-21T03:00:00.000Z');
  assert.equal(context.isNewlyCollectedDeal({firstSeenAt:'2026-10-15T03:00:00.000Z'},7,now),true);
  assert.equal(context.isNewlyCollectedDeal({firstSeenAt:'2026-10-14T02:59:59.000Z'},7,now),false);
  assert.equal(context.isNewlyCollectedDeal({},7,now),false);
});

test('신규 거래 N 배지는 평형·최고가 열에 청록색으로 표시한다',()=>{
  const start=html.indexOf('function tradesHTML');
  const end=html.indexOf('function showMoreTrades',start);
  const source=html.slice(start,end);
  assert.match(source,/<td>\$\{esc\(t\.date\)\}<\/td><td>[\s\S]*trade-new-badge/);
  assert.doesNotMatch(source,/\$\{esc\(t\.date\)\}\$\{isNewlyCollectedDeal/);
});
