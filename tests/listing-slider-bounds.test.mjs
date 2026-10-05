import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('every listing slider adopts actual cohort bounds and expands after filters are removed',()=>{
 const specs=[['py','p0','p1',10,60],['ask','q0','q1',0,70],['age','a0','a1',1,40],['hh','h','h1',100,5000],['rate','r0','r1',-30,30]],nodes={};
 for(const [name,,,min,max] of specs){const prefix={py:'lsPy',ask:'lsAsk',age:'lsAge',hh:'lsHh',rate:'lsRate'}[name];nodes[prefix+'Min']={min,max,value:min};nodes[prefix+'Max']={min,max,value:max};}
 const ctx=vm.createContext({Date,document:{getElementById:id=>nodes[id]},lsSync(){},lsGet(){return Object.fromEntries(specs.flatMap(([name,lo,hi])=>{const prefix={py:'lsPy',ask:'lsAsk',age:'lsAge',hh:'lsHh',rate:'lsRate'}[name];return [[lo,+nodes[prefix+'Min'].value],[hi,+nodes[prefix+'Max'].value]];}));}});
 vm.runInContext(html.slice(html.indexOf('const LS_FACETS='),html.indexOf('function lsAskLimits(')),ctx);
 const year=new Date().getFullYear();const rows=[{ask:8.7,py:22,built:String(year-23),hh:657,peak:8},{ask:11,py:36,built:String(year-8),hh:979,peak:9.2}];
 ctx.lsDataBounds(rows);assert.equal(nodes.lsAgeMax.max,24);assert.equal(nodes.lsAgeMin.min,9);assert.equal(nodes.lsAskMax.max,11);assert.equal(nodes.lsPyMax.max,36);assert.equal(nodes.lsHhMax.max,979);assert.equal(nodes.lsRateMax.max,20);
 ctx.lsDataBounds([rows[0]]);assert.equal(nodes.lsAgeMin.value,24);assert.equal(nodes.lsAgeMax.value,24);
 ctx.lsDataBounds(rows);assert.equal(nodes.lsAgeMin.value,9);assert.equal(nodes.lsAgeMax.value,24);
});
