import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('역세권 목록은 선택 지역 수와 관계없이 단지 구·동을 표시한다',()=>{
 const c=vm.createContext({regionNameByLawd:lawd=>lawd==='11650'?'서초구':'안양 동안구'});
 vm.runInContext(html.slice(html.indexOf('function subwayLocationLabel('),html.indexOf('function renderSubway(')),c);
 assert.equal(c.subwayLocationLabel({gu:'서초구',umd:'반포동'}),'서초구 반포동');
 assert.equal(c.subwayLocationLabel({lawd:'41173',umd:'비산동'}),'안양 동안구 비산동');
 assert.equal(c.subwayLocationLabel({gu:'강남구'}),'강남구');
 assert.equal(c.subwayLocationLabel({}),'');
});
