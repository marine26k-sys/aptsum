import test from 'node:test';import assert from 'node:assert/strict';
import {hasRegionalPeriodData,loadRegionalData} from '../shared/regional-data-loader.mjs';
const valid=()=>({periods:{monthly:[{label:'2026-10'}]},regions:[{periodMetrics:{},allPeriodMetrics:{}}]});
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
