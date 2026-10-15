import test from 'node:test';
import assert from 'node:assert/strict';
import { latestTradeSlot, shouldCollectTrades } from '../scripts/trade-batch-gate.mjs';
const time = value => Date.parse(`2026-10-15T${value}+09:00`);
const success = { startedAt:'2026-10-15T06:31:00+09:00',finishedAt:'2026-10-15T06:35:00+09:00',status:'success',fullScope:true,failedMonths:[],failedSteps:[] };
test('한국시간 하루 세 회차의 경계와 자정',()=>{
 assert.equal(latestTradeSlot(time('00:00:00')),Date.parse('2026-10-14T18:00:00+09:00'));
 assert.equal(latestTradeSlot(time('04:59:59')),Date.parse('2026-10-14T18:00:00+09:00'));
 for(const [before,after,previous] of [['11:59:59','12:00:00','05:00:00'],['17:59:59','18:00:00','12:00:00']]){
  assert.equal(latestTradeSlot(time(before)),time(previous));
  assert.equal(latestTradeSlot(time(after)),time(after));
 }
 assert.equal(latestTradeSlot(time('05:00:00')),time('05:00:00'));
 assert.equal(latestTradeSlot(time('23:59:59')),time('18:00:00'));
});
test('누락과 실패는 복구하고 전체 성공 회차만 건너뛴다',()=>{
 const now=time('07:00:00');
 assert.equal(shouldCollectTrades(success,now),false);
 for(const report of [undefined,{}, {...success,status:'partial_failure'}, {...success,fullScope:false}, {...success,fullScope:undefined}, {...success,failedMonths:['example']}, {...success,failedSteps:['example']}, {...success,startedAt:'invalid'}, {...success,finishedAt:'2026-10-16T00:00:00+09:00'}]) assert.equal(shouldCollectTrades(report,now),true);
 assert.equal(shouldCollectTrades(success,time('12:00:00')),true);
});
test('오전부터 실행한 수집이 오후에 끝나도 오후 회차를 생략하지 않는다',()=>{
 assert.equal(shouldCollectTrades({...success,finishedAt:'2026-10-15T18:40:00+09:00'},time('19:00:00')),true);
});
