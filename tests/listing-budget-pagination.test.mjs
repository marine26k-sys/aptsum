import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(n,occupancy='available'){
 const result={innerHTML:'',classList:{add(){}}};
 const d={mode:'listingbudget',rows:Array.from({length:n},(_,i)=>({ask:n-i,peak:0,apt:`item${n-i}`}))};
 const c=vm.createContext({mode:'listingbudget',lastData:d,listingBudgetSel:'all',LISTING_BUDGET_BANDS:[{v:'all',l:'전체',lo:0,hi:Infinity},{v:'high',l:'고가',lo:201,hi:Infinity}],listingBudgetBandOf:x=>({v:x>=201?'high':'all'}),shortRegionLabel:()=>'',document:{getElementById:()=>result},regionMulti:()=>false,listingNameHTML:x=>x.apt,listingInfoHTML:()=>'',rkSep:()=>'',listingHeaderHTML:()=>'',listingOccupancy:()=>occupancy,listingOccupancyLabel:()=>occupancy==='presale'?'분양권':'입주 가능',hint:()=>'',listingLinkLegend:()=>'',LISTING_BUDGET_MIN_HH:100});
 vm.runInContext(html.slice(html.indexOf('function setListingBudgetBand('),html.indexOf('function renderLongPeak(')),c);
 c.renderListingBudget(d);return {c,result,d};
}
test('budget lists all prices in ascending order and adds 100 per click',()=>{
 const {c,result,d}=setup(205,'presale');
 const count=()=>[...result.innerHTML.matchAll(/class="rk"/g)].length;
 assert.equal(count(),100);assert.ok(result.innerHTML.indexOf('item1<')<result.innerHTML.indexOf('item100<'));assert.ok(!result.innerHTML.includes('onclick="setListingBudgetBand'));
 c.showMoreListingBudget();assert.equal(count(),200);
 c.showMoreListingBudget();assert.equal(count(),205);assert.ok(!result.innerHTML.includes('id="listingBudgetMore"'));
 assert.equal(d.rows[0].ask,205);
 c.renderListingBudget(d);assert.equal(count(),100);

 c.mode='listingurgent';c.showMoreListingBudget();assert.equal(count(),100);
});
test('100 or fewer results need no more button, including empty results',()=>{
 for(const n of [0,1,100]){const {result}=setup(n);assert.equal([...result.innerHTML.matchAll(/class="rk"/g)].length,n);assert.ok(!result.innerHTML.includes('id="listingBudgetMore"'));}
});

test('only presale omits price pills and shows all price ranges',()=>{
 const {c,result}=setup(205,'presale');
 assert.ok(!result.innerHTML.includes('onclick="setListingBudgetBand'));
 assert.equal([...result.innerHTML.matchAll(/class="rk"/g)].length,100);
 c.showMoreListingBudget();c.showMoreListingBudget();
 assert.equal([...result.innerHTML.matchAll(/class="rk"/g)].length,205);
 for(const occupancy of ['available','tenant'])assert.ok(setup(20,occupancy).result.innerHTML.includes('onclick="setListingBudgetBand'));
});

test('changing a regular price band resets pagination',()=>{
 const {c,result}=setup(205);
 c.showMoreListingBudget();assert.equal([...result.innerHTML.matchAll(/class="rk"/g)].length,200);
 c.setListingBudgetBand('high');assert.equal([...result.innerHTML.matchAll(/class="rk"/g)].length,5);
 c.setListingBudgetBand('all');assert.equal([...result.innerHTML.matchAll(/class="rk"/g)].length,100);
});
