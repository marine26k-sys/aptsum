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
test('평당가 랭킹은 표본 조건을 충족하는 100개 초과 단지를 모두 반환한다',()=>{
 const result=context.analyzePricePerPyeong(rows.flatMap(row=>[row,{...row,d:'02'}]),['202609']);
 assert.equal(result.pyPrice.length,125);
 assert.equal(result.pyPrice[0].amt,125);
 assert.equal(result.pyPrice[124].amt,1);
});
