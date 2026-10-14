import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {REGIONS} from '../shared/regions.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),entries=JSON.parse(readFileSync(new URL('../data/complex-index.json',import.meta.url),'utf8')).entries;
test('exact complex name finds only its district before fetching trades',async()=>{const c=vm.createContext({complexSearchIndex:entries});vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);const targets=REGIONS.flatMap(([,r])=>r.map(([name,lawd])=>({name,lawd})));const r=await c.complexSearchTargets('래미안원베일리',targets);assert.deepEqual(Array.from(r.targets,t=>t.lawd),['11650']);assert.ok(r.hits.every(x=>x.names.some(n=>n.replace(/\s/g,'')==='래미안원베일리')));assert.equal((await c.complexSearchTargets('래미안원베일리',targets.filter(t=>t.lawd==='11680'))).targets.length,0);});
test('자동완성은 정확한 이름이 있어도 같은 검색어를 포함하는 모든 선택 지역 후보를 반환한다',async()=>{
 const c=vm.createContext({complexSearchIndex:[{lawd:'11620',name:'서울대입구',umd:'봉천동',names:['서울대입구']},{lawd:'11620',name:'서울대입구역푸르지오',umd:'봉천동',names:['서울대입구역푸르지오']},{lawd:'11650',name:'서울대입구샘플',umd:'동',names:['서울대입구샘플']},{lawd:'41173',name:'서울대입구외부',umd:'동',names:['서울대입구외부']}]});
 vm.runInContext(html.slice(html.indexOf('async function complexSearchTargets('),html.indexOf('async function search(',html.indexOf('async function complexSearchTargets('))),c);
 const r=await c.complexSearchTargets('서울대입구',[{lawd:'11620'},{lawd:'11650'}],true);
 assert.equal(r.hits.length,3);assert.ok(r.hits.every(x=>x.lawd!=='41173'));
});
