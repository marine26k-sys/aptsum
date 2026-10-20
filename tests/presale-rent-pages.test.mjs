import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {fetchAllRtmsPages} from '../shared/rtms-pages.mjs';
for(const kind of ['presale','rent'])test(`${kind} live collection loads every response page`,async()=>{
 const source=readFileSync(new URL(`../netlify/functions/${kind}.mjs`,import.meta.url),'utf8');
 const calls=[],c=vm.createContext({fetchAllRtmsPages,AbortController,setTimeout,clearTimeout,RTMS:'https://example.test',FETCH_TIMEOUT_MS:1000,rtmsFailed:()=>false,
 fetch:async url=>{const q=new URL(url).searchParams,page=Number(q.get('pageNo'));calls.push(page);return{text:async()=>`<response><totalCount>2</totalCount><numOfRows>1</numOfRows><pageNo>${page}</pageNo><items><item><aptNm>가상단지</aptNm></item></items></response>`};}});
 vm.runInContext(source.slice(source.indexOf('function fetchText('),source.indexOf('// 인천 전용:',source.indexOf('function fetchText('))),c);
 const result=await c.fetchText('test-key','11111','202010',0);assert.deepEqual(calls,[1,2]);assert.equal(result.failed,false);assert.equal(result.collectedCount,2);
});
