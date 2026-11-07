import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAskMap} from '../netlify/functions/listings.mjs';
const item=(nid,ex,ask)=>({nid,ex,ask,occupancy:'available'});
test('금액대는 이번 주 평균 호가로 정하고 단지별 동일 비중으로 집계한다',async()=>{
 const data={
  'history-index:11680':[{uploadId:'a'},{uploadId:'b'}],
  'history:11680:a':{asOf:'2026.10.26',items:[item('1',84,4),item('1',59,4.5),item('2',84,4),item('3',84,5)]},
  'history:11680:b':{asOf:'2026.11.02',items:[item('1',84,4.4),item('1',59,4.95),item('2',84,4.4),item('3',84,5.5)]}
 };
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.equal(result.priceBandVersion,1);const bands=result.weekly.at(-1).priceBands;
 assert.equal(bands['4'].count,2);assert.ok(Math.abs(bands['4'].rate-10)<1e-8);
 assert.equal(bands['5'].count,1);assert.ok(Math.abs(bands['5'].rate-10)<1e-8);
});
test('기준 주와 매칭되는 전주 자료가 없는 평형은 금액대 표본에서 제외한다',async()=>{
 const data={'history-index:11680':[{uploadId:'a'},{uploadId:'b'}],
 'history:11680:a':{asOf:'2026.10.26',items:[item('1',84,3.8)]},
 'history:11680:b':{asOf:'2026.11.02',items:[item('1',84,4.1),item('2',84,4.5)]}};
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.equal(result.weekly.at(-1).priceBands['4'].count,1);
});
