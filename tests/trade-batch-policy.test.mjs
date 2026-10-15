import test from 'node:test';
import assert from 'node:assert/strict';
import {recentTradeMonths,coversFullTradeBatch} from '../shared/trade-batch-policy.mjs';
test('월초 05시 수집은 UTC가 전날이어도 한국시간 최신월을 포함한다',()=>{
 assert.deepEqual(recentTradeMonths(4,Date.parse('2026-11-01T05:00:00+09:00')),['202611','202610','202609','202608']);
 assert.deepEqual(recentTradeMonths(4,Date.parse('2027-01-01T05:00:00+09:00')),['202701','202612','202611','202610']);
});
test('최근 4개월 전체 종류 전체 지역 수집만 회차 성공으로 인정한다',()=>{
 const opt={kinds:['analyze','presale','rent'],months:24,refresh:4,only:null};
 assert.equal(coversFullTradeBatch(opt),true);
 for(const change of [{months:1},{refresh:1},{only:['11440']},{kinds:['analyze']}])assert.equal(coversFullTradeBatch({...opt,...change}),false);
});
