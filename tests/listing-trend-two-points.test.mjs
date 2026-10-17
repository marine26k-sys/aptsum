import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('호가 이력은 최근 두 자료와 변동 금액을 한 줄에 표시한다',()=>{
 const c=vm.createContext({esc:String,listingNameHTML:()=> '가상 단지',listingInfoHTML:()=>'',listingTrendPrecision:()=>1,listingTrendPriceDigits:()=>1,listingTrendDate:x=>x,listingTrendHistoryHTML:()=>''});
 vm.runInContext(html.slice(html.indexOf('function listingTrendRowHTML('),html.indexOf('function listingGapPriceHTML(')),c);
 const s=c.listingTrendRowHTML({apt:'가상 단지',prevAsk:19,ask:18,drop:1,points:[{date:'10/13',ask:20},{date:'10/14',ask:19},{date:'10/15',ask:18}]},0,false);
 assert.doesNotMatch(s,/10\/13/);assert.match(s,/10\/14/);assert.match(s,/10\/15/);
 assert.match(s,/listing-trend-change[^]*class="val"[^]*▼1\.0억<\/span><\/span>/);
 assert.match(s,/aria-expanded="false"/);
});

test('개별 단지는 이전 최저 호가 날짜와 최신 날짜 및 그 차액을 같은 기준으로 표시한다',()=>{
 const c=vm.createContext({esc:String,listingNameHTML:()=> '가상 단지',listingInfoHTML:()=>'',listingTrendPrecision:()=>1,listingTrendPriceDigits:()=>1,listingTrendDate:x=>x,listingTrendHistoryHTML:()=>'',listingTrendPeakChangeHTML:()=>''});
 vm.runInContext(html.slice(html.indexOf('function listingTrendRowHTML('),html.indexOf('function listingGapPriceHTML(')),c);
 const result=c.listingTrendRowHTML({apt:'가상 단지',ask:11.5,peak:20,prevAsk:11.5,drop:0,previousPricePoint:{date:'10/9',ask:11.9},points:[{date:'10/9',ask:11.9},{date:'10/16',ask:11.5},{date:'10/17',ask:11.5}]},0,false,'all');
 assert.match(result,/10\/9/);assert.match(result,/11.9억/);assert.match(result,/10\/17/);assert.match(result,/▼0.4억/);assert.doesNotMatch(result,/10\/16|보합/);assert.match(result,/최근 3년 최고가 <b>20.0억/);assert.doesNotMatch(result,/최근 2주 호가 최고가/);
});
