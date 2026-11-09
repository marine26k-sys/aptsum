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
  complexPyLabel:p=>p.py,isNewlyCollectedDeal:()=>false,
 });
 const typeStart=html.indexOf('function exactExclusiveKey(');
 const typeEnd=html.indexOf('function pyTableHTML(',typeStart);
 vm.runInContext(html.slice(typeStart,typeEnd),c);
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

test('요약표 전용면적 숫자에는 제곱미터 단위를 붙이지 않는다',()=>{
 const c=context();
 c.complexTypeHouseholdData=null;
 c.complexTradeTypeData=null;
 assert.equal(c.typeHouseholdCell({sizeKey:12}),'<div>12</div>');
});

test('상세 거래내역에는 전용면적 대신 매칭된 타입만 표시한다',()=>{
 const c=context();
 const data={byPy:[{sizeKey:84,py:34,max:5.8}],trades:[{date:'26.09.23',py:'34평',sizeKey:84,area:84.99,amt:5.8,floor:1}]};
 const htmlWithoutType=c.tradesHTML(data);
 assert.match(htmlWithoutType,/<td>-<\/td>/);
 assert.doesNotMatch(htmlWithoutType,/84\.99/);
 c.complexTradeTypeData={'84.99':['112A']};
 const htmlWithType=c.tradesHTML(data);
 assert.match(htmlWithType,/<td>84A<\/td>/);
 assert.doesNotMatch(htmlWithType,/84\.99/);
});
