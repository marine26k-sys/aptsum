import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import { applyNaverSupplyAreas,applySupplyAreaOverrides } from '../shared/supply-area-loader.mjs';
const row={apt:'단지',hh:100,exclusiveArea:194.98,supplyArea:232};
test('verified supply areas can correct large interpolation errors',()=>{
 assert.equal(applyNaverSupplyAreas([{apt:'단지',area:194.98,py:77}],[row])[0].py,70);
 assert.equal(applyNaverSupplyAreas([{apt:'단지',area:194.98,py:77,hh:101}],[row])[0].py,77);
});
test('ambiguous rounded types and household conflicts preserve the existing estimate',()=>{
 const items=[{apt:'단지',area:194.98,py:77}];
 for(const rows of [[row,{...row,supplyArea:250}],[row,{...row,hh:101}],[{...row,hh:0}],[{...row,supplyArea:194}],[{...row,exclusiveArea:NaN}]])assert.equal(applyNaverSupplyAreas(items,rows)[0].py,77);
});
test('runtime uses the same calibration for split districts and tolerates absent files',async()=>{
 const prior=globalThis.fetch;
 try{globalThis.fetch=async url=>url.includes('supply-area-naver')?Response.json([row]):new Response('',{status:404});
 assert.equal((await applySupplyAreaOverrides([{apt:'단지',area:194.98,py:77}],'HS-동탄구','https://fixture-calibration.test'))[0].py,70);
 globalThis.fetch=async()=>{throw new Error('offline');};
 assert.equal((await applySupplyAreaOverrides([{apt:'단지',area:194.98,py:77}],'11680','https://fixture-offline.test'))[0].py,77);
 }finally{globalThis.fetch=prior;}
});
test('all exported data has only the four allowed fields and no ambiguous type or household keys',()=>{
 const dir=new URL('../data/supply-area-naver/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.json'))){
  const rows=JSON.parse(readFileSync(new URL(f,dir)));const hh=new Map();const keys=new Set();
  for(const r of rows){assert.deepEqual(Object.keys(r).sort(),['apt','exclusiveArea','hh','supplyArea']);assert.ok(r.hh>0&&r.supplyArea>r.exclusiveArea);const k=r.apt+'|'+Math.round(r.exclusiveArea);assert.equal(keys.has(k),false,`${f} ${k}`);keys.add(k);assert.ok(!hh.has(r.apt)||hh.get(r.apt)===r.hh);hh.set(r.apt,r.hh);}
 }
});

for(const kind of ['analyze','presale','rent'])test(`${kind}: actual API returns the calibrated pyeong for historical transactions`,async()=>{
 const priorFetch=globalThis.fetch;const priorKey=process.env.DATA_GO_KR_KEY;
 try{
  process.env.DATA_GO_KR_KEY='test-only';
  globalThis.fetch=async url=>{
   const path=new URL(url).pathname;
   if(path.includes('/data/supply-area-naver/'))return Response.json([{apt:'반포자이',hh:3410,exclusiveArea:194.692,supplyArea:232}]);
   if(path.includes('/data/supply-area/'))return Response.json({items:{}});
   if(path.includes(`/data/${kind}/`))return Response.json({items:[{apt:'반포자이',umd:'반포동',area:194.692,py:77,amt:50,ym:'202501'}]});
   throw Error('unexpected network path');
  };
  const {default:handler}=await import(`../netlify/functions/${kind}.mjs`);
  const response=await handler(new Request(`https://${kind}-calibration.example/api/${kind}?lawd=11650&yms=202501&v=14`));
  assert.equal(response.status,200);
  const data=await response.json();assert.deepEqual(data.failedMonths,[]);assert.equal(data.items.length,1);assert.equal(data.items[0].py,70);
 }finally{globalThis.fetch=priorFetch;if(priorKey===undefined)delete process.env.DATA_GO_KR_KEY;else process.env.DATA_GO_KR_KEY=priorKey;}
});
