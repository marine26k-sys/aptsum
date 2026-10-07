import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHmac, timingSafeEqual } from 'node:crypto';

function setup(){
  const maps=new Map();let version=0;
  function getStore(name){
    if(!maps.has(name))maps.set(name,new Map());const map=maps.get(name);
    return {
      async get(key){return map.get(key)?.data ?? null;},
      async getWithMetadata(key){return map.get(key) ?? null;},
      async set(key,data,opts={}){const current=map.get(key);if((opts.onlyIfNew&&current)||(opts.onlyIfMatch&&current?.etag!==opts.onlyIfMatch))return {modified:false};map.set(key,{data,etag:String(++version)});return {modified:true};},
    };
  }
  function handler(file){
    const src=readFileSync(new URL('../netlify/functions/'+file,import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export const config/g,'const config').replace('export default async','globalThis.handler = async');
    const context=vm.createContext({getStore,createHmac,timingSafeEqual,Buffer,Request,Response,URL,console,process:{env:{SUBSCRIBER_SESSION_SECRET:'test-secret',STATS_ACCESS_CODE:'test-code'}}});
    vm.runInContext(src,context);return context.handler;
  }
  return {getStore,visits:handler('visits.mjs'),stats:handler('stats.mjs')};
}
function auth(){const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return '__Host-aptsum_stats='+payload+'.'+createHmac('sha256','test-secret').update(payload).digest('base64url');}
const day=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);

test('business visits upgrade existing ledger without losing history and deduplicate per day',async()=>{
  const {getStore,visits,stats}=setup();const today=day();
  await getStore('visit-ledger').set('v2',JSON.stringify({version:2,total:25,pageTotals:{index:20,tier:3,subway:2},days:{[today]:{total:3,pages:{index:2,tier:1,subway:0}}},seenDay:today,seen:{}}));
  const request=()=>new Request('https://aptsum.kr/api/visits?page=business',{headers:{'user-agent':'Browser'}});
  for(let i=0;i<2;i++)assert.equal((await visits(request(),{ip:'192.0.2.1'})).status,200);
  const ledger=JSON.parse(await getStore('visit-ledger').get('v2'));
  assert.equal(ledger.total,26);assert.equal(ledger.pageTotals.index,20);assert.equal(ledger.pageTotals.business,1);assert.equal(ledger.days[today].pages.business,1);
  const denied=await stats(new Request('https://aptsum.kr/api/stats'));assert.equal(denied.status,401);
  const response=await stats(new Request('https://aptsum.kr/api/stats',{headers:{cookie:auth()}}));assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.pages.length,4);assert.deepEqual(data.pages.find(p=>p.page==='business'),{page:'business',label:'비즈니스',total:1,today:1});assert.equal(data.total,26);
});

test('first business visit preserves legacy counters during ledger initialization',async()=>{
  const {getStore,visits,stats}=setup();const store=getStore('visits');
  await store.set('total','50');await store.set('page:index:total','40');await store.set('day-'+day(),'5');
  await visits(new Request('https://aptsum.kr/api/visits?page=business'),{ip:'192.0.2.2'});
  const response=await stats(new Request('https://aptsum.kr/api/stats',{headers:{cookie:auth()}}));const data=await response.json();
  assert.equal(data.total,51);assert.equal(data.today,6);assert.equal(data.pages.find(p=>p.page==='index').total,40);assert.equal(data.pages.find(p=>p.page==='business').total,1);
});
