import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const c=vm.createContext({ymLabel:s=>s.slice(2,4)+'.'+s.slice(4)});
vm.runInContext(html.slice(html.indexOf('function fillMonthlyChartGaps('),html.indexOf('function analyzeComplex(')),c);
test('missing months carry the previous actual average with zero trades, without filling before the first trade',()=>{
 const actual=[{ym:'26.02',avg:10,n:2},{ym:'26.05',avg:12,n:1}];
 const result=c.fillMonthlyChartGaps(actual,['202601','202602','202603','202604','202605','202606']);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[actual[0],{ym:'26.03',avg:10,n:0,carriedFrom:'26.02'},{ym:'26.04',avg:10,n:0,carriedFrom:'26.02'},actual[1],{ym:'26.06',avg:12,n:0,carriedFrom:'26.05'}]);
 assert.equal(actual.length,2);assert.equal(c.fillMonthlyChartGaps([],['202601']).length,0);
});
