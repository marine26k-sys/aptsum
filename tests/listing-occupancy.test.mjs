import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {cleanItem} from '../netlify/functions/listings.mjs';
const stats=readFileSync(new URL('../stats.html',import.meta.url),'utf8');
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function summarize(rows){
 const ctx=vm.createContext({});
 vm.runInContext('const MID_UP=new Set(["중층","고층"]);const MOVE_IN="입주가능";'+stats.slice(stats.indexOf('function summarizeListings('),stats.indexOf('async function postListings(')),ctx);
 return ctx.summarizeListings(rows);
}
const base={'시':'서울시','구':'강남구','법정동':'역삼동','단지명':'테스트','단지ID':123,'세대수':500,'전용면적(㎡)':84,'면적(평)':34,'실거래최고가(억)':20,'확인일':'20261002','층구분':'중층','입주구분':'입주가능','매매가(억)':15};
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
 const start=index.indexOf('function buildShareURL('),end=index.indexOf('// 공유 링크 진입 시 자동 검색',start);
 const ctx=vm.createContext({URLSearchParams,location:{pathname:'/'},isListingMode:()=>true});vm.runInContext(index.slice(start,end),ctx);
 const inp={mode:'listinggap',mN:'36',fM:'0',lawd:'11680',occupancy:'tenant'};
 assert.equal(new URL('https://example.com'+ctx.buildShareURL(inp)).searchParams.get('occupancy'),'tenant');
 assert.equal(new URL('https://example.com'+ctx.buildShareURL({...inp,occupancy:'available'})).searchParams.has('occupancy'),false);
});
