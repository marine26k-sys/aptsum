import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const c=vm.createContext({exclusiveAreaKey:t=>Math.floor(t.area)});
vm.runInContext(html.slice(html.indexOf('function priceFloorTrades('),html.indexOf('function analyzeComplex(')),c);
test('low floors qualify only at their own complex, area and calendar year high, excluding direct trades',()=>{
 const base={apt:'가상단지',umd:'가상동',lawd:'11111',area:84.9,ym:'202610',floor:10,amt:10};
 const rows=[base,{...base,floor:1,amt:11},{...base,floor:2,amt:9},{...base,floor:3,amt:11},{...base,floor:4,amt:12,direct:1},{...base,ym:'202510',floor:2,amt:8},{...base,area:59,floor:1,amt:7},{...base,lawd:'22222',floor:1,amt:6},{...base,floor:null,amt:11}];
 assert.deepEqual(Array.from(c.priceFloorTrades(rows),x=>rows.indexOf(x)),[0,1,3,5,6,7]);
 assert.equal(rows.length,9);
});
test('a higher trade elsewhere in the same year disqualifies the low-floor exception',()=>{
 const base={apt:'가상단지',umd:'가상동',area:84,ym:'202610',floor:2,amt:11};
 assert.equal(c.priceFloorTrades([base,{...base,ym:'202601',floor:8,amt:12}]).length,1);
 assert.equal(c.priceFloorTrades([{...base,floor:4}]).length,0);
});
