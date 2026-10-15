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
