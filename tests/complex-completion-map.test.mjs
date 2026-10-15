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
