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
 assert.match(html,/개별 단지 · 현재 매물/);
 assert.match(html,/호가 변동 · 상승·하락·보합 전체/);
});
test('개별 단지는 검색과 입주 조건을 유지하고 숨긴 슬라이더를 적용하지 않는다',()=>{
 assert.match(html,/#searchBox\[data-individual="true"\] > :not\(#listingIndividualSearch\):not\(#listingOccupancyFilters\)/);
 assert.match(html,/const items=individual\?cohort:cohort.filter/);
});
