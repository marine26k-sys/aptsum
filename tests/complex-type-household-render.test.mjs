import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

function context(){
 const c=vm.createContext({
  complexTypeHouseholdData:{'74':[{type:'100A',households:175},{type:'100B',households:175}]},
  complexTradeTypeData:{'74.91':['100A','100A, 100B','100B']},
  Number,Map,Set,esc:String,selPy:-1,tradesShown:100,SALE_TRADES_FOOT:'거래 기준',
  complexPyLabel:p=>p.py,complexRowGroupKey:p=>p.groupKey||String(p.sizeKey),isNewlyCollectedDeal:()=>false,
 });
 const typeStart=html.indexOf('function exactExclusiveKey(');
 const typeEnd=html.indexOf('function pyTableHTML(',typeStart);
 vm.runInContext(html.slice(typeStart,typeEnd),c);
 const groupStart=html.indexOf('function exclusiveAreaKey(');
 const groupEnd=html.indexOf('function complexRowGroupKey(',groupStart);
 vm.runInContext(html.slice(groupStart,groupEnd),c);
 const tradeStart=html.indexOf('function tradesHTML(');
 const tradeEnd=html.indexOf('function showMoreTrades(',tradeStart);
 vm.runInContext(html.slice(tradeStart,tradeEnd),c);
 return c;
}

test('개별 타입이 있는 평형에서 결합 타입 표기는 중복으로 추가하지 않는다',()=>{
 const c=context();
 assert.equal(c.typeHouseholdCell({sizeKey:74}),'<div>74A · <b>175세대</b></div><div>74B · <b>175세대</b></div>');
 assert.deepEqual(Array.from(c.tradeTypesForArea(74.91)),['100A','100B']);
});

test('타입 미확인 요약표에는 전용면적 숫자만 표시한다',()=>{
 const c=context();
 c.complexTypeHouseholdData=null;
 c.complexTradeTypeData=null;
 assert.equal(c.typeHouseholdCell({sizeKey:12}),'<div>12</div>');
});

test('KB 공급평을 타입명으로 대체하지 않고 전용면적 정수와 세대수를 표시한다',()=>{
 const c=context();
 c.complexTypeHouseholdData={'47':[{type:'KB:19',kbTypeName:'19',siteTypeMatched:false,households:75,supplyAreaFloor:63,supplyPyeong:19}]};
 c.complexTradeTypeData=null;
 assert.equal(c.typeHouseholdCell({sizeKey:47,supplyAreaFloor:63,supplyAreaFloors:[63]}),'<div>47 · <b>75세대</b></div>');
});

test('상세 거래내역은 타입이 있으면 타입만, 없으면 전용면적만 표시한다',()=>{
 const c=context();
 const data={byPy:[{sizeKey:84,py:34,max:5.8}],trades:[{date:'26.09.23',py:'34평',sizeKey:84,area:84.99,amt:5.8,floor:1}]};
 const htmlWithoutType=c.tradesHTML(data);
 assert.match(htmlWithoutType,/<td>85<\/td>/);
 assert.doesNotMatch(htmlWithoutType,/84\.99/);
 c.complexTradeTypeData={'84.99':['112A']};
 const htmlWithType=c.tradesHTML(data);
 assert.match(htmlWithType,/<td>84A<\/td>/);
 assert.doesNotMatch(htmlWithType,/84\.99/);
});

function loadComplex(c, lawd, key){
 const {items,exactExclusiveTypes}=JSON.parse(readFileSync(new URL(`../data/complex-type-households/${lawd}.json`,import.meta.url),'utf8'));
 c.complexTypeHouseholdData=items[key];
 c.complexTradeTypeData=exactExclusiveTypes[key];
}

function typeCellForTrade(c, area){
 const sizeKey=Math.floor(area);
 const supplyAreaFloor=c.complexSupplyAreaFloorForTrade({area});
 return c.typeHouseholdCell({sizeKey,supplyAreaFloor,supplyAreaFloors:c.complexSupplyAreaFloorGroup(sizeKey,supplyAreaFloor)});
}

test('신림더루나의 확인된 네이버 타입과 세대수는 KB 자료를 다시 생성해도 유지한다',()=>{
 const c=context();
 loadComplex(c,'11620','신림더루나|신림동');
 assert.deepEqual(Array.from(c.tradeTypesForArea(25.92)),['37B']);
 assert.equal(typeCellForTrade(c,25.92),'<div>25A · <b>9세대</b></div><div>25B · <b>9세대</b></div>');
 loadComplex(c,'HS-동탄구','동탄숲속마을모아미래도2단지|능동');
 assert.deepEqual(Array.from(c.tradeTypesForArea(142.09)),['194']);
});

test('미확인 타입과 복구한 타입 모두 전용면적에 맞는 공급 그룹과 세대수를 표시한다',()=>{
 const c=context();
 loadComplex(c,'41630','신우|덕계동');
 assert.equal(c.complexAreaGroupKey({area:59.91}),'59|81');
 assert.equal(typeCellForTrade(c,59.91),'<div>59 · <b>195세대</b></div>');
 assert.equal(typeCellForTrade(c,59.79),'<div>59 · <b>2세대</b></div>');
 assert.equal(c.complexAreaGroupKey({area:59.85}),'59');

 loadComplex(c,'41220','아이웰|지산동');
 assert.equal(c.complexAreaGroupKey({area:84.8975}),'84|99');
 assert.equal(typeCellForTrade(c,84.8975),'<div>84A · <b>10세대</b></div><div>84B · <b>9세대</b></div><div>84C · <b>9세대</b></div>');
 assert.equal(typeCellForTrade(c,84.79),'<div>84 · <b>1세대</b></div>');
});

test('미확인 타입의 표시가 같은 공급 그룹에서는 세대수를 한 줄로 합산한다',()=>{
 const c=context();
 loadComplex(c,'11500','블루힐|화곡동');
 assert.equal(typeCellForTrade(c,12.18),'<div>12 · <b>17세대</b></div>');
});

test('정확히 일치하는 KB 전용면적이 여러 공급 그룹에 있으면 거래를 미분류 상태로 둔다',()=>{
 const c=context();
 c.complexTypeHouseholdData={'59':[
  {type:'KB:22',siteTypeMatched:false,supplyAreaFloor:74,exclusiveAreas:['59.91']},
  {type:'KB:24',siteTypeMatched:false,supplyAreaFloor:81,exclusiveAreas:['59.91']},
 ]};
 c.complexTradeTypeData=null;
 assert.equal(c.complexAreaGroupKey({area:59.91}),'59');
});
