import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const complexIndex=JSON.parse(readFileSync(new URL('../data/complex-index.json',import.meta.url),'utf8')).entries;
const extract=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
test('즐겨찾기와 최근 단지는 이전 지역과 자동완성 선택을 함께 교체한 후 조회한다',async()=>{
 for(const action of ['favGo','openRelatedComplex']){
  const input={value:'잠실르엘',dataset:{pickedLawd:'11710',pickedName:'잠실르엘'}};
  let searched=0,saved=0,rendered=0;
  const c=vm.createContext({sel:{value:'11710',options:[{value:'11710',textContent:'송파구'},{value:'41173',textContent:'안양 동안구'}]},regionSel:[{lawd:'11710',name:'송파구'}],document:{getElementById:()=>input},closeExpandedComplexMap(){},setMode(){},saveRegionSel(){saved++},renderRegionChips(){rendered++},syncRegionPickBtn(){},search(){searched++},favTradeCount:async()=>0,setFavSeenCount(){}});
  vm.runInContext(extract('function openRelatedComplex(', 'function getFavs(')+extract('function favGo(', '// ── 즐겨찾기 "신규 거래"'),c);
  c[action]('41173','평촌래미안푸르지오');
  assert.equal(c.sel.value,'41173');assert.equal(c.regionSel.length,1);assert.equal(c.regionSel[0].lawd,'41173');
  assert.equal(input.dataset.pickedLawd,'41173');assert.equal(input.dataset.pickedName,input.value);
  assert.equal(searched,1);assert.equal(saved,1);assert.equal(rendered,1);
 }
});

test('최근 본 단지는 법정동과 단지 키를 보존하고 이전 단지 자동완성 값을 비운다',()=>{
 const input={value:'이전 아파트 [이전동]',dataset:{pickedLawd:'11710',pickedName:'이전 아파트 [이전동]',pickedApt:'이전 아파트',pickedKey:'11710|old|이전동'}};
 const c=vm.createContext({sel:{value:'11710',options:[{value:'11710',textContent:'송파구'},{value:'11680',textContent:'서울 강남구'}]},regionSel:[],document:{getElementById:()=>input},closeExpandedComplexMap(){},setMode(){},saveRegionSel(){},renderRegionChips(){},syncRegionPickBtn(){},search(){}});
 vm.runInContext(extract('function openRelatedComplex(', 'function getFavs('),c);
 c.openRelatedComplex('11680','래미안블레스티지','개포동','11680|12345|개포동');
 assert.equal(input.value,'래미안블레스티지 [개포동]');
 assert.equal(input.dataset.pickedLawd,'11680');assert.equal(input.dataset.pickedApt,'래미안블레스티지');assert.equal(input.dataset.pickedKey,'11680|12345|개포동');
});
test('저장된 최근 단지 키가 이름과 다르면 그 키의 다른 아파트를 열지 않는다',()=>{
 const candidates=[{key:'41173|wrong|안양동',lawd:'41173',apt:'래미안안양메가트리아',umd:'안양동'},{key:'41173|right|비산동',lawd:'41173',apt:'평촌래미안푸르지오',umd:'비산동'}];
 const c=vm.createContext({});vm.runInContext(extract('function complexCandidateIdentityKey(', 'function missingCompareInputs('),c);
 const input={value:'평촌래미안푸르지오 [비산동]',dataset:{pickedLawd:'41173',pickedApt:'평촌래미안푸르지오',pickedKey:'41173|wrong|안양동'}};
 assert.equal(c.matchPickedComplexCandidate(candidates,'평촌래미안푸르지오',input).key,'41173|right|비산동');
 assert.equal(c.matchPickedComplexCandidate(candidates,'다른 단지',input),null);
});
test('랭킹에서 단지를 누르면 법정동·단지 식별자를 넘겨 상세분석을 바로 조회한다',()=>{
 const input={value:'이전 단지',dataset:{pickedLawd:'11710',pickedName:'이전 단지'}};
 let searched=0;
 const c=vm.createContext({mode:'region',lastData:null,sel:{value:'41173',options:[{value:'41173',textContent:'안양 동안구'}]},regionSel:[],document:{getElementById:()=>input},setMode(){},saveRegionSel(){},renderRegionChips(){},syncRegionPickBtn(){},search(){searched++}});
 vm.runInContext(extract('function quick(', '// ── 지하철 검색'),c);
 c.quick('평촌더샵아이파크','안양 동안구','41173','호계동');
 assert.equal(input.value,'평촌더샵아이파크 [호계동]');
 assert.equal(input.dataset.pickedLawd,'41173');
 assert.equal(input.dataset.pickedApt,'평촌더샵아이파크');
 assert.equal(input.dataset.pickedKey,'41173|호계동|평촌더샵아이파크');
 assert.equal(searched,1);
});
test('단지 분석 자동완성은 실거래 단지 인덱스의 준공 예정 단지도 검색한다',async()=>{
 const c=vm.createContext({complexSearchIndex:complexIndex,mode:'complex',document:{getElementById:()=>({dataset:{}})}});
 vm.runInContext(extract('async function complexSearchTargets(', 'function complexCandidateIdentityKey('),c);
 const result=await c.complexSearchTargets('평촌자이',[],true,{dataset:{}});
 assert.ok(result.hits.some(x=>x.name==='평촌자이퍼스니티'&&x.lawd==='41173'&&x.umd==='비산동'));
});
