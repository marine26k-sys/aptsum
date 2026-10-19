import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('호가 이력은 최근 두 자료와 변동 금액을 한 줄에 표시한다',()=>{
 const c=vm.createContext({peakYmLabel:ym=>/^\d{6}$/.test(ym||'')?`${ym.slice(2,4)}.${ym.slice(4)}`:'',esc:String,listingNameHTML:()=> '가상 단지',listingInfoHTML:()=>'',listingTrendPrecision:()=>1,listingTrendPriceDigits:()=>1,listingTrendDate:x=>x,listingTrendHistoryHTML:()=>''});
 vm.runInContext(html.slice(html.indexOf('function listingTrendRowHTML('),html.indexOf('function listingGapPriceHTML(')),c);
 const s=c.listingTrendRowHTML({apt:'가상 단지',prevAsk:19,ask:18,drop:1,points:[{date:'10/13',ask:20},{date:'10/14',ask:19},{date:'10/15',ask:18}]},0,false);
 assert.doesNotMatch(s,/10\/13/);assert.match(s,/10\/14/);assert.match(s,/10\/15/);
 assert.match(s,/listing-trend-change[^]*class="val"[^]*▼1\.0억<\/span><\/span>/);
 assert.match(s,/aria-expanded="false"/);
});

test('개별 단지는 이전 최저 호가 날짜와 최신 날짜 및 그 차액을 같은 기준으로 표시한다',()=>{
 const c=vm.createContext({peakYmLabel:ym=>/^\d{6}$/.test(ym||'')?`${ym.slice(2,4)}.${ym.slice(4)}`:'',esc:String,listingNameHTML:()=> '가상 단지',listingInfoHTML:()=>'',listingTrendPrecision:()=>1,listingTrendPriceDigits:()=>1,listingTrendDate:x=>x,listingTrendHistoryHTML:()=>'',listingTrendPeakChangeHTML:()=>''});
 vm.runInContext(html.slice(html.indexOf('function listingTrendRowHTML('),html.indexOf('function listingGapPriceHTML(')),c);
 const result=c.listingTrendRowHTML({apt:'가상 단지',ask:11.5,peak:20,prevAsk:11.5,drop:0,previousPricePoint:{date:'10/9',ask:11.9},points:[{date:'10/9',ask:11.9},{date:'10/16',ask:11.5},{date:'10/17',ask:11.5}]},0,false,'all');
 assert.match(result,/10\/9/);assert.match(result,/11.9억/);assert.match(result,/10\/17/);assert.match(result,/▼0.4억/);assert.doesNotMatch(result,/10\/16|보합/);assert.match(result,/전고점 <b>20.0억/);assert.doesNotMatch(result,/최근 2주 호가 최고가/);
});

test('호가 변동 실거래는 년월을 앞에 가격 뒤에 거래층을 표시한다',()=>{
 const c=vm.createContext({esc:String,peakYmLabel:ym=>ym==='202609'?'26.09':'',listingNameHTML:()=> '가상 단지',listingInfoHTML:()=>'',listingTrendPrecision:()=>1,listingTrendPriceDigits:()=>1,listingTrendDate:x=>x,listingTrendHistoryHTML:()=>'',listingTrendPeakChangeHTML:()=>''});
 vm.runInContext(html.slice(html.indexOf('function listingTrendRowHTML('),html.indexOf('function listingGapPriceHTML(')),c);
 const item={apt:'가상 단지',peak:40,prevAsk:36,ask:35,drop:1,latestSale:{price:34.5,date:'20260915',floor:12},points:[{date:'10/18',ask:36},{date:'10/19',ask:35}]};
 const row=c.listingTrendRowHTML(item,0,false,'down',true);
 assert.match(row,/\(26.09\)<\/span> 실거래 <b>34.5억<\/b> · 12층/);assert.doesNotMatch(row,/20260915|평균/);
 assert.doesNotMatch(c.listingTrendRowHTML(item,0,false,'all'),/실거래/);
 assert.match(c.listingTrendRowHTML({...item,latestSale:undefined},0,false,'down',true),/실거래 없음/);
 assert.doesNotMatch(c.listingTrendRowHTML({...item,latestSale:{...item.latestSale,floor:null}},0,false,'down',true),/null층|0층/);
});
