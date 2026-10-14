import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../stats.html',import.meta.url),'utf8');
const c=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function subscriberCounts('),html.indexOf('async function loadSubscribers(')),c);
test('코드 상태 개수는 해지와 만료를 중복 집계하지 않는다',()=>{
 const result=c.subscriberCounts([{expiresAt:null},{expiresAt:101},{expiresAt:99},{expiresAt:99,revoked:true}],100);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{total:4,active:2,expired:1,revoked:1});
 assert.equal(c.subscriberCounts([],100).total,0);
});
