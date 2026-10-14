import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('조회 진행률은 완료한 작업에 따라 증가하며 분석 전에는 100%가 아니다',async()=>{
 const label={};const c=vm.createContext({searchToken:1,document:{getElementById:()=>label}});
 vm.runInContext(html.slice(html.indexOf('function lookupPercent('),html.indexOf('function beginSearchRequests(')),c);
 let finishA,finishB;const promises=c.lookupProgressMap([1,2],x=>new Promise(resolve=>{if(x===1)finishA=resolve;else finishB=resolve;}));
 assert.equal(label.textContent,'조회 중… 0%');finishA();await promises[0];assert.equal(label.textContent,'조회 중… 47%');finishB();await promises[1];assert.equal(label.textContent,'조회 중… 95%');
});
test('종료된 이전 검색의 작업이 최신 진행률을 덮어쓰지 않는다',async()=>{
 const label={};const c=vm.createContext({searchToken:1,document:{getElementById:()=>label}});
 vm.runInContext(html.slice(html.indexOf('function lookupPercent('),html.indexOf('function beginSearchRequests(')),c);
 let finish;const tasks=c.lookupProgressMap([1],()=>new Promise(resolve=>finish=resolve));c.searchToken=2;label.textContent='새 조회';finish();await tasks[0];assert.equal(label.textContent,'새 조회');
});
