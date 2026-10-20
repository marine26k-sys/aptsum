import test from 'node:test';import assert from 'node:assert/strict';
import {hasRegionalPeriodData,loadRegionalData} from '../shared/regional-data-loader.mjs';
const valid=()=>({periods:{monthly:Array.from({length:24},(_,i)=>({label:new Date(Date.UTC(2026,9-i,1)).toISOString().slice(0,7)}))},regions:[{periodMetrics:{},allPeriodMetrics:{}}]});
test('cached older API data falls back to same-deploy static data rather than showing no regional comparisons',async()=>{
 const paths=[],old={...valid(),dataRevision:'old',regions:[{metrics:{},allMetrics:{}}]},fresh=valid();
 const result=await loadRegionalData(async path=>{paths.push(path);return {ok:true,json:async()=>path.startsWith('/api/')?old:fresh};});
 assert.deepEqual(paths,['/api/dashboard-data?kind=regional','/data/regional-change.json']);assert.equal(result,fresh);assert.equal(result.dataRevision,undefined);
});
test('compatible live API data keeps its revision and avoids unnecessary static fetch',async()=>{
 const data={...valid(),dataRevision:'new'};let calls=0;
 const result=await loadRegionalData(async()=>{calls++;return {ok:true,json:async()=>data};});
 assert.equal(calls,1);assert.equal(result.dataRevision,'new');
});
test('invalid or unavailable data sources fail visibly instead of appearing as empty valid data',async()=>{
 for(const data of [null,{}, {periods:{monthly:[]},regions:[]},{...valid(),regions:[{periodMetrics:{},allPeriodMetrics:null}]}])assert.equal(hasRegionalPeriodData(data),false);
 await assert.rejects(loadRegionalData(async()=>({ok:true,json:async()=>({})})),/unavailable/);
 const data=valid();assert.equal(await loadRegionalData(async path=>{if(path.startsWith('/api'))throw Error('offline');return {ok:true,json:async()=>data};}),data);
});

test('cached twelve-month data falls back when the screen supports twenty-four months',async()=>{
 const fresh=valid(),old={...valid(),periods:{monthly:valid().periods.monthly.slice(0,12)}};let calls=0;
 const result=await loadRegionalData(async()=>({ok:true,json:async()=>++calls===1?old:fresh}));
 assert.equal(calls,2);assert.equal(result.periods.monthly.length,24);
});
