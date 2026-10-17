import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('최근 2주 비교는 같은 단지·전용면적의 날짜별 최저 호가 최고값이며 기간 밖은 제외한다',()=>{
 const c=vm.createContext({});vm.runInContext(html.slice(html.indexOf('function twoWeekListingPeak('),html.indexOf('function listingTrendPeakChangeHTML(')),c);
 const item={nid:'synthetic',ex:59,ask:10,peak:99};
 const snap=(asOf,ask,ex=59)=>({asOf,items:[{nid:'synthetic',ex,ask}]});
 const snapshots=[snap('2026.10.03',50),snap('2026.10.04',12),snap('2026.10.16',11),snap('2026.10.17',10),snap('2026.10.17',30,84)];
 assert.equal(c.twoWeekListingPeak(item,snapshots,Date.parse('2026-10-17T00:00:00Z')),12);
 assert.equal(c.twoWeekListingPeak(item,[],Date.parse('2026-10-17T00:00:00Z')),null);
});
