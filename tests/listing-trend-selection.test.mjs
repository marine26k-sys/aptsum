import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {snapshotForHistory} from '../netlify/functions/listings.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ctx=vm.createContext({Date,Map,LISTING_MIN_HH:300,lsPyMatch:()=>true});
vm.runInContext(html.slice(html.indexOf('function listingTrendChoices('),html.indexOf('async function searchListingTrend(')),ctx);
const item=(ask,extra={})=>({nid:'a',ex:84,ask,hh:500,apt:'옛 단지',py:34,url:'https://fin.land.naver.com/articles/1',...extra});
const snapshots=[12,11,10,13].map((ask,i)=>({uploadId:`u${i}`,asOf:`2026.10.0${i+1}`,items:[item(ask)]}));
test('direction changes preserve selected filters and refresh existing results',()=>{
 const filters={p0:30,p1:40,q0:5,q1:15},limits={ask:{min:0,max:70}};let refreshed=0;
 const elements={listingTrendDirection:{value:'up'},loading:{classList:{contains:()=>false}}};
 const state=vm.createContext({mode:'listingtrend',lastData:{mode:'listingtrend'},document:{getElementById:id=>elements[id]},
  lsGet:()=>filters,lsSavedLimits:()=>limits,lsRestoreLimits:value=>assert.equal(value,limits),lsSet:value=>assert.equal(value,filters),
  setMode:next=>{state.mode=next;return true;},search:()=>refreshed++});
 vm.runInContext(html.slice(html.indexOf('function listingTrendDirectionApply('),html.indexOf('async function searchListingTrend(')),state);
 state.listingTrendDirectionApply();assert.equal(state.mode,'listingrise');assert.equal(refreshed,1);
 elements.listingTrendDirection.value='down';state.lastData=null;
 state.listingTrendDirectionApply();assert.equal(state.mode,'listingtrend');assert.equal(refreshed,1);
});
test('older selected uploads restore old declines even when newest upload rose or removed the apartment',()=>{
 assert.equal(ctx.listingTrendSnapshotRows(snapshots[3],snapshots,{},'11680','강남구').length,0);
 const previous=ctx.listingTrendSnapshotRows(snapshots[2],snapshots,{},'11680','강남구')[0];
 assert.equal(previous.drop,1);assert.equal(previous.ask,10);assert.equal(previous.apt,'옛 단지');assert.equal(previous.points.length,3);
 const twoBefore=ctx.listingTrendSnapshotRows(snapshots[1],snapshots,{},'11680','강남구')[0];
 assert.equal(twoBefore.drop,1);assert.equal(twoBefore.points.length,2);
 assert.equal(ctx.listingTrendSnapshotRows({...snapshots[3],items:[]},snapshots,{},'11680','강남구').length,0);
});
test('missing immediately previous listing and insufficient history never imply a decline',()=>{
 assert.equal(ctx.listingTrendSnapshotRows(snapshots[0],snapshots,{},'11680','강남구').length,0);
 const missing=snapshots.map((s,i)=>i===1?{...s,items:[]}:s);
 assert.equal(ctx.listingTrendSnapshotRows(missing[2],missing,{},'11680','강남구').length,0);
});
test('choices deduplicate regional uploads and expose only latest three uploads',()=>{
 const packs=[{history:{snapshots}},{history:{snapshots:snapshots.slice(2)}}];
 assert.equal(JSON.stringify(ctx.listingTrendChoices(packs).map(s=>s.uploadId)),JSON.stringify(['u3','u2','u1']));
});
test('history metadata uses historical values and filters occupancy without modifying stored snapshot',()=>{
 const data={uploadId:'old',asOf:'2026.10.01',items:[item(12),item(9,{occupancy:'tenant'})]};
 assert.equal(snapshotForHistory(data,'available',true).items[0].apt,'옛 단지');
 assert.deepEqual(snapshotForHistory(data,'tenant',false).items,[{nid:'a',ex:84,ask:9}]);
 assert.equal(data.items.length,2);
});

test('최신 가격이 유지돼도 이전 가격 구간보다 낮으면 하락 목록에 포함한다',()=>{
 const history=[4.5,4.2,4.2].map((ask,i)=>({uploadId:`u${i}`,asOf:`2026.10.0${i+1}`,items:[item(ask)]}));
 assert.equal(ctx.listingTrendSnapshotRows(history[2],history,{},'11680','강남구').length,1);
 for(const prices of [[4.2,4,4.2],[4.2,4,4.5]]){
  const h=history.map((s,i)=>({...s,items:[item(prices[i])]}));
  assert.equal(ctx.listingTrendSnapshotRows(h[2],h,{},'11680','강남구').length,0);
 }
 const missing=history.map((s,i)=>i===0?{...s,items:[]}:s);
 assert.equal(ctx.listingTrendSnapshotRows(missing[2],missing,{},'11680','강남구').length,0);
});

test('rounded equal comparison endpoints show two decimals only on affected prices',()=>{
 const c=vm.createContext({});
 vm.runInContext(html.slice(html.indexOf('function listingTrendPriceDigits('),html.indexOf('function listingTrendRowHTML(')),c);
 const points=[4.54,4.4,4.51].map(ask=>({ask}));
 assert.deepEqual(points.map((p,i)=>p.ask.toFixed(c.listingTrendPriceDigits(points,i,4.54))),['4.54','4.4','4.51']);
 assert.equal(c.listingTrendPrecision([points[0],points[2]]),2);
 const normal=[4.5,4.2,4.2].map(ask=>({ask}));
 assert.deepEqual(normal.map((p,i)=>p.ask.toFixed(c.listingTrendPriceDigits(normal,i,4.5))),['4.5','4.2','4.2']);
 const smallRise=[4.54,4.58].map(ask=>({ask}));
 assert.equal(c.listingTrendPrecision(smallRise),2);
 assert.deepEqual(smallRise.map((p,i)=>p.ask.toFixed(c.listingTrendPriceDigits(smallRise,i,4.54))),['4.54','4.58']);
});

test('continuous filter requires three consecutive records with two strict declines',()=>{
 for(const [prices,count] of [[[4.5,4.3,4.2],1],[[4.5,4.2,4.2],0],[[4.5,4.1,4.2],0],[[4.2,4.3,4.1],0]]){
  const h=prices.map((ask,i)=>({uploadId:`u${i}`,items:[item(ask)]}));
  assert.equal(ctx.listingTrendSnapshotRows(h[2],h,{},'11680','강남구',true).length,count);
 }
 assert.equal(ctx.listingTrendSnapshotRows(snapshots[1],snapshots,{},'11680','강남구',true).length,0);
 const h=snapshots.map((s,i)=>i===0?{...s,items:[]}:s);
 assert.equal(ctx.listingTrendSnapshotRows(h[2],h,{},'11680','강남구',true).length,0);
});

test('rise compares the same complex and exclusive area across the latest records',()=>{
 const history=[4.2,4.4,4.6].map((ask,i)=>({uploadId:`u${i}`,items:[item(ask),item(8,{ex:59})]}));
 const rows=ctx.listingTrendSnapshotRows(history[2],history,{},'11680','강남구',false,'up');
 assert.equal(rows.length,1);
 assert.equal(rows[0].drop,0.4);
 assert.equal(rows[0].prevAsk,4.2);
 assert.equal(rows[0].ask,4.6);
 assert.equal(ctx.listingTrendSnapshotRows(history[2],history,{},'11680','강남구',true,'up').length,1);
 assert.equal(ctx.listingTrendSnapshotRows(history[2],history,{},'11680','강남구',false,'down').length,0);
});

test('상승은 이전 구간 최저가를 기준으로 분류하고 연속 조건은 엄격하게 유지한다',()=>{
 for(const [prices,expected,continuous] of [
  [[4.2,4.5,4.4],1,0],[[4.2,4.5,4.2],0,0],[[4.2,4.2,4.4],1,0],[[4.2,4.4,4.4],1,0]
 ]){
  const h=prices.map((ask,i)=>({uploadId:`u${i}`,items:[item(ask)]}));
  assert.equal(ctx.listingTrendSnapshotRows(h[2],h,{},'11680','강남구',false,'up').length,expected);
  assert.equal(ctx.listingTrendSnapshotRows(h[2],h,{},'11680','강남구',true,'up').length,continuous);
 }
 const missing=[4.2,4.4,4.6].map((ask,i)=>({uploadId:`u${i}`,items:i===1?[]:[item(ask)]}));
 assert.equal(ctx.listingTrendSnapshotRows(missing[2],missing,{},'11680','강남구',false,'up').length,0);
});

test('newly appearing price filter compares identities rather than price changes',()=>{
 const c=vm.createContext({Set});
 vm.runInContext(html.slice(html.indexOf('function listingBudgetNewKeys('),html.indexOf('async function searchListingTab(')),c);
 const previous={uploadId:'old',items:[item(4.5)]};
 const current={uploadId:'now',items:[item(4.2),item(6,{nid:'b'}),item(7,{ex:110})]};
 assert.deepEqual([...c.listingBudgetNewKeys(current,[previous,current])],['b|84','a|110']);
 assert.equal(c.listingBudgetNewKeys(current,[current]),null);
 assert.equal(c.listingBudgetNewKeys(current,[previous]),null);
});

test('exclude changes at or above 25 percent for both directions including two-record history',()=>{for(const [from,to,direction,want] of [[100,75,'down',0],[100,75.01,'down',1],[100,125,'up',0],[100,124.99,'up',1],[75,50,'down',0]]){const history=[from,to].map((ask,i)=>({uploadId:'boundary'+i,asOf:'2026.10.0'+(i+1),items:[item(ask)]}));assert.equal(ctx.listingTrendSnapshotRows(history[1],history,{},'11680','강남구',false,direction).length,want);}});

test('호가 변동 탭도 단지 분석의 세 예시와 날짜·분류가 일치한다',()=>{
 for(const [prices,from,to,direction,date] of [[[15.8,16.5,15.5],15.8,15.5,'down','2026.10.04'],[[25,24,23.8],24,23.8,'down','2026.10.05'],[[28.5,29,29],28.5,29,'up','2026.10.04']]){
  const h=prices.map((ask,i)=>({uploadId:'example'+i,asOf:'2026.10.0'+(i+4),items:[item(ask)]}));
  const rows=ctx.listingTrendSnapshotRows(h[2],h,{},'11680','강남구',false,direction);
  assert.equal(rows.length,1);assert.equal(rows[0].prevAsk,from);assert.equal(rows[0].ask,to);assert.equal(rows[0].previousPricePoint.date,date);assert.equal(rows[0].drop,+Math.abs(to-from).toFixed(2));
 }
});
