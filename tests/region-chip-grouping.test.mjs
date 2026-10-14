import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {REGIONS} from '../shared/regions.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('const PROVINCE_DISPLAY'),end=html.indexOf('function regionScopeLabel(');
const c=vm.createContext({REGIONS});vm.runInContext(html.slice(start,end),c);
const items=province=>REGIONS.find(([p])=>p===province)[1].map(([name,lawd])=>({name,lawd}));
test('서울·경기 전체 선택은 한 칩으로 묶이고 제거할 전체 지역을 보존한다',()=>{
 for(const [p,label] of [['서울','서울시 전체'],['경기','경기도 전체']]){const regions=items(p),groups=c.groupRegionChips(regions);assert.equal(groups.length,1);assert.equal(groups[0].name,label);assert.equal(groups[0].lawds.length,regions.length);}
});
test('일부 선택은 전체로 표시하지 않고 시 전체와 추가 지역도 구분한다',()=>{
 const seoul=items('서울');assert.equal(c.groupRegionChips(seoul.slice(0,2)).length,2);
 const anyang=items('경기').filter(x=>x.name.startsWith('안양 '));const groups=c.groupRegionChips([...anyang,seoul[0]]);assert.equal(groups.length,2);assert.equal(groups[0].name,'안양시 전체');assert.equal(groups[0].lawds.length,2);
});
