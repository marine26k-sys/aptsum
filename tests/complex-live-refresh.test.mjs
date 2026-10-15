import test from 'node:test';import assert from 'node:assert/strict';
import {latestTwoKoreanMonths,fetchComplexLiveMonths} from '../shared/complex-live-refresh.mjs';
test('한국시간 월초와 연초에도 최근 두 달만 선택한다',()=>{
 assert.deepEqual(latestTwoKoreanMonths(Date.parse('2027-01-01T05:00:00+09:00')),['202701','202612']);
});
test('해당 단지 지역 한 곳의 세 종류만 실시간 호출한다',async()=>{
 const urls=[];const results=await fetchComplexLiveMonths('11440',async(url,options)=>{
  urls.push(url);assert.equal(options.cache,'no-store');const q=new URL(url,'https://example.test').searchParams;
  assert.equal(q.get('lawd'),'11440');assert.equal(q.get('live'),'1');assert.equal(q.get('yms').split(',').length,2);
  return Response.json({items:[],failedMonths:[]});
 });assert.equal(urls.length,3);assert.deepEqual(results.map(x=>x.kind),['analyze','presale','rent']);
});
test('일부 종류나 월이 실패하면 전체 갱신 결과를 반환하지 않는다',async()=>{
 await assert.rejects(fetchComplexLiveMonths('11440',async()=>Response.json({items:[],failedMonths:['202610']})),/기존 자료/);
 await assert.rejects(fetchComplexLiveMonths('ALL:서울'),/지역/);
});
