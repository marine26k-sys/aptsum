import {naverNameKey} from '../shared/naver-name-match.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function matchNearbySchools('),html.indexOf('let complexMapSDKPromise=')),c);
test('school match requires exact name and dong, or unique K-apt identity',()=>{
 const rows=[{name:'단지 아파트',umd:'비산동',kaptCode:'A1'},{name:'단지',umd:'관양동',kaptCode:'A2'}];
 assert.equal(c.matchNearbySchools(rows,{name:'단지',umd:'비산동'}),rows[0]);
 assert.equal(c.matchNearbySchools(rows,{name:'단지',umd:'다른동'}),null);
 assert.equal(c.matchNearbySchools(rows,{name:'단지2차',umd:'비산동'}),null);
 assert.equal(c.matchNearbySchools([...rows,{...rows[0]}],{name:'단지',umd:'비산동'}),null);
 assert.equal(c.matchNearbySchools(rows,{hh:{kaptCode:'A2'}}),rows[1]);
});
test('imported distances are valid and each region contains its own records',()=>{
 const dir=new URL('../data/nearby-schools/',import.meta.url);
 for(const file of readdirSync(dir)){
  const d=JSON.parse(readFileSync(new URL(file,dir),'utf8'));
  assert.equal(d.distanceKind,'straight');
  for(const apt of d.items){assert.ok(apt.name);for(const s of apt.schools){assert.ok(s.name&&s.id);assert.ok(['초','중','고'].includes(s.level));assert.ok(Number.isFinite(s.distance)&&s.distance>=0&&s.distance<=3000);}}
 }
});


test('map coordinates reject invalid values instead of placing unrelated points',()=>{
 vm.runInContext(html.slice(html.indexOf('function validSchoolCoordinate('),html.indexOf('function loadComplexMapSDK(')),c);
 assert.equal(c.validSchoolCoordinate({lat:37.4,lng:126.9}),true);
 for(const x of [{lat:null,lng:127},{lat:0,lng:0},{lat:37,lng:999},{lat:'37',lng:127}])assert.equal(c.validSchoolCoordinate(x),false);
});

test('nearby complex lists stay within one kilometer and are ordered by distance',()=>{
 const dir=new URL('../data/nearby-schools/',import.meta.url);
 for(const file of readdirSync(dir))for(const apt of JSON.parse(readFileSync(new URL(file,dir),'utf8')).items){
  assert.ok(apt.nearby.length<=15);let previous=-1;
  for(const row of apt.nearby){assert.ok(row.lawd&&row.name);assert.ok(row.distance>=previous&&row.distance<=1000);previous=row.distance;}
 }
});

test('fallback location requires unique exact complex name, dong and region',()=>{
 vm.runInContext(html.slice(html.indexOf('function selectComplexMapPlace('),html.indexOf('function addUnmatchedComplexMap(')),c);
 const place={place_name:'단지 아파트',address_name:'경기 안양시 동안구 비산동 1',x:'126.9',y:'37.4'};
 assert.equal(c.selectComplexMapPlace([place],{name:'단지',umd:'비산동'},null,'안양 동안구'),place);
 const scheduled={...place,place_name:'단지아파트 (2027년12월예정)'};
 assert.equal(c.selectComplexMapPlace([scheduled],{name:'단지',umd:'비산동'},null,'안양 동안구'),scheduled);
 assert.equal(c.selectComplexMapPlace([{...place,place_name:'단지공인중개사사무소'}],{name:'단지',umd:'비산동'},null,'안양 동안구'),null);
 assert.equal(c.selectComplexMapPlace([place],{name:'단지',umd:'관양동'},null,'안양 동안구'),null);
 assert.equal(c.selectComplexMapPlace([place],{name:'단지',umd:'비산동'},null,'수원 영통구'),null);
 assert.equal(c.selectComplexMapPlace([place,{...place}],{name:'단지',umd:'비산동'},null,'안양 동안구'),null);
});

test('school coordinates reuse existing Naver name normalization',()=>{
 const row={name:'석수e편한세상',umd:'석수동'};
 assert.equal(c.matchNearbySchools([row],{name:'석수e-편한세상',umd:'석수동'},null,naverNameKey),row);
 assert.equal(c.matchNearbySchools([row,{name:'석수2차e편한세상',umd:'석수동'}],{name:'석수e-편한세상',umd:'석수동'},null,naverNameKey),row);
 assert.equal(c.matchNearbySchools([row,{...row}],{name:'석수e-편한세상',umd:'석수동'},null,naverNameKey),null);
 assert.equal(c.matchNearbySchools([row],{name:'석수e-편한세상',umd:'비산동'},null,naverNameKey),null);
});
