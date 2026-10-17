import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../netlify/functions/listings.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export const /g,'const ').replace(/export async function /g,'async function ').replace(/export function /g,'function ').replace('export default async (request) =>','handler = async (request) =>');
function setup(authorized){let reads=0;const c=vm.createContext({Response,URL,process:{env:{SUBSCRIBER_SESSION_SECRET:'test'}},REGIONS:[['서울',[['강남구','11680']]],['경기',[['동안구','41173']]]],ALL_LAWDS:['11680','41173'],hasValidStatsSession:()=>false,getSubscriberSession:async()=>authorized,getStore:()=>({get:async key=>{reads++;return {asOf:'2026.10.13',items:[{nid:key,apt:'같은 단지',occupancy:'available',ask:10},{apt:'같은 단지',occupancy:'tenant',ask:9},{apt:'다른 단지',ask:8}]};}})});vm.runInContext(source,c);return {c,reads:()=>reads};}
test('global name search spans regions, preserves identities and filters occupancy',async()=>{const {c}=setup(true);const r=await c.handler({method:'GET',url:'https://example.test/api/listings?search=같은단지&lawd=11680'});const d=await r.json();assert.equal(d.items.length,2);assert.deepEqual(d.items.map(x=>x.lawd).sort(),['11680','41173']);assert.equal(d.items[1].gu,'경기 동안구');});
test('global lookup rejects anonymous and short or invalid occupancy queries before reading data',async()=>{for(const [auth,query,status] of [[false,'search=같은단지',401],[true,'search=가',400],[true,'search=같은단지&occupancy=bad',400]]){const {c,reads}=setup(auth);const r=await c.handler({method:'GET',url:'https://example.test/api/listings?'+query});assert.equal(r.status,status);assert.equal(reads(),0);}});

test('익명 체험 검색은 지역 인자를 조작해도 강남구 자료만 읽고 반환한다',async()=>{
 const {c,reads}=setup(false);const r=await c.handler({method:'GET',url:'https://example.test/api/listings?search=같은단지&trial=1&lawd=41173'});
 const d=await r.json();assert.equal(r.status,200);assert.equal(d.trial,true);assert.equal(reads(),1);assert.deepEqual(d.items.map(x=>x.lawd),['11680']);
});
test('회원은 체험 검색 인자가 있어도 전 지역 검색을 유지한다',async()=>{
 const {c}=setup(true);const d=await (await c.handler({method:'GET',url:'https://example.test/api/listings?search=같은단지&trial=1'})).json();
 assert.equal(d.trial,false);assert.equal(d.items.length,2);
});
