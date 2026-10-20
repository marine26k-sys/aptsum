import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const now=Date.parse('2026-10-19T15:30:00Z');
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const c=vm.createContext({Date:FixedDate,matchComplex:all=>({hits:all}),naverNameOf:()=>null,markOutliers:a=>a,exclusiveAreaKey:t=>Math.floor(t.area),representativePy:()=>34,avgA:a=>a.reduce((n,t)=>n+t.amt,0)/a.length,R1:n=>Math.round(n*10)/10,ymLabel:s=>s.slice(2,4)+'.'+s.slice(4),yearsLabel:()=>'',dkey:t=>`${t.ym}${t.d}`,complexTradeBuild:()=>2020});
 vm.runInContext(html.slice(html.indexOf('function calendarMonths('),html.indexOf('function analyzeComplex(')),c);
 vm.runInContext(html.slice(html.indexOf('function buildRepRows('),html.indexOf('// ═══ 단기 저평가')),c);
 return c;
}
const trade=(ym,amt,extra={})=>({apt:'가상단지',umd:'가상동',area:84.9,py:34,floor:10,ym,d:1,amt,...extra});
test('calendar windows cross years and use KST current month',()=>{
 const c=setup();assert.deepEqual(Array.from(c.calendarMonths(3,0,Date.parse('2025-12-31T15:01:00Z'))),['202601','202512','202511']);
});
test('period average has equal monthly weight, carries only older prices and counts actual trades',()=>{
 const c=setup(),records=[trade('202607',8),trade('202609',10),trade('202609',14),trade('202610',999,{direct:1}),trade('202610',999,{ex:'저가'})];
 assert.deepEqual(JSON.parse(JSON.stringify(c.monthlyPriceAverage(records,['202608','202609','202610']))),{v:10.7,n:2});
 assert.equal(c.monthlyPriceAverage(records,['202606','202607']),null);
 assert.deepEqual(JSON.parse(JSON.stringify(c.monthlyPriceAverage(records,['202610']))),{v:12,n:0});
});
test('rise ranking includes carried current-month prices with zero actual transactions',()=>{
 const c=setup(),r=c.analyzeLongTermRise([trade('202607',8),trade('202609',12)],['202610','202609','202608','202607'],3).rows[0];
 assert.equal(r.recentAvg,12);assert.equal(r.pastAvg,8);assert.equal(r.changeAmt,4);assert.equal(r.changePct,50);assert.equal(r.recentN,0);assert.equal(r.pastN,1);
});
test('short-term ranking uses same filled monthly prices without adding artificial trades',()=>{
 const c=setup(),r=c.buildRepRows([trade('202605',8),trade('202609',12)],['202610','202609','202608','202607','202606','202605'],3)[0];
 assert.equal(r.r3avg,10.7);assert.equal(r.p3avg,8);assert.equal(r.n,2);assert.equal(r.r3n,1);assert.equal(r.p3n,1);
});
test('gap ranking average can use an earlier seed while current period trade count remains zero',()=>{
 const c=setup(),r=Object.values(c.avgGroupA([trade('202607',8)],['202610','202609','202608'],2))[0];
 assert.equal(r.avg,8);assert.equal(r.n,0);
});
test('complex chart seeds from pre-window history but keeps selected-window actual statistics',()=>{
 const c=setup();c.floorBands=()=>null;
 vm.runInContext(html.slice(html.indexOf('function analyzeComplex('),html.indexOf('function analyzeRegion(')),c);
 const r=c.analyzeComplex([trade('202607',8),trade('202609',12)],'가상단지',['202610','202609','202608'],undefined,'11111');
 assert.equal(r.count,1);assert.equal(r.trades.length,1);assert.equal(r.byPy[0].max,12);
 assert.deepEqual(JSON.parse(JSON.stringify(r.byPy[0].monthly)),[{ym:'26.08',avg:8,n:0,carriedFrom:'26.07'},{ym:'26.09',avg:12,n:1},{ym:'26.10',avg:12,n:0,carriedFrom:'26.09'}]);
});

test('twelve months ago compares October 2025 with October 2026 exactly',()=>{
 const c=setup(),result=c.analyzeLongTermRise([trade('202509',7),trade('202510',8),trade('202511',99),trade('202609',11),trade('202610',12)],c.calendarMonths(14),12);
 assert.equal(result.pastPeriod,'25.10');assert.equal(result.recentPeriod,'26.10 ~ 26.10');assert.equal(result.rows[0].pastAvg,8);assert.equal(result.rows[0].recentAvg,12);assert.equal(result.rows[0].changePct,50);
});
test('floor premiums use the same monthly weighting and actual sample counts',()=>{
 const c=setup();vm.runInContext(html.slice(html.indexOf('function floorBands('),html.indexOf('// 사업 진행 중 개명된 단지')),c);
 const records=[...Array.from({length:6},()=>trade('202607',8,{floor:2})),...Array.from({length:2},()=>trade('202609',12,{floor:2})),...Array.from({length:2},()=>trade('202607',16,{floor:20})),...Array.from({length:2},()=>trade('202609',24,{floor:20}))];
 const r=c.floorBands(records,['202610','202609','202608','202607']);assert.equal(r.low.v,10);assert.equal(r.high.v,20);assert.equal(r.low.n,8);assert.equal(r.high.n,4);assert.equal(r.premiumPct,100);
});
test('area-price inversion can calculate current-month comparisons without current-month trades',()=>{
 const c=setup();c.SQM_PER_PY=3.3058;
 vm.runInContext(html.slice(html.indexOf('function analyzeInversion('),html.indexOf('function buildRepRows(')),c);
 const records=[trade('202603',10,{area:59,py:25}),trade('202603',12),trade('202609',18)];
 const r=c.analyzeInversion(records,c.calendarMonths(13)).rows[0];
 assert.ok(r);assert.equal(r.underAvgAmt,10);assert.equal(r.otherAvgAmt,18);assert.equal(r.lowPriorAmt,13);assert.equal(r.refPriorAmt,10);
});

test('inversion excludes candidates without an actual one-year high instead of showing infinite margins',()=>{
 const c=setup();c.SQM_PER_PY=3.3058;
 vm.runInContext(html.slice(html.indexOf('function analyzeInversion('),html.indexOf('function buildRepRows(')),c);
 const records=[trade('202503',10,{area:59,py:25}),trade('202503',12),trade('202609',18)];
 assert.equal(c.analyzeInversion(records,c.calendarMonths(25)).rows.length,0);
});
test('live refresh keeps pre-window seed months and the original floor filter',()=>{
 const c=setup();c.lastMonthsYm=n=>Array.from(c.calendarMonths(n));
 vm.runInContext(html.slice(html.indexOf('function complexRefreshCacheItems('),html.indexOf('async function tapComplexLiveRefresh(')),c);
 const cache={'11111':{'202610':{items:[trade('202610',10,{floor:2}),trade('202610',12,{floor:12})]},'202601':{items:[trade('202601',8)]}}};
 const records=c.complexRefreshCacheItems(cache,'11111',3,5);
 assert.equal(records.length,2);assert.ok(records.some(t=>t.ym==='202601'));assert.ok(records.every(t=>t.floor>=5));
});

test('complex keeps a historical-only size with carried prices and no fabricated current trades or high',()=>{
 const c=setup();c.floorBands=()=>null;
 vm.runInContext(html.slice(html.indexOf('function analyzeComplex('),html.indexOf('function analyzeRegion(')),c);
 const r=c.analyzeComplex([trade('202401',8)],'가상단지',c.calendarMonths(6),undefined,'11111');
 assert.equal(r.found,true);assert.equal(r.count,0);assert.equal(r.trades.length,0);
 const p=r.byPy[0];assert.equal(p.n,0);assert.equal(p.max,null);assert.equal(p.recent,null);assert.equal(p.isNewHigh,false);
 assert.equal(p.monthly.length,6);assert.ok(p.monthly.every(x=>x.avg===8&&x.n===0));
 assert.ok(p.quarters.every(x=>x.avg.v===8&&x.avg.n===0));assert.equal(p.trend.recentAvg,8);
});
test('complex retains an inactive size alongside an actively traded size',()=>{
 const c=setup();c.floorBands=()=>null;
 vm.runInContext(html.slice(html.indexOf('function analyzeComplex('),html.indexOf('function analyzeRegion(')),c);
 const r=c.analyzeComplex([trade('202610',12),trade('202401',8,{area:59,py:25})],'가상단지',c.calendarMonths(3),undefined,'11111');
 assert.equal(r.count,1);assert.equal(r.byPy.length,2);assert.equal(r.byPy.find(p=>p.sizeKey===59).n,0);
});
test('monthly tabs load a five-year history seed including the live refresh path',()=>{
 assert.match(html,/Math.max\(baseFetchMN,neededMN\+12,73\)/);
 const c=setup();c.lastMonthsYm=n=>Array.from(c.calendarMonths(n));
 vm.runInContext(html.slice(html.indexOf('function complexRefreshCacheItems('),html.indexOf('async function tapComplexLiveRefresh(')),c);
 assert.equal(c.complexRefreshCacheItems({'11111':{'202401':{items:[trade('202401',8)]}}},'11111',3).length,1);
});

test('complex change supports exact same-month comparisons at thirty-six, forty-eight and sixty months',()=>{
 const c=setup(),records=[trade('202110',6),trade('202210',7),trade('202310',8),trade('202609',12)];
 for(const [period,price,label] of [[36,8,'23.10'],[48,7,'22.10'],[60,6,'21.10']]){
  const result=c.analyzeLongTermRise(records,c.calendarMonths(73),period);
  assert.equal(result.pastPeriod,label);assert.equal(result.rows[0].pastAvg,price);assert.equal(result.rows[0].recentAvg,12);assert.equal(result.rows[0].recentN,0);
 }
 const select=html.slice(html.indexOf('<select id="risePeriodN"'),html.indexOf('</select>',html.indexOf('<select id="risePeriodN"')));
 for(const value of [36,48,60])assert.ok(select.includes(`value="${value}"`));
});
