import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({Date});
vm.runInContext(html.slice(html.indexOf('function listingPreviousPricePoint('),html.indexOf('function listingTrendNameMatch('))+html.slice(html.indexOf('function listingTrendDayTimestamp('),html.indexOf('const listingTrendDayViews=')),context);
const row={ask:8,points:[{date:'2026.10.26',ask:8.8},{date:'2026.11.04',ask:8.6},{date:'2026.11.07',ask:8}]};
test('선택한 기간의 이력으로 이전 가격과 변동 금액을 다시 계산한다',()=>{
 const result=context.listingTrendRowInDays(row,'2026.11.07',5,'down');
 assert.equal(result.previousPricePoint.date,'2026.11.04');assert.equal(result.prevAsk,8.6);assert.equal(result.drop,0.6);
 assert.equal(result.points.length,2);assert.equal(context.listingTrendRowInDays(row,'2026.11.07',1,'down'),null);
});
test('기간 안에 비교할 이전 기록이 없거나 변동 방향이 다르면 제외한다',()=>{
 assert.equal(context.listingTrendRowInDays({ask:8,points:[row.points[0],row.points[2]]},'2026.11.07',5,'down'),null);
 assert.equal(context.listingTrendRowInDays(row,'2026.11.07',5,'up'),null);
 assert.equal(context.listingTrendRowInDays(row,'2026.02.30',5,'down'),null);
});
