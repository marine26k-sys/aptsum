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
