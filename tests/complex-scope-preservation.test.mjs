import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('전체 지역 자동완성 선택은 지역 선택을 유지하고 실제 단지 지역만 기억한다',()=>{
 const input={value:'',dataset:{},closest:()=>null};
 const regions=[{lawd:'41171',name:'안양 만안구'},{lawd:'41173',name:'안양 동안구'}];
 const c=vm.createContext({acInput:input,regionSel:regions,sel:{value:'ALL:경기'},isAllScope:()=>true,acHide:()=>{},saveRegionSel:()=>{throw Error('scope changed');},renderRegionChips:()=>{throw Error('scope changed');}});
 vm.runInContext(html.slice(html.indexOf('function acPick('),html.indexOf("document.addEventListener('input'",html.indexOf('function acPick('))),c);
 c.acPick('아르테자이 [안양동]','41171');
 assert.equal(c.sel.value,'ALL:경기');assert.equal(c.regionSel,regions);assert.equal(input.dataset.pickedLawd,'41171');assert.equal(input.value,'아르테자이 [안양동]');
});
test('비교 행 전체 지역은 유지하고 개별 지역은 선택한 지역으로 갱신한다',()=>{
 const select={value:'ALL:서울'};const row={querySelector:()=>select};
 const input={value:'',dataset:{},closest:()=>row};let updates=0;
 const c=vm.createContext({acInput:input,isAllScope:v=>v.startsWith('ALL:'),acHide:()=>{},setCmpRowLawd:(_,lawd)=>{updates++;select.value=lawd;}});
 vm.runInContext(html.slice(html.indexOf('function acPick('),html.indexOf("document.addEventListener('input'",html.indexOf('function acPick('))),c);
 c.acPick('롯데캐슬이스트폴 [자양동]','11215');assert.equal(select.value,'ALL:서울');assert.equal(input.dataset.pickedLawd,'11215');assert.equal(updates,0);
 select.value='11680';c.acPick('롯데캐슬이스트폴 [자양동]','11215');assert.equal(select.value,'11215');assert.equal(updates,1);
});
