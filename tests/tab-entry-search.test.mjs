import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('async function initFromURL(');
const source=html.slice(start,html.indexOf('// 공유 링크는 접속한 주소',start));
function page(search){
  const elements=new Map(),rows=[];
  const ctx=vm.createContext({URLSearchParams, location:{search}, calls:0, mode:null,
    addCmpRow(){rows.push({});},
    document:{querySelectorAll(){return rows;},getElementById(id){if(!elements.has(id))elements.set(id,{value:'',checked:false});return elements.get(id);}},
    sel:{value:'11680'},regionSel:[{lawd:'11680',name:'강남구'}],
    aptsumSubscriberGate:{ready:Promise.resolve()},needsSubscriberSession:()=>false,isListingMode:()=>false,
    setMode(m){ctx.mode=m;return true;}, search(){ctx.calls++;},showError(){throw Error('unexpected auth error');},
    resetQueriedSliderDefaults(){},regionSelMax:()=>25,saveRegionSel(){},renderRegionChips(){},renderPyBandMultiBtn(){},lsSet(){},listingGapSet(){},setBuildYearValue(){}
  });
  vm.runInContext(html.slice(html.indexOf('function normalizeListingOccupancy('),html.indexOf('function listingOccupancy(){'))+source,ctx);return {ctx,elements};
}
test('all tab entry URLs remain idle even with a remembered region',async()=>{
  const links=[...html.matchAll(/class="tab[^"\n]*"[^\n]*href="([^\"]+\?m=[^\"]+)"/g)].map(x=>x[1]);
  assert.ok(links.length>=20);
  for(const link of links){const {ctx}=page(new URL(link,'https://aptsum.kr').search);await ctx.initFromURL();assert.equal(ctx.calls,0,link);assert.ok(ctx.mode);}
});
test('shared result URL restores filters and performs exactly one query',async()=>{
  for(const query of ['?m=region&r=11680&by=under10','?m=subway&rs=11680:강남구','?m=listingbudget&r=11680&lbn=1','?m=complex&r=11680&q=래미안']){
    const {ctx,elements}=page(query);await ctx.initFromURL();assert.equal(ctx.calls,1,query);
    if(query.includes('q='))assert.equal(elements.get('q').value,'래미안');
    if(query.includes('lbn='))assert.ok(!elements.get('listingBudgetNewOnly')?.checked);
  }
});

test('legacy shared real-trade URL restores at most 25 regions',async()=>{
  const rs=Array.from({length:47},(_,i)=>`${41000+i}:지역${i}`).join('|');
  const {ctx}=page('?m=region&rs='+encodeURIComponent(rs));
  await ctx.initFromURL();assert.equal(ctx.regionSel.length,25);assert.equal(ctx.calls,1);
});
