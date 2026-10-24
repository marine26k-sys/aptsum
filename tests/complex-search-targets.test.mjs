import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {REGIONS} from '../shared/regions.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),entries=JSON.parse(readFileSync(new URL('../data/complex-index.json',import.meta.url),'utf8')).entries;
test('exact complex name finds only its district before fetching trades',async()=>{const c=vm.createContext({complexSearchIndex:entries});vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);const targets=REGIONS.flatMap(([,r])=>r.map(([name,lawd])=>({name,lawd})));const r=await c.complexSearchTargets('래미안원베일리',targets);assert.deepEqual(Array.from(r.targets,t=>t.lawd),['11650']);assert.ok(r.hits.every(x=>x.names.some(n=>n.replace(/\s/g,'')==='래미안원베일리')));assert.equal((await c.complexSearchTargets('래미안원베일리',targets.filter(t=>t.lawd==='11680'))).targets.length,0);});
test('지역명+단지명 검색은 단지 공식명이 짧아도 해당 지역 후보만 찾는다',async()=>{
 const c=vm.createContext({complexSearchIndex:entries,regionNameByLawd:code=>code==='11620'?'관악구':'성북구'});
 vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);
 const result=await c.complexSearchTargets('봉천 두산',[],true);
 assert.deepEqual(Array.from(result.hits,x=>`${x.lawd}|${x.umd}|${x.name}`),['11620|봉천동|두산']);
 const seongsu=await c.complexSearchTargets('성수동 동아',[],true);
 assert.deepEqual(Array.from(seongsu.hits,x=>x.name).sort(),['동아','성수동아그린']);
});
test('이전 색인에 남아 있는 동 이름만의 단지 후보는 자동완성에서 제외한다',async()=>{
 const c=vm.createContext({complexSearchIndex:[
  {lawd:'11620',region:'관악구',umd:'봉천동',name:'성현동아',names:['봉천동아','성현동아']},
  {lawd:'11620',region:'관악구',umd:'봉천동',name:'봉천동',names:['봉천동']}
 ]});
 vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);
 const result=await c.complexSearchTargets('봉천동',[],true);
 assert.deepEqual(Array.from(result.hits,x=>x.name),['성현동아']);
});
test('단지 비교 자동완성은 호가 매물이 없는 퍼스니티도 단지 검색 색인에서 찾는다',async()=>{
 const c=vm.createContext({complexSearchIndex:entries});vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);
 const result=await c.complexSearchTargets('평촌자이',[],true);
 assert.ok(result.hits.some(x=>x.name==='평촌자이퍼스니티'&&x.lawd==='41173'&&x.umd==='비산동'));
 const compareAutocomplete=html.slice(html.indexOf("if(cmpRow&&mode==='compare')"),html.indexOf('if(targets.length)',html.indexOf("if(cmpRow&&mode==='compare')")));
 assert.match(compareAutocomplete,/complexSearchTargets\(searchQuery/);
 assert.doesNotMatch(compareAutocomplete,/searchListingComplexNames\(searchQuery/);
});
test('자동완성은 정확한 이름이 있어도 같은 검색어를 포함하는 모든 선택 지역 후보를 반환한다',async()=>{
 const c=vm.createContext({complexSearchIndex:[{lawd:'11620',name:'서울대입구',umd:'봉천동',names:['서울대입구']},{lawd:'11620',name:'서울대입구역푸르지오',umd:'봉천동',names:['서울대입구역푸르지오']},{lawd:'11650',name:'서울대입구샘플',umd:'동',names:['서울대입구샘플']},{lawd:'41173',name:'서울대입구외부',umd:'동',names:['서울대입구외부']}]});
 vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);
 const r=await c.complexSearchTargets('서울대입구',[{lawd:'11620'},{lawd:'11650'}],true);
 assert.equal(r.hits.length,3);assert.ok(r.hits.every(x=>x.lawd!=='41173'));
});
test('아르테 부분 검색의 모든 후보를 유지하고 동을 선택하면 해당 단지만 남긴다',async()=>{
 const c=vm.createContext({complexSearchIndex:entries});vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);
 const targets=REGIONS.filter(([name])=>name==='서울').flatMap(([,r])=>r.map(([name,lawd])=>({name,lawd})));
 const result=await c.complexSearchTargets('아르테',targets);assert.equal(result.hits.length,3);
 const sample=[{lawd:'11680',name:'가상단지',umd:'동1',names:['가상단지']},{lawd:'11680',name:'가상단지',umd:'동2',names:['가상단지']}];
 c.complexSearchIndex=sample;const selected=await c.complexSearchTargets('가상단지 [동2]',[{lawd:'11680'}]);assert.equal(selected.hits.length,1);assert.equal(selected.hits[0].umd,'동2');
 assert.ok(html.indexOf('if(complexLookup.hits.length>1)')<html.indexOf('const allScope = multiTargets.length > 0',html.indexOf('let complexLookup=null')));
});
