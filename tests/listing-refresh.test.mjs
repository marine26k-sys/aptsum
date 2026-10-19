import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('refresh bypasses both current and history caches after an Excel upload',async()=>{
 let calls=0;
 const ctx=vm.createContext({listingMem:{'11680:available:mid':{old:true}},listingHistoryMem:{'11680:available':{old:true}},enforceListingTrialLawd:()=>{},listingOccupancy:()=> 'available',listingFloor:()=> 'mid',fetch:async()=>({ok:true,status:200,json:async()=>({version:++calls})})});
 vm.runInContext(html.slice(html.indexOf('async function fetchListings('),html.indexOf('function listingGapBandLabel(')),ctx);
 assert.equal((await ctx.fetchListings('11680')).old,true);assert.equal((await ctx.fetchListingHistory('11680')).old,true);assert.equal(calls,0);
 assert.equal((await ctx.fetchListings('11680',true)).version,1);assert.equal((await ctx.fetchListingHistory('11680',true)).version,2);
 assert.equal((await ctx.fetchListings('11680')).version,1);
});
