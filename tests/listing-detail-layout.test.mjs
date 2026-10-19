import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=()=>vm.createContext({esc:String,peakYmLabel:ym=>/^\d{6}$/.test(ym||'')?`${ym.slice(2,4)}.${ym.slice(4)}`:'',listingNameHTML:()=>'<span class="nm-title">가상 단지</span>',listingInfoHTML:()=>'',listingTrendPeakChangeHTML:()=>'',listingTrendDate:x=>x});
test('individual rows without price history keep transaction, high, floor and heading layout',()=>{
 const c=context();vm.runInContext(html.slice(html.indexOf('function listingWithoutHistoryHTML('),html.indexOf('function individualListingTrend(')),c);
 const row=c.listingWithoutHistoryHTML({apt:'가상 단지',py:34,ex:84,ask:20,peak:22,peakYm:'202501',latestSale:{price:19.8,date:'20260915',floor:12}},0,false,'2026.10.19');
 assert.match(row,/34평 \(전용 84\)/);assert.match(row,/\(26.09\).*최신<\/span> <b>19.8억<\/b>.*\(12층\)/);assert.match(row,/\(25.01\).*전고점/);
 assert.ok(row.indexOf('최신')<row.indexOf('전고점'));assert.match(row,/직전 이력 없음/);assert.doesNotMatch(row,/보합|20260915/);
});
test('metadata moves area only in the new layout and highlights only its listing floor',()=>{
 const c=vm.createContext({esc:String,buildAgeLabel:()=> '10년차',guShort:x=>x});vm.runInContext(html.slice(html.indexOf('function listingInfoHTML('),html.indexOf('function listingHeaderHTML(')),c);
 const item={py:34,ex:84,umd:'가상동',built:'201601',hh:500,fl:'중/25'};
 const normal=c.listingInfoHTML(item,false),moved=c.listingInfoHTML(item,false,true);
 assert.match(normal,/34평 \(전용 84\)/);assert.doesNotMatch(moved,/34평|전용 84/);assert.match(moved,/가상동.*10년차.*500세대/);assert.match(moved,/<b style="color:var\(--teal-dark\)">중\/25층<\/b>/);
});
