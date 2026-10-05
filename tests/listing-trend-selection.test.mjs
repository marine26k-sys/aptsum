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
test('older selected uploads restore old declines even when newest upload rose or removed the apartment',()=>{
 assert.equal(ctx.listingTrendSnapshotRows(snapshots[3],snapshots,{},'11680','강남구').length,0);
 const previous=ctx.listingTrendSnapshotRows(snapshots[2],snapshots,{},'11680','강남구')[0];
 assert.equal(previous.drop,2);assert.equal(previous.ask,10);assert.equal(previous.apt,'옛 단지');assert.equal(previous.points.length,3);
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

test('recent three records retain a decline when newest price is unchanged',()=>{
 const history=[4.5,4.2,4.2].map((ask,i)=>({uploadId:`u${i}`,asOf:`2026.10.0${i+1}`,items:[item(ask)]}));
 const row=ctx.listingTrendSnapshotRows(history[2],history,{},'11680','강남구')[0];
 assert.equal(row.drop,0.3);assert.equal(row.prevAsk,4.5);assert.equal(row.ask,4.2);
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
