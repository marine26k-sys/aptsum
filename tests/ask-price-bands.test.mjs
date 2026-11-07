import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAskMap, loadCurrentAskMap} from '../netlify/functions/listings.mjs';
const item=(nid,ex,ask)=>({nid,ex,ask,occupancy:'available'});
test('금액대는 이번 주 평균 호가로 정하고 단지별 동일 비중으로 집계한다',async()=>{
 const data={
  'history-index:11680':[{uploadId:'a',asOf:'2026.10.26'},{uploadId:'b',asOf:'2026.11.02'}],
  'history:11680:a':{asOf:'2026.10.26',items:[item('1',84,4),item('1',59,4.5),item('2',84,4),item('3',84,5)]},
  'history:11680:b':{asOf:'2026.11.02',items:[item('1',84,4.4),item('1',59,4.95),item('2',84,4.4),item('3',84,5.5)]}
 };
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.equal(result.priceBandVersion,4);const bands=result.weekly.at(-1).priceBands;
 assert.equal(bands['4'].count,2);assert.ok(Math.abs(bands['4'].rate-10)<1e-8);
 assert.equal(bands['5'].count,1);assert.ok(Math.abs(bands['5'].rate-10)<1e-8);
});
test('기준 주와 매칭되는 전주 자료가 없는 평형은 금액대 표본에서 제외한다',async()=>{
 const data={'history-index:11680':[{uploadId:'a',asOf:'2026.10.26'},{uploadId:'b',asOf:'2026.11.02'}],
 'history:11680:a':{asOf:'2026.10.26',items:[item('1',84,3.8)]},
 'history:11680:b':{asOf:'2026.11.02',items:[item('1',84,4.1),item('2',84,4.5)]}};
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.equal(result.weekly.at(-1).priceBands['4'].count,1);
});

test('직전 주의 기록이 없으면 이전 주차를 건너뛰어 비교하지 않는다',async()=>{
 const data={'history-index:11680':[{uploadId:'a',asOf:'2026.10.19'},{uploadId:'b',asOf:'2026.11.02'}],
 'history:11680:a':{asOf:'2026.10.19',items:[item('1',84,4)]},
 'history:11680:b':{asOf:'2026.11.02',items:[item('1',84,4.4)]}};
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.deepEqual(result.weekly.at(-1).priceBands,{});
});

test('같은 기준일을 재업로드하면 마지막 자료만 해당 날짜의 주간 평균에 반영한다',async()=>{
 const data={'history-index:11680':[{uploadId:'a',asOf:'2026.10.26'},{uploadId:'b',asOf:'2026.11.02'},{uploadId:'c',asOf:'2026.11.02'},{uploadId:'d',asOf:'2026.11.03'}],
 'history:11680:a':{asOf:'2026.10.26',items:[item('1',84,10)]},
 'history:11680:b':{asOf:'2026.11.02',items:[item('1',84,9)]},
 'history:11680:c':{asOf:'2026.11.02',items:[item('1',84,11)]},
 'history:11680:d':{asOf:'2026.11.03',items:[item('1',84,11)]}};
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.ok(Math.abs(result.weekly.at(-1).priceBands['11'].rate-10)<1e-8);
});

test('금액대 경계에서 평균의 소수점 오차로 한 단계 낮아지지 않는다',async()=>{
 const dates=[['a','2026.10.26',4.8],['b','2026.11.02',4.6],['c','2026.11.03',5.3],['d','2026.11.04',5.1]];
 const data={'history-index:11680':dates.map(([uploadId,asOf])=>({uploadId,asOf}))};
 for(const [id,asOf,ask] of dates)data[`history:11680:${id}`]={asOf,items:[item('1',84,ask)]};
 const result=await buildAskMap({get:async key=>data[key]},'11680');
 assert.equal(result.weekly.at(-1).priceBands['5'].count,1);assert.equal(result.weekly.at(-1).priceBands['4'],undefined);
});
test('오래된 계산이 최신 집계 뒤에 끝나도 최신 이력으로 다시 계산한다',async()=>{
 const data=new Map(),code='11680',base={uploadId:'a',asOf:'2026.10.26'},old={uploadId:'b',asOf:'2026.11.02'},fresh={uploadId:'c',asOf:'2026.11.02'};
 data.set(`history-index:${code}`,[base,old]);
 data.set(`history:${code}:a`,{asOf:base.asOf,items:[item('1',84,10)]});
 data.set(`history:${code}:b`,{asOf:old.asOf,items:[item('1',84,9)]});
 data.set(`history:${code}:c`,{asOf:fresh.asOf,items:[item('1',84,11)]});
 let release,started;const blocked=new Promise(r=>release=r),entered=new Promise(r=>started=r);let delay=true;
 const store={async get(key){if(key===`history:${code}:b`&&delay){delay=false;started();await blocked;}return structuredClone(data.get(key)??null)},async setJSON(key,value){data.set(key,structuredClone(value))}};
 const first=loadCurrentAskMap(store,code);await entered;
 data.set(`history-index:${code}`,[base,old,fresh]);const latest=await loadCurrentAskMap(store,code);
 assert.ok(latest.weekly.at(-1).priceBands['11']);release();const delayed=await first;
 assert.ok(delayed.weekly.at(-1).priceBands['11']);
 assert.ok((await loadCurrentAskMap(store,code)).weekly.at(-1).priceBands['11']);
});
