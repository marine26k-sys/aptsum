import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('금액대별 필터를 바꿔도 조회 버튼 전에는 자동 조회하지 않는다',()=>{
 let calls=0;
 const ctx=vm.createContext({
  mode:'listingbudget',lastData:{mode:'listingbudget'},listingFilterSourceItems:[],
  search(){calls++;},listingManualFacets:new Set(),
  listingGapInvestmentSync(){},lsSubwaySync(){},
 });
 for(const [start,end] of [
  ['function listingGapInvestmentApply()','function setListingGapInvestmentBand('],
  ['function lsSubwayApply()','function lsActive('],
  ['function lsApply()','function getListingBudgetFavorites('],
 ]) vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))),ctx);

 ctx.listingGapInvestmentApply();
 ctx.lsSubwayApply();
 ctx.lsApply();
 assert.equal(calls,0);

 // 다른 탭의 기존 자동 갱신 동작은 유지한다.
 ctx.mode='listingurgent';ctx.lastData={mode:'listingurgent'};
 ctx.lsApply();
 assert.equal(calls,1);
});

test('자동완성 단지를 선택하면 검색창에 전체 단지명이 표시된다',()=>{
 const input={value:'푸르지'};
 const ctx=vm.createContext({
  document:{getElementById:id=>id==='listingNameQuery'?input:null,querySelectorAll:()=>[],querySelector:()=>null},
  acHide(){},
 });
 const start=html.indexOf('let listingNameSelected=null');
 const end=html.indexOf('async function resolveListingName(',start);
 vm.runInContext(html.slice(start,end),ctx);
 vm.runInContext("listingNameChoices=[{apt:'세곡푸르지오',name:'서울 강남구',umd:'세곡동',key:'123'}]",ctx);
 ctx.chooseListingName(0);
 assert.equal(input.value,'세곡푸르지오');
 assert.equal(vm.runInContext('listingNameSelected.apt',ctx),'세곡푸르지오');
});

test('데이터가 조절한 범위는 직접 슬라이더를 움직이지 않으면 필터로 적용하지 않는다',()=>{
 const nodes={};for(const [name,min,max] of [['Ask','2.5','50'],['Age','2','44'],['Hh','203','5000'],['Py','11','65'],['Rate','-18','59']]){nodes[`ls${name}Min`]={min,max,value:String(+min+1)};nodes[`ls${name}Max`]={min,max,value:String(+max-1)};}
 const ctx=vm.createContext({mode:'listingbudget',listingManualFacets:new Set(),
  LS_FACETS:{ask:{ids:['lsAskMin','lsAskMax'],keys:['q0','q1']},age:{ids:['lsAgeMin','lsAgeMax'],keys:['a0','a1']},hh:{ids:['lsHhMin','lsHhMax'],keys:['h','h1']},py:{ids:['lsPyMin','lsPyMax'],keys:['p0','p1']},rate:{ids:['lsRateMin','lsRateMax'],keys:['r0','r1']}},
  document:{getElementById:id=>nodes[id]||{min:'0',max:'60'}},lsSync(){}});
 for(const name of ['lsFacetLimits','lsFacetActive','lsAskLimits','lsAskText','lsAskMatch','lsAgeText','lsHhActive','lsHhText','lsRateActive','lsRateText','lsAlignUnadjustedToBounds']){
  const source=html.match(new RegExp(`^function ${name}\\([^\\n]*`,'m'))?.[0];assert.ok(source,`missing ${name}`);vm.runInContext(source,ctx);
 }
 const v={q0:3,q1:40,a0:3,a1:40,h:300,h1:4000,p0:12,p1:50,r0:-10,r1:30};
 ctx.lsAlignUnadjustedToBounds();assert.equal(nodes.lsAskMin.value,nodes.lsAskMin.min);assert.equal(nodes.lsAskMax.value,nodes.lsAskMax.max);assert.equal(nodes.lsPyMin.value,nodes.lsPyMin.min);assert.equal(nodes.lsPyMax.value,nodes.lsPyMax.max);
 assert.equal(ctx.lsAskText(v),'전체');assert.equal(ctx.lsAskMatch({ask:1},v),true);
 assert.equal(ctx.lsAgeText(v),'전체');assert.equal(ctx.lsHhText(v),'전체');assert.equal(ctx.lsRateText(v),'전체');
 for(const name of ['ask','age','hh','rate'])ctx.listingManualFacets.add(name);
 assert.equal(ctx.lsAskText(v),'3.0~40.0억');assert.equal(ctx.lsAskMatch({ask:1},v),false);
 assert.equal(ctx.lsAgeText(v),'3~40년차');assert.equal(ctx.lsHhText(v),'300~4,000세대');
});
