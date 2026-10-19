import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../netlify/functions/hhcnt.mjs', import.meta.url), 'utf8');
test('GET and batch preserve K-apt households and walking time while adding verified FAR',async()=>{
 const priorFetch=globalThis.fetch,priorKey=process.env.DATA_GO_KR_KEY;
 try{
  process.env.DATA_GO_KR_KEY='test-only';
  globalThis.fetch=async url=>url.includes('/hhcnt-naver/')
   ? Response.json({items:{one:{name:'평촌래미안푸르지오',hh:1199,far:307,bcr:18,built:'2022.03',dongCnt:99}}})
   : Response.json({items:[{name:'평촌래미안푸르지오아파트',kaptCode:'A10024077',hhcnt:1199,dongCnt:10,subwayWalk:'15~20분이내',subwayLines:['1호선','4호선']}]});
  const {default:handler}=await import('../netlify/functions/hhcnt.mjs');
  const name='평촌래미안푸르지오';
  const single=await (await handler(new Request(`https://header-info.test/api/hhcnt?lawd=41173&name=${encodeURIComponent(name)}`))).json();
  const batch=await (await handler(new Request('https://header-info.test/api/hhcnt',{method:'POST',body:JSON.stringify({lawd:'41173',names:[name]})}))).json();
  for(const result of [single,batch.results[name]]){
   assert.equal(result.hhcnt,1199);assert.equal(result.subwayWalk,'15~20분이내');assert.equal(result.far,307);assert.equal(result.bcr,18);assert.equal(result.built,'2022.03');assert.equal(result.dongCnt,10);
  }
 }finally{globalThis.fetch=priorFetch;if(priorKey===undefined)delete process.env.DATA_GO_KR_KEY;else process.env.DATA_GO_KR_KEY=priorKey;}
});

test('uses the supplementary complex mapping only as a K-apt fallback', () => {
  assert.match(source, /fetch\(`\$\{origin\}\/data\/hhcnt-naver\/\$\{encodeURIComponent\(lawd\)\}\.json`\)/);
  assert.match(source, /hit\.hh === result\.hhcnt/);
  assert.match(source, /const fallbackMap = await loadNaverHh\(new URL\(req\.url\)\.origin, lawd\)/);
  assert.match(source, /applyFallback\(fallbackMap, lawd, nm, results\[nm\]\)/);
  assert.doesNotMatch(source, /applyNaver\(/);
});
