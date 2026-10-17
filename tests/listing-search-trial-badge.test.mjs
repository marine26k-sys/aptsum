import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('모든 실매물 검색 화면은 체험자에게만 배지를 보이고 단지 검색은 제목 배지만 사용한다',()=>{
 const box={dataset:{}},badge={hidden:true},nameBadge={hidden:true};
 const c=vm.createContext({document:{getElementById:id=>id==='searchBox'?box:id==='listingSearchTrial'?badge:nameBadge}});
 vm.runInContext(html.slice(html.indexOf('function isListingMode('),html.indexOf('// 무료 체험 사용자가 강남구 외 지역')),c);
 for(const mode of ['listingbudget','listingurgent','listingtrend','listingrise','longpeaklisting','listinggap']){
  box.dataset={mode,individual:'false'};c.syncListingSearchTrialBadge(true);assert.equal(badge.hidden,false);c.syncListingSearchTrialBadge(false);assert.equal(badge.hidden,true);
 }
 box.dataset={mode:'complex'};c.syncListingSearchTrialBadge(true);assert.equal(badge.hidden,true);
 box.dataset={mode:'listingbudget',individual:'true'};c.syncListingSearchTrialBadge(true);assert.equal(badge.hidden,true);assert.equal(nameBadge.hidden,false);
 c.syncListingSearchTrialBadge(false);assert.equal(nameBadge.hidden,true);
});
