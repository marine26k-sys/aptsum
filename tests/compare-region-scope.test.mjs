import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('단지 비교 전체 지역 선택은 라벨뿐 아니라 실제 select 값도 유지한다',()=>{
 const select={options:[{value:'11620'}],appendChild(o){this.options.push(o)},get value(){return this.current||''},set value(v){this.current=this.options.some(o=>o.value===v)?v:''}};
 const label={};const row={querySelector:s=>s==='select'?select:label};
 const c=vm.createContext({document:{createElement:()=>({dataset:{}})},isAllScope:v=>v.startsWith('ALL:')||v.startsWith('CITYALL:'),regionNameByLawd:v=>v});
 vm.runInContext(html.slice(html.indexOf('function setCmpRowLawd('),html.indexOf('function pickRegion(',html.indexOf('function setCmpRowLawd('))),c);
 for(const code of ['ALL:서울','ALL:경기','CITYALL:성남']){c.setCmpRowLawd(row,code);assert.equal(select.value,code);assert.equal(label.textContent,code);}
 const count=select.options.length;c.setCmpRowLawd(row,'ALL:서울');assert.equal(select.options.length,count);
 c.setCmpRowLawd(row,'11620');assert.equal(select.value,'11620');
});
