import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('실제 급매물 렌더러는 180개 중 100개만 표시하고 더 보기로 나머지 80개를 연다',()=>{
 const buttons=[];const result={innerHTML:'',classList:{add(){}},appendChild:b=>buttons.push(b)};
 const c=vm.createContext({document:{getElementById:id=>id==='result'?result:{},createElement:()=>({style:{}})},regionMulti:()=>false,listingNameHTML:x=>x.apt,listingInfoHTML:()=>'',esc:String,chgHTML:()=>'',rkSep:()=>'',listingHeaderHTML:()=>'',hint:()=>'',listingOccupancyLabel:()=>'',listingFloorLabel:()=>'',listingLinkLegend:()=>'',URGENT_MIN_ASK:1,LISTING_MIN_HH:300});
 vm.runInContext(html.slice(html.indexOf('const molitPageCounts'),html.indexOf('function renderRegion(')),c);
 const start=html.indexOf('function renderListingUrgent(');vm.runInContext(html.slice(start,html.indexOf('function setListingBudgetBand(',start)),c);
 const data={rows:Array.from({length:180},(_,i)=>({apt:'단지'+i,py:33,area:84,ask:10,peak:12,gapAmt:2,gapPct:-17}))};
 c.renderListingUrgent(data);assert.equal((result.innerHTML.match(/class="rk"/g)||[]).length,100);assert.equal(data.rows.length,180);assert.match(buttons[0].textContent,/80개/);assert.match(result.innerHTML,/33평 \(전용 84\)<\/span> 10\.0억/);
 buttons[0].onclick();assert.equal((result.innerHTML.match(/class="rk"/g)||[]).length,180);assert.equal(buttons.length,1);
});
