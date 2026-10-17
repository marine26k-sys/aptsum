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
test('단지 개별 검색은 별도 창에서 열고 후보 선택 후 닫아 조회한다',()=>{
 const dialog={open:false,showModal(){this.open=true},close(){this.open=false}};let focused=false,searched=false;
 const c=vm.createContext({document:{getElementById:id=>id==='listingNameDialog'?dialog:{focus(){focused=true}}},mode:'listingtrend',search(){searched=true}});
 vm.runInContext(html.slice(html.indexOf('let listingNameSelected='),html.indexOf('async function resolveListingName(')),c);
 c.openListingNameSearch();assert.equal(dialog.open,true);assert.equal(focused,true);
 vm.runInContext("listingNameChoices=[{key:'synthetic',lawd:'11680'}]",c);
 c.chooseListingName(0);assert.equal(dialog.open,false);assert.equal(searched,true);
});
