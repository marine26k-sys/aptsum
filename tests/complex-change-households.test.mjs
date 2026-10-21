import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(token=3){const calls=[],renders=[];const c=vm.createContext({searchToken:token,fetchHHCntBatch:async(lawd,names)=>{calls.push([lawd,names]);return {'동명단지':{hhcnt:lawd==='11620'?500:1000}}},renderLongTermRise:d=>renders.push(d)});const start=html.indexOf('async function attachHHCountsAsync(');vm.runInContext(html.slice(start,html.indexOf('\nfunction ',start)),c);return {c,calls,renders};}
test('complex change attaches household counts using each actual district and rerenders',async()=>{
 const {c,calls,renders}=setup(),d={mode:'longtermrise',rows:[{apt:'동명단지',lawd:'11620'},{apt:'동명단지',lawd:'11650'},{apt:'동명단지',lawd:'11620'}]};
 await c.attachHHCountsAsync(d,3,'11680');assert.equal(calls.length,2);assert.ok(calls.every(x=>x[1].length===1));assert.equal(d.rows[0].hh.hhcnt,500);assert.equal(d.rows[1].hh.hhcnt,1000);assert.equal(renders.length,1);
});
test('household enrichment never overwrites a newer search screen',async()=>{
 const {c,renders}=setup(4);await c.attachHHCountsAsync({mode:'longtermrise',rows:[{apt:'동명단지'}]},3,'11650');assert.equal(renders.length,0);
});
test('complex change rows show household counts without repeating the comparison-period text',()=>{
 const result={innerHTML:'',classList:{add(){}}},c=vm.createContext({molitPageData:d=>d,regionMulti:()=>false,sel:{options:[{textContent:'가상 지역'}],selectedIndex:0},hdTop:()=>'',shortRegionLabel:x=>x,esc:x=>String(x),hdVs:()=>'',hint:()=>'',aptLabel:x=>x.apt,buildAgeLabel:()=>'',chgHTML:()=>'',rkSep:()=>'',appendMolitMore:()=>{},document:{getElementById:id=>id==='result'?result:{}}});
 vm.runInContext(html.slice(html.indexOf('function renderLongTermRise('),html.indexOf('function renderPriceBandRise(')),c);
 c.renderLongTermRise({periodM:24,period:'24.10 ~ 26.10',rows:[{apt:'가상단지',umd:'가상동',py:'26평',area:69,hh:{hhcnt:1234},pastAvg:13.7,recentAvg:22.7,changeAmt:9,changePct:66}]});
 assert.match(result.innerHTML,/1,234세대/);assert.match(result.innerHTML,/13.7억 →/);assert.doesNotMatch(result.innerHTML,/24개월 전 13.7/);
});
