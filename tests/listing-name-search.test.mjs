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
test('회원 쿠키가 있어도 명시적인 체험 요청은 강남구로 제한한다',async()=>{
 const {c}=setup(true);const d=await (await c.handler({method:'GET',url:'https://example.test/api/listings?search=같은단지&trial=1'})).json();
 assert.equal(d.trial,true);assert.equal(d.items.length,1);assert.equal(d.items[0].lawd,'11680');
});
test('지역·동·단지명을 공백으로 조합하고 순서를 바꿔 검색한다',()=>{
 const {c}=setup(true),item={apt:'동아아파트',umd:'성수동1가'};
 assert.equal(c.listingSearchMatch(item,'서울 성동구','성수동 동아'),true);
 assert.equal(c.listingSearchMatch(item,'서울 성동구','동아 성수동'),true);
 assert.equal(c.listingSearchMatch(item,'서울 성동구','광진구 동아'),false);
 assert.equal(c.listingSearchMatch({apt:'동아',umd:'광장동'},'서울 광진구','광진구 동아'),true);
 assert.equal(c.listingSearchMatch({apt:'평촌 래미안 푸르지오',umd:'비산동'},'경기 안양 동안구','동안구 평촌래미안'),true);
});
test('API는 지역과 단지명을 함께 검색해 해당 지역만 반환한다',async()=>{
 const {c}=setup(true);const d=await (await c.handler({method:'GET',url:'https://example.test/api/listings?search='+encodeURIComponent('동안구 같은단지')})).json();assert.equal(d.items.length,1);assert.equal(d.items[0].lawd,'41173');
});

test('단지명 중간 단어를 생략해도 입력한 글자 순서로 검색된다',()=>{
 const {c}=setup(true),item={apt:'롯데캐슬골드파크',umd:'독산동'};
 assert.equal(c.listingSearchMatch(item,'서울 금천구','롯데골드'),true);
 assert.equal(c.listingSearchMatch(item,'서울 금천구','금천구 롯데골드'),true);
 assert.equal(c.listingSearchMatch(item,'서울 금천구','롯데 골드'),true);
 assert.equal(c.listingSearchMatch(item,'서울 금천구','골드롯데'),false);
 assert.equal(c.listingSearchMatch(item,'서울 금천구','광진구 롯데골드'),false);
});

test('짧은 단지명은 떨어진 글자를 연결하지 않는다',()=>{
 const {c}=setup(true);
 assert.equal(c.listingSearchMatch({apt:'광교호반베르디움트라엘',umd:'이의동'},'경기 수원 영통구','르엘'),false);
 assert.equal(c.listingSearchMatch({apt:'잠실르엘',umd:'신천동'},'서울 송파구','르엘'),true);
 assert.equal(c.listingSearchMatch({apt:'대치르엘',umd:'대치동'},'서울 강남구','르엘'),true);
 assert.equal(c.listingSearchMatch({apt:'롯데캐슬골드파크'},'서울 금천구','롯데골드'),true);
});
