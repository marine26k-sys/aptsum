import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({exclusiveAreaKey:t=>Math.floor(t.area),dkey:t=>t.ym+t.d,ymLabel:x=>x,yearsLabel:()=> '3년',representativePy:items=>items[0].py,isRecentDeal:()=>false});
for(const [name,end] of [['analyzeRegion','// ═══ 신고가 탭'],['analyzePricePerPyeong','// ═══ 평형 비교 저평가']]){
 const start=html.indexOf(`function ${name}(`);
 vm.runInContext(html.slice(start,html.indexOf(end,start)),context);
}
const rows=Array.from({length:125},(_,i)=>({apt:`단지${i}`,umd:'동',area:59.9,py:25,ym:'202609',d:'01',amt:i+1}));
test('단지 랭킹은 100개를 넘겨도 가격순으로 모두 반환한다',()=>{
 const result=context.analyzeRegion(rows,['202609']);
 assert.equal(result.highDeals.length,125);
 assert.equal(result.highDeals[0].amt,125);
 assert.equal(result.highDeals[124].amt,1);
 assert.equal(result.topVolume.length,125);
});
test('조회한 평형 중 단지별 최고 거래 한 건만 표시한다',()=>{
 const trades=[
  {apt:'금호어울림',umd:'호계동',lawd:'41173',area:59.93,py:24,ym:'202604',d:'30',amt:4.5},
  {apt:'금호어울림',umd:'호계동',lawd:'41173',area:59.93,py:24,ym:'202604',d:'27',amt:4.4},
  {apt:'금호어울림',umd:'호계동',lawd:'41173',area:70.22,py:27,ym:'202607',d:'21',amt:4.8},
 ];
 const result=context.analyzeRegion(trades,['202604','202607']);
 assert.equal(result.topVolume.length,1);
 assert.deepEqual(Array.from(result.highDeals,row=>[row.area,row.py,row.amt]),[[70.22,'27평',4.8]]);
 const only24=context.analyzeRegion(trades.filter(row=>row.py===24),['202604','202607']);
 assert.deepEqual(Array.from(only24.highDeals,row=>[row.area,row.py,row.amt]),[[59.93,'24평',4.5]]);
});
test('평당가 랭킹은 표본 조건을 충족하는 100개 초과 단지를 모두 반환한다',()=>{
 const result=context.analyzePricePerPyeong(rows.flatMap(row=>[row,{...row,d:'02'}]),['202609']);
 assert.equal(result.pyPrice.length,125);
 assert.equal(result.pyPrice[0].amt,125);
 assert.equal(result.pyPrice[124].amt,1);
});
