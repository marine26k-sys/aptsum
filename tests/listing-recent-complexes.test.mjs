import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){const memory=new Map();const c=vm.createContext({localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)}});vm.runInContext(html.slice(html.indexOf('function getListingRecentComplexes('),html.indexOf('function renderListingRecentComplexes('))+'function renderListingRecentComplexes(){}',c);return {c,memory};}
test('최근 검색 단지는 최대 다섯 개, 중복 없이 최신 조회 순으로 저장한다',()=>{
 const {c}=setup();for(let i=0;i<7;i++)c.rememberListingRecentComplex({key:'11680|'+i,lawd:'11680',apt:'가상단지'+i,name:'강남구',umd:'동'});
 assert.deepEqual(Array.from(c.getListingRecentComplexes(),x=>x.apt),['가상단지6','가상단지5','가상단지4','가상단지3','가상단지2']);
 c.rememberListingRecentComplex({key:'11680|3',lawd:'11680',apt:'가상단지3',name:'강남구',umd:'동'});assert.equal(c.getListingRecentComplexes().length,5);assert.equal(c.getListingRecentComplexes()[0].apt,'가상단지3');
});
test('저장소 오류나 잘못된 기록은 검색 화면을 중단하지 않는다',()=>{
 const {c,memory}=setup();memory.set('aptsum:listing-recent-complexes','broken');assert.equal(c.getListingRecentComplexes().length,0);
 memory.set('aptsum:listing-recent-complexes',JSON.stringify([{key:'x',lawd:'invalid',apt:'가상',region:'지역'}]));assert.equal(c.getListingRecentComplexes().length,0);
});
test('최근 검색 단지는 자동완성 후보를 펼치지 않고 저장된 키로 바로 조회한다',()=>{
 const input={value:'',};const candidates={cleared:false,replaceChildren(){this.cleared=true;}};let occupancyResets=0,searches=0,autocompleteClosed=0;
 const c=vm.createContext({LISTING_TRIAL_LAWD:'11680',isListingTrial:()=>false,document:{getElementById:id=>id==='listingNameQuery'?input:candidates},listingNameSelected:{},listingNameRestoreKey:'',listingNameChoices:[],acTimer:null,clearTimeout(){},acHide(){autocompleteClosed++;},listingOccupancyApply(){occupancyResets++;},search(){searches++;},showError(){}});
 vm.runInContext(html.slice(html.indexOf('function openListingRecentComplex('),html.indexOf('let listingNameSelected=')),c);
 c.openListingRecentComplex({key:'11680|123|개포동',lawd:'11680',apt:'래미안블레스티지'});
 assert.equal(input.value,'래미안블레스티지');assert.equal(c.listingNameRestoreKey,'11680|123|개포동');assert.equal(candidates.cleared,true);assert.equal(occupancyResets,1);assert.equal(autocompleteClosed,1);assert.equal(searches,1);
});
test('이미 식별된 최근 단지는 전체 후보 목록 대신 선택목록 없이 정확한 단지만 반환한다',async()=>{
 const input={value:'래미안블레스티지'};const candidates={rows:0,replaceChildren(){this.rows=0;},append(){this.rows++;}};
 const c=vm.createContext({document:{getElementById:id=>id==='listingNameQuery'?input:candidates},listingOccupancy:()=> 'available',listingFloor:()=> 'mid',isListingTrial:()=>false,LISTING_TRIAL_LAWD:'11680',searchToken:7,listingNameSelected:null,listingNameRestoreKey:'11680|123|개포동',listingNameChoices:[],searchAbortController:null,fetch:async()=>({ok:true,status:200,json:async()=>({items:[{lawd:'11680',nid:'123',umd:'개포동',apt:'래미안블레스티지',gu:'서울 강남구',asOf:'2026-10-24'},{lawd:'11680',nid:'456',umd:'일원동',apt:'래미안블레스티지',gu:'서울 강남구',asOf:'2026-10-24'}]})})});
 vm.runInContext(html.slice(html.indexOf('async function resolveListingName('),html.indexOf('async function searchListingTab(')),c);
 const selected=await c.resolveListingName(7);assert.equal(selected.key,'11680|123|개포동');assert.equal(candidates.rows,0);
});
