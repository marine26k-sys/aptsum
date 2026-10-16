import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function completeJeonseSizeRows('),html.indexOf('function curComplexData(')),c);
const size=k=>({sizeKey:k,py:k===41?'18평':'24평',n:2,max:9,quarters:[1,2,3,4].map(label=>({label,avg:{v:8,n:2}})),monthly:[{avg:8}]});
test('매매만 있는 평형도 전세 목록에 표시하되 가격을 복사하지 않는다',()=>{
 const sale={byPy:[size(41),size(59)],jeonse:{byPy:[size(59)],trades:[{amt:5}],count:1}};
 const out=c.completeJeonseSizeRows(sale),missing=out.byPy.find(x=>x.sizeKey===41);
 assert.equal(out.byPy.length,2);assert.equal(missing.max,null);assert.equal(missing.n,0);assert.equal(missing.noTradeLabel,'전세 거래 없음');assert.ok(missing.quarters.every(x=>x.avg===null));assert.equal(missing.monthly.length,0);
 assert.equal(sale.jeonse.byPy.length,1);assert.equal(out.trades[0].amt,5);
});
test('전세 전체가 없어도 확인된 매매 평형을 표시하며 이미 제외된 평형은 추가하지 않는다',()=>{
 const out=c.completeJeonseSizeRows({byPy:[size(41),{...size(59),rentOnly:true}],jeonse:null});assert.equal(out.byPy.length,1);assert.equal(out.count,0);assert.equal(out.trades.length,0);
});
