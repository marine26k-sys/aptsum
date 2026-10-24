import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('금액대별 지하철 필터는 선택 분 이내를 포함하고 거리 누락은 조건 적용 시 제외한다',()=>{
 const start=html.indexOf('function lsSubwayActive('),end=html.indexOf('function lsNumberApply(',start);
 const c=vm.createContext({mode:'listingbudget',isIndividualListing:()=>false,LS_SUBWAY_MAX:60});
 vm.runInContext(html.slice(start,end),c);
 const v={sw:10};
 assert.equal(c.lsSubwayActive(v),true);
 assert.equal(c.lsSubwayMatch({subwayMinutes:10},v),true);
 assert.equal(c.lsSubwayMatch({subwayMinutes:11},v),false);
 assert.equal(c.lsSubwayMatch({},v),false);
 assert.equal(c.lsSubwayMatch({subwayMinutes:10},{sw:60}),true);
 c.isIndividualListing=()=>true;
 assert.equal(c.lsSubwayMatch({},v),true);
});

test('매물 정보에는 세대수 다음에 지하철 분을 표시하고 누락값은 감춘다',()=>{
 const start=html.indexOf('function listingSubwayHTML('),end=html.indexOf('// 여러 구가 섞인 결과',start);
 const c=vm.createContext({Number,esc:value=>String(value)});
 vm.runInContext(html.slice(start,end),c);
 assert.equal(c.listingSubwayHTML({subwayMinutes:10}),' · 지하철 10분');
 assert.equal(c.listingSubwayHTML({}), '');
 assert.equal(c.listingSubwayHTML({subwayMinutes:'-'}), '');
 const infoStart=html.indexOf('function listingInfoHTML('),infoEnd=html.indexOf('\nfunction ',infoStart+10);
 const infoTemplate=html.slice(infoStart,infoEnd);
 assert.ok(infoTemplate.indexOf('세대')<infoTemplate.lastIndexOf('listingSubwayHTML(x)'));
});

test('금액대별 공유 링크는 선택한 지하철 제한을 저장하고 기본 전체값은 생략한다',()=>{
 const start=html.indexOf('function buildShareURL('),end=html.indexOf('async function initFromURL(',start);
 const c=vm.createContext({URLSearchParams,location:{pathname:'/',search:''},lsActive:()=>false,lsRateActive:()=>false,lsAskLimits:()=>({min:0,max:50}),isListingMode:()=>true});
 vm.runInContext(html.slice(start,end),c);
 const base={mode:'listingbudget',mN:'12',fM:'0',lawd:'11680',ls:{sw:10}};
 assert.equal(new URL('https://example.com'+c.buildShareURL(base)).searchParams.get('lsw'),'10');
 assert.equal(new URL('https://example.com'+c.buildShareURL({...base,ls:{sw:60}})).searchParams.has('lsw'),false);
});


