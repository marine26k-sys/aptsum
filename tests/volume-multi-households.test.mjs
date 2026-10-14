import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('여러 지역 거래량의 동명 단지는 각 지역 세대수를 사용한다',async()=>{
 const calls=[];let renders=0;const c=vm.createContext({searchToken:3,fetchHHCntBatch:async(lawd)=>{calls.push(lawd);return {'동명단지':{hhcnt:lawd==='11620'?500:1000}}},renderVolume:()=>renders++});
 const start=html.indexOf('async function attachHHCountsAsync('),end=html.indexOf('\nfunction ',start);
 vm.runInContext(html.slice(start,end),c);
 const data={mode:'volume',topVolume:[{apt:'동명단지',lawd:'11620'},{apt:'동명단지',lawd:'11650'}]};
 await c.attachHHCountsAsync(data,3,'11680');assert.deepEqual(calls.sort(),['11620','11650']);assert.equal(data.topVolume[0].hh.hhcnt,500);assert.equal(data.topVolume[1].hh.hhcnt,1000);assert.equal(renders,1);
});
