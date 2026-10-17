import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('체험 상태에서 타 지역의 현재 매물과 이력은 캐시가 있어도 읽지 못한다',async()=>{
 let reads=0;const c=vm.createContext({isListingTrial:()=>true,LISTING_TRIAL_LAWD:'11680',listingOccupancy:()=> 'available',listingFloor:()=> 'mid',listingMem:{'11740:available:mid':{items:['synthetic']}},listingHistoryMem:{'11740:available':{snapshots:['synthetic']}},fetch:async()=>{reads++;throw Error('unexpected')}});
 vm.runInContext(html.slice(html.indexOf('function enforceListingTrialLawd('),html.indexOf('function listingGapBandLabel(')),c);
 await assert.rejects(c.fetchListings('11740'),e=>e.auth===true);await assert.rejects(c.fetchListingHistory('11740'),e=>e.auth===true);assert.equal(reads,0);
 c.listingMem['11680:available:mid']={items:[]};assert.equal((await c.fetchListings('11680')).items.length,0);
});
