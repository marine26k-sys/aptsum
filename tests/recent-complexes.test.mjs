import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('recent complexes retain ten most recent unique region/name/dong identities',()=>{
 const store=new Map();const c=vm.createContext({document:{getElementById:()=>null},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
 vm.runInContext(html.slice(html.indexOf('function getRecentComplexes('),html.indexOf('function getFavs(')),c);
 for(let i=0;i<12;i++)c.rememberRecentComplex('41173',{name:'단지'+i,umd:'비산동'});
 assert.equal(c.getRecentComplexes().length,10);assert.equal(c.getRecentComplexes()[0].name,'단지11');
 c.rememberRecentComplex('41173',{name:'단지5',umd:'비산동'});assert.equal(c.getRecentComplexes()[0].name,'단지5');assert.equal(c.getRecentComplexes().filter(x=>x.name==='단지5').length,1);
 store.set('apc:recentComplexes','{"not":"array"}');assert.equal(c.getRecentComplexes().length,0);
 store.set('apc:recentComplexes','invalid');assert.equal(c.getRecentComplexes().length,0);
});
