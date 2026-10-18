import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function search(opts){'),html.indexOf('async function runSearch(opts){'));
function setup(){
 const pending=[],scrolls=[],result={firstChild:{},classList:{contains:()=>true},scrollIntoView:options=>scrolls.push(options)};
 const c=vm.createContext({mode:'complex',document:{getElementById:()=>result},runSearch:()=>new Promise(resolve=>pending.push(resolve))});vm.runInContext(source,c);
 return {c,pending,scrolls,result};
}
test('successful queries scroll to the new result, silent filter refreshes do not',async()=>{
 const {c,pending,scrolls,result}=setup();let p=c.search();result.firstChild={};pending.shift()();await p;assert.equal(scrolls.length,1);assert.equal(scrolls[0].block,'start');
 p=c.search({silentScroll:true});result.firstChild={};pending.shift()();await p;assert.equal(scrolls.length,1);
 p=c.search({silentScroll:true,scrollToListingResult:true});result.firstChild={};pending.shift()();await p;assert.equal(scrolls.length,2);
});
test('candidate-only searches and older overlapping queries do not scroll',async()=>{
 const {c,pending,scrolls,result}=setup();let p=c.search();pending.shift()();await p;assert.equal(scrolls.length,0);
 const old=c.search(),latest=c.search();result.firstChild={};pending[1]();await latest;assert.equal(scrolls.length,1);pending[0]();await old;assert.equal(scrolls.length,1);
});
test('switching tabs before completion does not scroll',async()=>{
 const {c,pending,scrolls,result}=setup();const p=c.search();c.mode='region';result.firstChild={};pending.shift()();await p;assert.equal(scrolls.length,0);
});
