import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function listingTrendPeakMatch('),html.indexOf('function listingTrendBelowPeakToggle(')),ctx);
test('below peak includes equal and lower asks but excludes above and missing peaks',()=>{for(const [ask,peak,want] of [[9,10,true],[10,10,true],[10.01,10,false],[9,0,false],[9,null,false],[NaN,10,false],[0,10,false]])assert.equal(ctx.listingTrendPeakMatch({ask,peak}),want);});
