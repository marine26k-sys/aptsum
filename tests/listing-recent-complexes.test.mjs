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
