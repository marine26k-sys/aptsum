import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function complexCompletionYear('),html.indexOf('function complexMetaHTML('))+html.slice(html.indexOf('function validSchoolCoordinate('),html.indexOf('function loadComplexMapSDK('))+html.slice(html.indexOf('function complexExternalMapURL('),html.indexOf('function addComplexSchoolMap(')),c);
test('분양권 준공연도 누락은 검증된 사용승인일로 보완한다',()=>{
 assert.equal(c.complexCompletionYear({build:'',hh:{useDate:'20251230'}}),2025);
 assert.equal(c.complexCompletionYear({build:2021,hh:{useDate:'20251230'}}),2021);
 assert.equal(c.complexCompletionYear({hh:{useDate:'20250230'}}),null);
 assert.equal(c.complexCompletionYear({}),null);
});
test('외부 지도는 단지의 검증된 좌표를 사용한다',()=>{
 assert.equal(c.complexExternalMapURL({name:'잠실르엘',lat:37.516431,lng:127.108013}),'https://map.kakao.com/link/map/'+encodeURIComponent('잠실르엘')+',37.516431,127.108013');
 assert.equal(c.complexExternalMapURL({name:'단지'}),'');
});

test('모바일 단지 헤더에서 지도와 주변 정보를 명확하게 안내한다',()=>{
 assert.match(html,/id="complexMapButton"[^>]*>[\s\S]*?단지 지도 · 학교 · 주변 단지 보기/);
 assert.match(html,/getElementById\('complexMapButton'\)[\s\S]*?schoolPanel/);
});

test('최신 분양권에 준공연도가 없어도 같은 단지의 확정된 거래 연도를 사용한다',()=>{
 const context=vm.createContext({});
 vm.runInContext(html.slice(html.indexOf('function complexTradeBuild('),html.indexOf('function analyzeComplex(')),context);
 assert.equal(context.complexTradeBuild([{build:''},{build:'2021'},{build:2021}]),2021);
 assert.equal(context.complexTradeBuild([{build:''},{build:2020},{build:2021}]),'');
 assert.equal(context.complexTradeBuild([{build:2021},{build:''}]),2021);
 assert.equal(context.complexTradeBuild([{build:''}]),'');
});

test('다른 신축 단지의 보유 사용승인일도 공통 경로로 보완한다',()=>{
 for(const [lawd,name,year] of [['41430','인덕원 퍼스비엘',2026],['41173','아크로 베스티뉴',2025],['11440','마포더클래시',2022],['11710','잠실르엘',2025]]){
  const data=JSON.parse(readFileSync(new URL(`../data/hhcnt/${lawd}.json`,import.meta.url),'utf8'));
  const norm=x=>x.replace(/\s/g,'');const record=data.items.find(x=>norm(x.name)===norm(name));
  assert.ok(record,name);assert.equal(c.complexCompletionYear({build:'',hh:record}),year,name);
 }
});
