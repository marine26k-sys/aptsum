import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {cleanItem, dailyHistoryIndex, snapshotForHistory, listingItemsForFloor} from '../netlify/functions/listings.mjs';
const stats=readFileSync(new URL('../stats.html',import.meta.url),'utf8');
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function summarize(rows){
 const ctx=vm.createContext({});
 vm.runInContext('const MID_UP=new Set(["중층","고층"]);const MOVE_IN="입주가능";'+stats.slice(stats.indexOf('function summarizeListings('),stats.indexOf('async function postListings(')),ctx);
 return ctx.summarizeListings(rows);
}
const base={'시':'서울시','구':'강남구','법정동':'역삼동','단지명':'테스트','단지ID':123,'세대수':500,'전용면적(㎡)':84,'면적(평)':34,'실거래최고가(억)':20,'확인일':'20261002','층구분':'중층','입주구분':'입주가능','매매가(억)':15};
test('업로드 요약과 API 저장은 역거리(분)를 보존하고 빈 값은 생략한다',()=>{
 const withDistance=summarize([{...base,'역거리 (분)':10}]).regions['서울시|강남구'][0];
 assert.equal(withDistance.subwayMinutes,10);
 assert.equal(cleanItem(withDistance).subwayMinutes,10);
 const withoutDistance=summarize([{...base,'역거리 (분)':'-'}]).regions['서울시|강남구'][0];
 assert.equal(Object.hasOwn(withoutDistance,'subwayMinutes'),false);
 assert.equal(Object.hasOwn(cleanItem(withoutDistance),'subwayMinutes'),false);
 assert.equal(cleanItem({...withDistance,subwayMinutes:-2}).subwayMinutes,undefined);
});
test('upload keeps separate cheapest eligible offers with a shared historical peak',()=>{
 const d=summarize([base,{...base,'입주구분':'세안고','매매가(억)':12},{...base,'입주구분':'세안고','매매가(억)':13},{...base,'층구분':'저층','매매가(억)':8,'실거래최고가(억)':22},{...base,'입주구분':'미정','매매가(억)':7}]);
 const a=d.regions['서울시|강남구'];assert.equal(a.length,2);
 const ready=a.find(x=>x.occupancy==='available'),tenant=a.find(x=>x.occupancy==='tenant');
 assert.equal(ready.ask,15);assert.equal(ready.n,1);assert.equal(tenant.ask,12);assert.equal(tenant.n,2);
 assert.equal(ready.peak,22);assert.equal(tenant.peak,22);
 assert.equal(summarize([{...base,'입주구분':'세안고'}]).types,1);
});
test('sanitization preserves occupancy and treats old summaries as available',()=>{
 assert.equal(cleanItem({nid:'1',ex:84,peak:20,ask:12,occupancy:'tenant'}).occupancy,'tenant');
 assert.equal(cleanItem({nid:'1',ex:84,peak:20,ask:15}).occupancy,'available');
});
test('share link keeps tenant selection and omits the default',()=>{
 const start=index.indexOf('function buildShareURL('),end=index.indexOf('async function initFromURL(',start);
 const ctx=vm.createContext({URLSearchParams,location:{pathname:'/'},isListingMode:()=>true});vm.runInContext(index.slice(start,end),ctx);
 const inp={mode:'listinggap',mN:'36',fM:'0',lawd:'11680',occupancy:'tenant'};
 assert.equal(new URL('https://example.com'+ctx.buildShareURL(inp)).searchParams.get('occupancy'),'tenant');
 assert.equal(new URL('https://example.com'+ctx.buildShareURL({...inp,occupancy:'available'})).searchParams.has('occupancy'),false);
});

test('same-day reuploads compare against the previous date without deleting stored history',()=>{
 const index=[{uploadId:'a',asOf:'2026.10.01'},{uploadId:'b',asOf:'2026.10.02'},{uploadId:'c',asOf:'2026-10-02'}];
 const daily=dailyHistoryIndex(index);
 assert.deepEqual(daily.map(x=>x.uploadId),['a','c']);
 assert.equal(index.length,3);
 const prices={a:15,b:12.5,c:12.5};
 assert.equal(prices[daily[0].uploadId]-prices[daily[1].uploadId],2.5);
 assert.equal(dailyHistoryIndex([{uploadId:'x'},{uploadId:'y'}]).length,2);
});


test('presale upload keeps no-peak offers separate and excludes low floors',()=>{
 const rows=[{...base,'입주구분':'분양권','실거래최고가(억)':null,'매매가(억)':9},
 {...base,'입주구분':'분양권','실거래최고가(억)':null,'매매가(억)':10},
 {...base,'입주구분':'분양권','실거래최고가(억)':null,'층구분':'저층','매매가(억)':8},
 {...base,'입주구분':'입주가능','실거래최고가(억)':null}];
 const items=summarize(rows).regions['서울시|강남구'];
 assert.equal(items.length,1);assert.equal(items[0].occupancy,'presale');assert.equal(items[0].ask,9);assert.equal(items[0].n,2);
 const cleaned=cleanItem(items[0]);assert.equal(cleaned.peak,0);assert.equal(cleaned.occupancy,'presale');
 assert.equal(cleanItem({...cleaned,occupancy:'available'}),null);assert.equal(cleanItem({...cleaned,ask:0}),null);
 assert.equal(snapshotForHistory({items:[cleaned,cleanItem({nid:'2',ex:84,peak:20,ask:12,occupancy:'tenant'})]},'presale',true).items.length,1);
});
test('presale share selection is limited to budget and normalization rejects other tabs',()=>{
 const start=index.indexOf('function buildShareURL('),end=index.indexOf('async function initFromURL(',start);
 const ctx=vm.createContext({URLSearchParams,location:{pathname:'/'},isListingMode:()=>true});
 vm.runInContext(index.slice(start,end),ctx);
 const inp={mode:'listingbudget',mN:'12',fM:'0',lawd:'11680',occupancy:'presale'};
 assert.equal(new URL('https://example.com'+ctx.buildShareURL(inp)).searchParams.get('occupancy'),'presale');
 assert.equal(new URL('https://example.com'+ctx.buildShareURL({...inp,mode:'listingurgent'})).searchParams.has('occupancy'),false);
 vm.runInContext(index.slice(index.indexOf('function normalizeListingOccupancy('),index.indexOf('function listingOccupancy(){')),ctx);
 assert.equal(ctx.normalizeListingOccupancy('presale','listingbudget'),'presale');
 assert.equal(ctx.normalizeListingOccupancy('presale','listingurgent'),'available');
});

test('changing occupancy never queries and cancels the previous condition',()=>{
 const elements={loading:{classList:{remove(){}}},btn:{disabled:true},result:{innerHTML:'old results',classList:{remove(){}}}};
 let calls=0,aborts=0;
 const ctx=vm.createContext({searchToken:1,lastData:{mode:'listingbudget'},searchAbortController:{abort(){aborts++;}},document:{getElementById:id=>elements[id]},search(){calls++;}});
 vm.runInContext(index.slice(index.indexOf('function listingOccupancyApply('),index.indexOf('async function fetchListings(')),ctx);
 ctx.listingOccupancyApply();
 assert.equal(calls,0);assert.equal(aborts,1);assert.equal(ctx.searchToken,2);assert.equal(ctx.lastData,null);assert.equal(elements.result.innerHTML,'');assert.equal(elements.btn.disabled,false);
 ctx.searchAbortController=null;ctx.listingOccupancyApply();assert.equal(calls,0);
});


test('floor scopes keep separate minimums, matching links and low-only types',()=>{
 const d=summarize([base,{...base,'층구분':'저층','매매가(억)':8,'매물링크':'https://fin.land.naver.com/articles/low'}, {...base,'전용면적(㎡)':59,'층구분':'저층','매매가(억)':6}]);
 const items=d.regions['서울시|강남구'].map(cleanItem);
 const mid=listingItemsForFloor(items,'available'),all=listingItemsForFloor(items,'available','all');
 assert.equal(mid.length,1);assert.equal(mid[0].ask,15);
 assert.equal(all.length,2);assert.equal(all.find(x=>x.ex===84).ask,8);
 assert.equal(all.find(x=>x.ex===84).url,'https://fin.land.naver.com/articles/low');
 assert.equal(snapshotForHistory({items},'available').items.length,1);
 assert.equal(listingItemsForFloor([{ask:10,occupancy:'available'}],'available','all').length,0);
});

test('latest Excel transaction keeps its own price, date and floor through API upload',()=>{
 const old={...base,'최근 거래금액(억)':34.5,'최근 거래일':'2026-09-15','최근 거래층':12};
 const newer={...base,'최근 거래금액(억)':35.2,'최근 거래일':'2026-10-01','최근 거래층':8};
 const item=summarize([newer,old]).regions['서울시|강남구'][0];
 assert.deepEqual(JSON.parse(JSON.stringify(cleanItem(item).latestSale)),{price:35.2,date:'20261001',floor:8});
 assert.equal(cleanItem(summarize([base]).regions['서울시|강남구'][0]).latestSale,undefined);
 assert.equal(cleanItem({...item,latestSale:{price:2,date:'20261301',floor:1}}).latestSale,undefined);
 assert.equal(cleanItem({...item,latestSale:{price:2,date:'202609',floor:''}}).latestSale.floor,null);
 assert.equal(cleanItem({...item,latestSale:{price:-1,date:'202609',floor:1}}).latestSale,undefined);
});
