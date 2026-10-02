import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function analyzeListingGap(');
const end=html.indexOf('async function searchListingGap(',start);
const ctx=vm.createContext({LISTING_MIN_HH:300});
vm.runInContext(html.slice(start,end),ctx);
const item=(nid,py,ask,extra={})=>({nid,apt:nid,py,ask,ex:py*2.5,hh:500,lawd:'11680',...extra});

test('compares the cheapest eligible listing in each size band within one apartment',()=>{
  const rows=ctx.analyzeListingGap([
    item('A',25,9.5),item('A',26,9),item('A',33,10.2),item('A',35,10.5),
    item('A',34,8,{hh:200}),item('B',25,7),
  ],20,30);
  assert.equal(rows.length,1);
  assert.equal(rows[0].small.py,26);
  assert.equal(rows[0].large.py,33);
  assert.equal(rows[0].gap,1.2);
});

test('ranks by additional asking amount, includes equal and cheaper larger units',()=>{
  const rows=ctx.analyzeListingGap([
    item('A',25,20),item('A',33,21),
    item('B',25,5),item('B',33,5.7),
    item('C',25,9),item('C',33,8.8),
    item('D',25,10),item('D',33,10),
  ],20,30);
  assert.deepEqual(Array.from(rows,x=>x.nid),['C','D','B','A']);
  assert.deepEqual(Array.from(rows,x=>x.gap),[-0.2,0,0.7,1]);
});

test('never joins different regions or a larger label with a smaller exclusive area',()=>{
  const rows=ctx.analyzeListingGap([
    item('A',25,8),item('A',33,9,{lawd:'41135'}),
    item('B',25,8,{ex:84}),item('B',33,9,{ex:59}),
    item('C',25,8),item('C',33,0),
  ],20,30);
  assert.equal(rows.length,0);
});

test('handles exact size-band boundaries, 60-plus sizes, and invalid selections',()=>{
  const items=[item('A',59,12),item('A',60,13),item('B',50,10),item('B',72,11)];
  assert.equal(ctx.analyzeListingGap(items,50,60).length,2);
  assert.equal(ctx.analyzeListingGap(items,60,50).length,0);
  assert.equal(ctx.analyzeListingGap(items,50,50).length,0);
  assert.equal(ctx.analyzeListingGap(items,25,30).length,0);
});

test('size selectors keep the larger band above the smaller band',()=>{
  const elements={listingGapSmall:{value:'20'},listingGapLarge:{value:'30'}};
  const c=vm.createContext({document:{getElementById:id=>elements[id]}});
  const a=html.indexOf('function listingGapSet('),b=html.indexOf('function listingGapApply(',a);
  vm.runInContext(html.slice(a,b),c);
  c.listingGapSet(40,30,'small');
  assert.equal(+elements.listingGapLarge.value,50);
  c.listingGapSet(40,20,'large');
  assert.equal(+elements.listingGapSmall.value,10);
  c.listingGapSet('invalid',999);
  assert.equal(+elements.listingGapSmall.value,20);
  assert.equal(+elements.listingGapLarge.value,30);
});

test('share URLs preserve both size bands without hidden slider filters',()=>{
  const a=html.indexOf('function buildShareURL('),b=html.indexOf('// 공유 링크 진입 시 자동 검색',a);
  const c=vm.createContext({URLSearchParams,location:{pathname:'/'}});
  vm.runInContext(html.slice(a,b),c);
  const url=c.buildShareURL({mode:'listinggap',mN:'12',fM:'0',lawd:'11680',
    ls:{a0:10,a1:20,h:1000},lg:{smallBand:30,largeBand:50}});
  const p=new URL('https://example.test'+url).searchParams;
  assert.equal(p.get('lg'),'30-50');
  assert.equal(p.has('ls'),false);
  assert.equal(p.has('lr'),false);
});
