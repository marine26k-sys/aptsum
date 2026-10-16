import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
test('즐겨찾기와 최근 단지는 이전 지역과 자동완성 선택을 함께 교체한 후 조회한다',async()=>{
 for(const action of ['favGo','openRelatedComplex']){
  const input={value:'잠실르엘',dataset:{pickedLawd:'11710',pickedName:'잠실르엘'}};
  let searched=0,saved=0,rendered=0;
  const c=vm.createContext({sel:{value:'11710',options:[{value:'11710',textContent:'송파구'},{value:'41173',textContent:'안양 동안구'}]},regionSel:[{lawd:'11710',name:'송파구'}],document:{getElementById:()=>input},closeExpandedComplexMap(){},setMode(){},saveRegionSel(){saved++},renderRegionChips(){rendered++},syncRegionPickBtn(){},search(){searched++},favTradeCount:async()=>0,setFavSeenCount(){}});
  vm.runInContext(extract('function openRelatedComplex(', 'function getFavs(')+extract('function favGo(', '// ── 즐겨찾기 "신규 거래"'),c);
  c[action]('41173','평촌래미안푸르지오');
  assert.equal(c.sel.value,'41173');assert.equal(c.regionSel.length,1);assert.equal(c.regionSel[0].lawd,'41173');
  assert.equal(input.dataset.pickedLawd,'41173');assert.equal(input.dataset.pickedName,input.value);
  assert.equal(searched,1);assert.equal(saved,1);assert.equal(rendered,1);
 }
});
