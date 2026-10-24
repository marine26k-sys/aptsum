import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('지하철 필터는 전체 기본값에서만 비역세권을 포함하고 시간 제한에서는 제외한다',()=>{
 const start=html.indexOf('function lsSubwayActive('),end=html.indexOf('function lsNumberApply(',start);
 const c=vm.createContext({mode:'listingbudget',isIndividualListing:()=>false,LS_SUBWAY_ALL:60});
 vm.runInContext(html.slice(start,end),c);
 const v={sw:20};
 assert.equal(c.lsSubwayActive(v),true);
 assert.equal(c.lsSubwayMatch({subwayMinutes:20},v),true);
 assert.equal(c.lsSubwayMatch({subwayMinutes:21},v),false);
 assert.equal(c.lsSubwayMatch({},v),false);
 assert.equal(c.lsSubwayMatch({subwayMinutes:'-'},v),false);
 assert.equal(c.lsSubwayMatch({subwayMinutes:-1},v),false);
 assert.equal(c.lsSubwayActive({sw:60}),false);
 assert.equal(c.lsSubwayMatch({subwayMinutes:10},{sw:60}),true);
 assert.equal(c.lsSubwayMatch({}, {sw:60}),true);
 c.isIndividualListing=()=>true;
 assert.equal(c.lsSubwayMatch({},v),true);
 const stepsStart=html.indexOf('const LS_SUBWAY_ALL ='),stepsEnd=html.indexOf('const LS_RATE_MIN',stepsStart);
 const stepsContext=vm.createContext({});vm.runInContext(html.slice(stepsStart,stepsEnd),stepsContext);
 assert.deepEqual(Array.from(vm.runInContext('LS_SUBWAY_STEPS',stepsContext)),[60,20,15,10,5]);
 assert.deepEqual([60,20,15,10,5].map(stepsContext.lsSubwayIndex),[0,1,2,3,4]);
 assert.match(html,/id="lsSubwayMax" min="0" max="4" step="1" value="0"/);
 assert.match(html,/id="lsSubwaySteps"[^>]*><span class="on">전체<\/span><span>20분<\/span><span>15분<\/span><span>10분<\/span><span>5분<\/span>/);
});

test('매물 정보에는 세대수 다음에 지하철 분을 표시하고 누락값은 감춘다',()=>{
 const start=html.indexOf('function listingSubwayHTML('),end=html.indexOf('// 여러 구가 섞인 결과',start);
 const c=vm.createContext({Number,esc:value=>String(value)});
 vm.runInContext(html.slice(start,end),c);
 assert.equal(c.listingSubwayHTML({subwayMinutes:10}),'<br><span class="listing-subway-badge"><span>지하철</span> <strong>10분</strong></span>');
 assert.equal(c.listingSubwayHTML({}), '');
 assert.equal(c.listingSubwayHTML({subwayMinutes:'-'}), '');
 const infoStart=html.indexOf('function listingInfoHTML('),infoEnd=html.indexOf('\nfunction ',infoStart+10);
 const infoTemplate=html.slice(infoStart,infoEnd);
 assert.ok(infoTemplate.indexOf('세대')<infoTemplate.lastIndexOf('listingSubwayHTML(x)'));
});

test('금액대별 공유 링크는 선택한 지하철 제한을 저장하고 기본 전체값은 생략한다',()=>{
 const start=html.indexOf('function buildShareURL('),end=html.indexOf('async function initFromURL(',start);
 const c=vm.createContext({URLSearchParams,LS_SUBWAY_ALL:60,location:{pathname:'/',search:''},lsActive:()=>false,lsRateActive:()=>false,lsAskLimits:()=>({min:0,max:50}),isListingMode:()=>true});
 vm.runInContext(html.slice(start,end),c);
 const base={mode:'listingbudget',mN:'12',fM:'0',lawd:'11680',ls:{sw:20}};
 assert.equal(new URL('https://example.com'+c.buildShareURL(base)).searchParams.get('lsw'),'20');
 assert.equal(new URL('https://example.com'+c.buildShareURL({...base,ls:{sw:60}})).searchParams.has('lsw'),false);
 assert.equal(new URL('https://example.com'+c.buildShareURL({...base,ls:{sw:20}})).searchParams.get('lsw'),'20');
});

test('관심 단지 실매물에도 세대수 뒤에 지하철 거리를 붙인다',()=>{
 const start=html.indexOf('function renderListingFavorites('),end=html.indexOf('\nlet listingFloorScope',start);
 const render=html.slice(start,end);
 assert.match(render,/listingInfoHTML\(x,false,true\)/);
});
