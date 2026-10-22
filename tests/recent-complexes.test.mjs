import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('recent complexes retain seven most recent unique region/name/dong identities',()=>{
 const store=new Map();const c=vm.createContext({document:{getElementById:()=>null},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
 vm.runInContext(html.slice(html.indexOf('const RECENT_COMPLEX_MAX'),html.indexOf('function getFavs(')),c);
 for(let i=0;i<12;i++)c.rememberRecentComplex('41173',{name:'단지'+i,umd:'비산동'});
 assert.equal(c.getRecentComplexes().length,7);assert.equal(c.getRecentComplexes()[0].name,'단지11');
 c.rememberRecentComplex('41173',{name:'단지5',umd:'비산동'});assert.equal(c.getRecentComplexes()[0].name,'단지5');assert.equal(c.getRecentComplexes().filter(x=>x.name==='단지5').length,1);
 store.set('apc:recentComplexes','{"not":"array"}');assert.equal(c.getRecentComplexes().length,0);
 store.set('apc:recentComplexes','invalid');assert.equal(c.getRecentComplexes().length,0);
});

test('recent complex uses result region and removes old query-region duplicate',()=>{
 const store=new Map();const c=vm.createContext({document:{getElementById:()=>null},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
 vm.runInContext(html.slice(html.indexOf('const RECENT_COMPLEX_MAX'),html.indexOf('function getFavs(')),c);
 c.rememberRecentComplex('41171',{name:'평촌래미안푸르지오',umd:'비산동'});
 c.rememberRecentComplex('41173',{name:'평촌래미안푸르지오',umd:'비산동'});
 c.rememberRecentComplex('41171',{name:'평촌래미안푸르지오',umd:'비산동',splitLawd:'41173'});
 assert.equal(c.getRecentComplexes().length,1);assert.equal(c.getRecentComplexes()[0].lawd,'41173');
 c.rememberRecentComplex('11110',{name:'다른단지',umd:'동일동'});
 c.rememberRecentComplex('11140',{name:'다른단지',umd:'동일동'});
 assert.equal(c.getRecentComplexes().filter(x=>x.name==='다른단지').length,2);
 c.rememberRecentComplex('41173',{name:'석수e-편한세상',umd:'석수동'});
 c.rememberRecentComplex('41173',{name:'석수e편한세상',umd:'석수동'});
 assert.equal(c.getRecentComplexes().filter(x=>x.umd==='석수동').length,1);
});

test('recent complex saves when an all-region search has no select value',()=>{
 const store=new Map();const c=vm.createContext({document:{getElementById:()=>null},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
 vm.runInContext(html.slice(html.indexOf('const RECENT_COMPLEX_MAX'),html.indexOf('function getFavs(')),c);
 c.rememberRecentComplex('',{name:'헬리오시티',umd:'가락동',splitLawd:'11740'});
 const row=c.getRecentComplexes()[0];
 assert.equal(row.lawd,'11740');assert.equal(row.name,'헬리오시티');assert.equal(row.umd,'가락동');
});
