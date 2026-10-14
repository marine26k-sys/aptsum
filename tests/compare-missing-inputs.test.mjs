import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function missingCompareInputs('),html.indexOf('async function search(')),c);
test('다른 지역의 동명 단지가 한쪽만 검색되면 나머지를 누락으로 처리한다',()=>{
 const inputs=[{name:'삼성',lawd:'11620'},{name:'삼성',lawd:'11650'}],narrowed=inputs.map(x=>[x]);
 const missing=c.missingCompareInputs(inputs,narrowed,[inputs[0]]);assert.equal(missing.length,1);assert.equal(missing[0].lawd,'11650');
 assert.equal(c.missingCompareInputs(inputs,narrowed,inputs).length,0);
});
test('전체 지역 입력은 해당 입력에서 찾은 후보 지역과 비교한다',()=>{
 const inputs=[{name:'원베일리',lawd:'ALL:서울'},{name:'다른단지',lawd:'11620'}];
 const missing=c.missingCompareInputs(inputs,[[{lawd:'11650'}],[{lawd:'11620'}]],[{name:'원베일리',lawd:'11680'},{name:'다른단지',lawd:'11620'}]);assert.equal(missing.length,1);assert.equal(missing[0].name,'원베일리');
});
