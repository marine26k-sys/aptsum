import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('호가 전체는 상승 하락 보합을 포함하고 단지명은 공백 없이 부분 검색한다',()=>{
 const c=vm.createContext({LISTING_MIN_HH:300});
 vm.runInContext(html.slice(html.indexOf('function listingTrendSnapshotRows('),html.indexOf('function syncListingTrendBelowPeak(')),c);
 const item=(nid,ask)=>({nid,ask,ex:84,hh:500,apt:'테스트 래미안'});
 const snapshots=[{uploadId:'a',items:[item('1',10),item('2',10),item('3',10)]},{uploadId:'b',items:[item('1',11),item('2',9),item('3',10)]}];
 assert.equal(c.listingTrendSnapshotRows(snapshots[1],snapshots,null,'x','구',false,'all').length,3);
 assert.equal(c.listingTrendSnapshotRows(snapshots[1],snapshots,null,'x','구',false,'up').length,1);
 assert.equal(c.listingTrendSnapshotRows(snapshots[1],snapshots,null,'x','구',false,'down').length,1);
 assert.equal(c.listingTrendNameMatch(item('1',10),'테스트래미안'),true);
 assert.equal(c.listingTrendNameMatch(item('1',10),'다른단지'),false);
});
test('실매물 메뉴의 개별 단지 탭에서 현재 매물과 호가 이력을 함께 표시한다',()=>{
 assert.match(html,/id="tabLIC"[^>]*individual=1/);
 assert.doesNotMatch(html,/id="listingNameSearchLink"/);
 assert.match(html,/d.individualTrend=listingTrendSnapshotRows/);
 assert.match(html,/d.individual\?'단지 분석'/);
 assert.match(html,/d.individual\?'단지 분석'/);
});
test('개별 단지는 검색과 입주 조건을 유지하고 숨긴 슬라이더를 적용하지 않는다',()=>{
 assert.match(html,/#searchBox\[data-individual="true"\] > :not\(#listingIndividualSearch\):not\(#listingOccupancyFilters\)/);
 assert.match(html,/const items=individual\?cohort:cohort.filter/);
});
test('현재 매물과 이력은 같은 지역·단지·전용면적·현재 금액일 때만 합친다',()=>{
 const c=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function individualListingTrend('),html.indexOf('function renderListingBudget(')),c);
 const item={lawd:'11710',nid:'synthetic',ex:39,ask:18.5};
 const valid={...item,prevAsk:19,points:[]};
 assert.equal(c.individualListingTrend(item,[{...valid,ex:59},valid]),valid);
 assert.equal(c.individualListingTrend(item,[{...valid,ask:20}]),null);
 assert.equal(c.individualListingTrend(item,[]),null);
});
test('이력 없는 평형도 같은 행 배치로 현재 호가와 전고점 차이를 표시하며 보합을 만들지 않는다',()=>{
 const c=vm.createContext({listingNameHTML:()=> '가상 단지',listingInfoHTML:()=> '51평',listingTrendPeakChangeHTML:()=> '▼5.0억',listingTrendDate:x=>x,esc:String});
 vm.runInContext(html.slice(html.indexOf('function listingWithoutHistoryHTML('),html.indexOf('function individualListingTrend(')),c);
 const result=c.listingWithoutHistoryHTML({ask:50,peak:55},8,false,'2026.10.17');
 assert.match(result,/listing-trend-row/);assert.match(result,/listing-trend-peak/);assert.match(result,/50.0억/);assert.match(result,/직전 이력 없음/);
 assert.doesNotMatch(result,/보합|aria-expanded|toggleListingTrendHistory/);
});
test('단지 분석은 금액대별 최소 세대수와 같은 기준으로 이력을 합친다',()=>{
 const c=vm.createContext({LISTING_MIN_HH:300});
 vm.runInContext(html.slice(html.indexOf('function listingTrendSnapshotRows('),html.indexOf('function syncListingTrendBelowPeak(')),c);
 const item={nid:'small-complex',ex:59,hh:150,ask:10};
 const snapshots=[{uploadId:'a',items:[{...item,ask:11}]},{uploadId:'b',items:[item]}];
 assert.equal(c.listingTrendSnapshotRows(snapshots[1],snapshots,null,'11680','강남구',false,'all',100).length,1);
 assert.equal(c.listingTrendSnapshotRows(snapshots[1],snapshots,null,'11680','강남구',false,'all').length,0);
});
test('입주 조건을 바꾸면 이전 요청과 후보 버튼을 함께 무효화한다',()=>{
 let cleared=false,aborted=false;
 const element={classList:{remove(){}},replaceChildren(){cleared=true},innerHTML:'old',disabled:true};
 const c=vm.createContext({searchToken:7,searchAbortController:{abort(){aborted=true}},listingNameChoices:[{key:'old'}],lastData:{},document:{getElementById:()=>element}});
 vm.runInContext(html.slice(html.indexOf('function listingOccupancyApply('),html.indexOf('async function fetchListings(')),c);
 c.listingOccupancyApply();assert.equal(c.searchToken,8);assert.equal(cleared,true);assert.equal(aborted,true);assert.equal(c.listingNameChoices.length,0);assert.equal(c.lastData,null);
});
