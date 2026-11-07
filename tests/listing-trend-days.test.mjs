import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({Date});
vm.runInContext(html.slice(html.indexOf('function listingTrendChangeDay('),html.indexOf('const listingTrendDayViews=')),context);
const points=[{date:'2026.11.01',ask:10},{date:'2026.11.04',ask:9},{date:'2026.11.07',ask:9}];
test('기간은 최신 업로드가 아니라 현재 가격이 처음 확인된 날을 기준으로 한다',()=>{
 assert.equal(context.listingTrendWithinDays({points},'2026.11.07',3),false);
 assert.equal(context.listingTrendWithinDays({points},'2026.11.07',4),true);
 assert.equal(context.listingTrendWithinDays({points:[{date:'2026.11.06',ask:10},{date:'2026.11.07',ask:9}]},'2026.11.07',1),true);
});
test('변동을 확인할 이전 가격이 없거나 날짜가 잘못되면 기간 결과에 포함하지 않는다',()=>{
 assert.equal(context.listingTrendWithinDays({points:[{date:'2026.11.01',ask:9},{date:'2026.11.07',ask:9}]},'2026.11.07',14),false);
 assert.equal(context.listingTrendWithinDays({points:[{date:'2026.11.01',ask:10},{date:'2026.02.30',ask:9}]},'2026.11.07',14),false);
});
