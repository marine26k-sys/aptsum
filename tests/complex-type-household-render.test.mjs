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

test('KB 공급면적 정수 차이 1~2㎡는 같은 평형, 3㎡부터 별도 평형으로 묶는다',()=>{
 const c=context();
 loadComplex(c,'41173','평촌엘프라우드|비산동');
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorClusters(59))),[[81,82]]);
 assert.equal(c.complexAreaGroupKey({area:59.76}),'59|81');
 assert.equal(c.complexAreaGroupKey({area:59.97}),'59|81');
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorGroup(59,82))),[81,82]);
 const typeCell=typeCellForTrade(c,59.76);
 for(const [type,households] of [['59A',306],['59B',498],['59C',233],['59D',322]])assert.ok(typeCell.includes(`${type} · <b>${households}세대</b>`));
 c.complexTypeHouseholdData={'59':[
  {supplyAreaFloor:81,supplyPyeong:24},
  {supplyAreaFloor:83,supplyPyeong:25},
  {supplyAreaFloor:84,supplyPyeong:25},
 ]};
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorClusters(59))),[[81,83],[84]]);
});

test('공급면적이 1~2㎡ 차이라도 다른 전용면적 타입을 끌어 합치지 않는다',()=>{
 const c=context();
 c.complexTypeHouseholdData={'70':[
  {type:'93D',households:33,supplyAreaFloor:93,supplyPyeong:28,exclusiveAreas:['70.06']},
  {type:'94C',households:16,supplyAreaFloor:94,supplyPyeong:28,exclusiveAreas:['70.06']},
  {type:'99A',households:17,supplyAreaFloor:99,supplyPyeong:30,exclusiveAreas:['70.06']},
  {type:'99B',households:19,supplyAreaFloor:99,supplyPyeong:30,exclusiveAreas:['70.06']},
  {type:'101E',households:72,supplyAreaFloor:101,supplyPyeong:30,exclusiveAreas:['70']},
  {type:'102F',households:71,supplyAreaFloor:102,supplyPyeong:31,exclusiveAreas:['70.01']},
 ]};
 c.complexTradeTypeData=null;
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorClusters(70))),[[93,94,99],[101,102]]);
 assert.equal(c.complexAreaGroupKey({area:70.06}),'70|93');
 assert.equal(c.complexAreaGroupKey({area:70}),'70|101');
 assert.equal(c.complexAreaGroupKey({area:70.01}),'70|101');
});

test('같은 동·세대수·준공연도가 확인된 마을 이름 변형도 KB 타입을 연결한다',()=>{
 const c=context();
 loadComplex(c,'41173','향촌마을현대4차|평촌동');
 assert.equal(typeCellForTrade(c,59.94),'<div>59 · <b>188세대</b></div>');
 assert.equal(typeCellForTrade(c,84.99),'<div>84 · <b>364세대</b></div>');
 loadComplex(c,'41135','청솔마을주공9단지|금곡동');
 assert.ok(Object.keys(c.complexTypeHouseholdData).length>0);
});

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

test('전용면적 소수점 값이 같으면 KB 공급면적 차이가 커도 거래를 한 번만 묶는다',()=>{
 const c=context();
 c.complexTypeHouseholdData={'59':[
  {type:'KB:22',siteTypeMatched:false,supplyAreaFloor:74,exclusiveAreas:['59.91']},
  {type:'KB:24',siteTypeMatched:false,supplyAreaFloor:81,exclusiveAreas:['59.91']},
 ]};
 c.complexTradeTypeData=null;
 assert.equal(c.complexAreaGroupKey({area:59.91}),'59|74');
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorClusters(59))),[[74,81]]);
});

test('확인된 KB 타입도 전용면적이 정확히 같으면 공급면적별로 거래를 나누지 않는다',()=>{
 const c=context();
 loadComplex(c,'41250','지행주공2단지|지행동');
 assert.deepEqual(Array.from(c.tradeTypesForArea(59.99)),['77B','82A']);
 assert.equal(c.complexAreaGroupKey({area:59.99}),'59|77');
});

test('봉천동 두산의 전용 114.99㎡ 거래를 KB 43·48평 공통 그룹으로 연결한다',()=>{
 const c=context();
 loadComplex(c,'11620','두산|봉천동');
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorClusters(114))),[[143,159]]);
 assert.equal(c.complexAreaGroupKey({area:114.99}),'114|143');
 const label=typeCellForTrade(c,114.99);
 assert.ok(label.includes('114 · <b>510세대</b>'));
 const start=html.indexOf('function complexPyLabel('),end=html.indexOf('let complexTypeHouseholdData=',start);
 vm.runInContext(html.slice(start,end),c);
 assert.equal(c.complexPyLabel({sizeKey:114,supplyAreaFloor:143,supplyAreaFloors:[143,159],py:'44평'}),'43·48평');
 c.complexTypeHouseholdData={'114':[
  {type:'143',supplyAreaFloor:143,exclusiveAreas:['114.99']},
  {type:'159',supplyAreaFloor:159,exclusiveAreas:['114.991']},
 ]};
 c.complexTradeTypeData=null;
 assert.deepEqual(JSON.parse(JSON.stringify(c.complexSupplyAreaFloorClusters(114))),[[143],[159]]);
});

test('KB 면적 ID가 다른 금천롯데캐슬골드파크3차 전용 59 네 타입을 모두 보존한다',()=>{
 const shard=JSON.parse(readFileSync(new URL('../data/complex-type-households/11545.json',import.meta.url),'utf8'));
 const rows=shard.items['금천롯데캐슬골드파크3차|독산동']['59'];
 assert.deepEqual(rows.map(row=>[row.type,row.kbAreaId,row.households]),[
  ['84B',29500,232],['84B-1',75882,264],['85A',142889,186],['85A-1',114007,60],
 ]);
 assert.deepEqual(shard.exactExclusiveTypes['금천롯데캐슬골드파크3차|독산동']['59.96'],
  ['84B','84B-1','85A','85A-1']);
});

test('KB 공급 그룹을 확인할 수 없는 거래는 기존 평형 행을 합치지 않고 거래내역에 표시한다',()=>{
 const c=context();
 loadComplex(c,'11440','힐스테이트마포더퍼스트|신수동');
 c.complexTypeHouseholdKey='11440|신수동|힐스테이트마포더퍼스트';
 c.complexPySortKey=p=>Number(String(p.py).match(/\d+/)?.[0]||0);
 const labelStart=html.indexOf('function complexPyLabel('),labelEnd=html.indexOf('let complexTypeHouseholdData=',labelStart);
 vm.runInContext(html.slice(labelStart,labelEnd),c);
 const start=html.indexOf('function includeKBTypeAreas('),end=html.indexOf('function analyzeRegion(',start);
 vm.runInContext(html.slice(start,end),c);
 const trade={area:84.98,sizeKey:84,groupKey:'84',amt:20.9};
 const row={py:'34평',sizeKey:84,groupKey:'84',supplyAreaFloor:null,n:2,
   recent:{amt:20.9,ym:'26.09',day:'03'},max:20.9,monthly:[]};
 const result=c.includeKBTypeAreas({found:true,name:'힐스테이트마포더퍼스트',umd:'신수동',
   trades:[trade],byPy:[row]});
 const rows=result.byPy.filter(p=>p.sizeKey===84);
 assert.deepEqual(Array.from(rows,p=>c.complexPyLabel(p)),['32평','36평']);
 assert.equal(rows[0].max,null);
 assert.match(c.typeHouseholdCell(rows[0]),/84A · <b>106세대<\/b>/);
 assert.match(c.typeHouseholdCell(rows[1]),/84C · <b>51세대<\/b>/);
 const detail=c.tradesHTML(result);
 assert.match(detail,/<td>공급 미확인<\/td>/);
 assert.match(detail,/<td>84\.98㎡ · KB 타입 미확인<\/td>/);
});
