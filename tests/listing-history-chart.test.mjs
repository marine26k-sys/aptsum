import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const c=vm.createContext({esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
vm.runInContext(html.slice(html.indexOf('function listingTrendDate('),html.indexOf('function fitListingTrendPrices('))+html.slice(html.indexOf('function listingTrendHistoryHTML('),html.indexOf('function listingTrendRowHTML(')),c);
const points=Array.from({length:8},(_,i)=>({date:`2026.10.0${i+1}`,ask:i===7?30:38.5}));
test('expanded history renders price chart with every point and accessible values',()=>{const s=c.listingTrendHistoryHTML(points,'history-1');assert.ok(s.includes('<svg'));assert.ok(!s.includes('<ol>'));assert.equal([...s.matchAll(/<circle /g)].length,8);assert.ok(s.includes('30.0억'));assert.ok(s.includes('38.5억'));assert.ok(s.includes('aria-label="최저 호가 변화:'));assert.ok(!/NaN|Infinity/.test(s));});
test('flat prices and tiny movements remain finite and preserve precision',()=>{for(const values of [[10,10,10,10],[10.01,10.01,10.01,10.02]]){const s=c.listingTrendHistoryHTML(values.map((ask,i)=>({date:`2026.10.0${i+1}`,ask})),'h');assert.ok(!/NaN|Infinity/.test(s));if(values[0]===10.01)assert.ok(s.includes('10.02억'));}});
test('chart retains 12 recent records and spaces dates by elapsed time',()=>{const s=c.listingTrendHistoryHTML(Array.from({length:15},(_,i)=>({date:`2026.10.${String(i+1).padStart(2,'0')}`,ask:10})),'h');assert.equal([...s.matchAll(/<circle /g)].length,12);const spaced=c.listingTrendHistoryHTML([1,2,3,10].map(day=>({date:`2026.10.${String(day).padStart(2,'0')}`,ask:10})),'h');const xs=[...spaced.matchAll(/<circle cx="([\d.]+)"/g)].map(m=>Number(m[1]));assert.ok(xs[3]-xs[2]>(xs[1]-xs[0])*6);assert.equal(c.listingTrendHistoryHTML(points.slice(0,3),'h'),'');});

test('prices are labeled at the start, each change and the last record without repeating flat prices',()=>{
 const prices=[43,43,43,44.5,44.5,44.5,42.5,42.5];
 const s=c.listingTrendHistoryHTML(prices.map((ask,i)=>({date:`2026.10.0${i+1}`,ask})),'h');
 const labels=[...s.matchAll(/class="price-label"[^>]*>([^<]+)<\/text>/g)].map(m=>m[1]);
 assert.deepEqual(labels,['43.0','44.5','42.5']);
});
