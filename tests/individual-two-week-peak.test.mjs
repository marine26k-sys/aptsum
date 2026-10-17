import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const c=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function previousListingPricePoint('),html.indexOf('function listingTrendPeakChangeHTML(')),c);
const now=Date.parse('2026-10-17T00:00:00Z');
const snapshots=values=>values.map((ask,i)=>({asOf:`2026.10.${String(i+4).padStart(2,'0')}`,items:[{nid:'synthetic',ex:59,ask}]}));
for(const [values,expected,day] of [[[15.8,15.8,16.5,16.5,15.5],15.8,'2026.10.05'],[[25,25,24,24,23.8],24,'2026.10.07'],[[28.5,28.5,29,29,29],28.5,'2026.10.05'],[[25,24.5,24,23.8],24,'2026.10.06'],[[10,10,10],10,'2026.10.05']]){
 test(`이전 최저 호가와 기록 날짜 ${values.join('→')}`,()=>{
  const p=c.previousListingPricePoint({nid:'synthetic',ex:59,ask:values.at(-1)},snapshots(values),now);assert.equal(p.ask,expected);assert.equal(p.date,day);
 });
}
test('기간 밖·다른 평형은 제외하고 이전 이력이 없으면 비교하지 않는다',()=>{
 const data=[{asOf:'2026.10.03',items:[{nid:'synthetic',ex:59,ask:1}]},...snapshots([12,11,10]),{asOf:'2026.10.16',items:[{nid:'synthetic',ex:84,ask:2}]}];
 assert.equal(c.previousListingPricePoint({nid:'synthetic',ex:59,ask:10},data,now).ask,11);
 assert.equal(c.previousListingPricePoint({nid:'synthetic',ex:59,ask:10},[],now),null);
});
