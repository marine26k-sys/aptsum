import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const c=vm.createContext({matchComplex:all=>({hits:all}),naverNameOf:()=>null,markOutliers:a=>a,exclusiveAreaKey:t=>Math.floor(t.area),representativePy:()=>34,avgA:a=>a.reduce((s,t)=>s+t.amt,0)/a.length,R1:n=>Math.round(n*10)/10,ymLabel:s=>s.slice(2,4)+'.'+s.slice(4),yearsLabel:()=>'',esc:s=>String(s??'').replace(/[<>&"]/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[x])),complexBuildLabel:y=>y+'년',formatWalkDisplay:x=>x,CMP_COLORS:['teal','red'],cmpPyMap:{0:84,1:84}});
 vm.runInContext(html.slice(html.indexOf('function calendarMonths('),html.indexOf('function analyzeComplex(')),c);
 vm.runInContext(html.slice(html.indexOf('function analyzeCompare('),html.indexOf('function esc(')),c);
 vm.runInContext(html.slice(html.indexOf('function compareSummaryHTML('),html.indexOf('function drawCompare(')),c);
 return c;
}
test('comparison statistics use the selected exclusive area and actual contract chronology',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84.99,py:34,build:'2020',floor:12};
 const data=[{...base,ym:'202610',d:1,amt:19},{...base,ym:'202610',d:15,amt:20},{...base,ym:'202609',d:2,amt:18},{...base,ym:'202606',d:3,amt:16},{...base,area:59.9,ym:'202610',d:16,amt:9}];
 const result=c.analyzeCompare({'11111':data},[{lawd:'11111',name:'가상단지'}],['202610','202609','202608','202607','202606','202605']);
 const p=result.complexes[0].pys.find(p=>p.area===84);
 assert.equal(p.latest.price,20);assert.equal(p.latest.day,15);assert.equal(p.high.price,20);assert.equal(p.low.price,16);assert.equal(p.avg3.v,17.8);assert.equal(p.avg3.n,3);assert.equal(p.prev3,null);assert.equal(p.n,4);assert.equal(p.median,18.5);
});
test('summary renders side-by-side fields, exact school details and missing values safely',()=>{
 const c=setup();const a={name:'가상<A>',umd:'가상동',count:4,build:'2020',hh:{hhcnt:1000,far:250,bcr:20,dongCnt:10,subwayWalk:'10분이내'},schoolInfo:{schools:[{name:'가상초',level:'초',distance:123,type:'공립'}]},pys:[{area:84,py:'34평',n:4,avg3:{v:19,n:3},max:20,latest:{price:20,ym:'202610',day:15,floor:12}}]};
 const b={name:'가상B',pys:[],count:0};const result=c.compareSummaryHTML({complexes:[a,b],period:'26.05 ~ 26.10'});
 assert.match(result,/<table/);assert.equal((result.match(/scope="row"/g)||[]).length,17);assert.match(result,/scope="col"/);assert.match(result,/가상&lt;A&gt;/);assert.match(result,/건폐율[^]*20%/);assert.doesNotMatch(result,/가상초|초등학교|중학교|고등학교/);assert.doesNotMatch(result,/지하철 도보/);assert.match(result,/<td>—<\/td>/);assert.doesNotMatch(result,/NaN|undefined|Infinity/);
 c.cmpPyMap[0]=59;assert.doesNotMatch(c.compareSummaryHTML({complexes:[a,b]}),/20.0억/);
});

test('latest comparison trade requires floor three or higher and excludes direct sales even on raw fallback',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84,py:34,ym:'202610',amt:10};
 c.markOutliers=()=>[];
 const records=[{...base,d:1,floor:3,direct:0},{...base,d:2,floor:2,direct:0},{...base,d:3,floor:12,direct:1},{...base,d:4,floor:null,direct:0}];
 const analyze=items=>c.analyzeCompare({'11111':items},[{lawd:'11111',name:'가상단지'}],['202610']).complexes[0].pys[0];
 const p=analyze(records);assert.equal(p.latest.day,1);assert.equal(p.latest.floor,3);assert.equal(analyze(records.slice(1)).latest,null);
});

test('all comparison averages and monthly graph points use the existing outlier rule without raw fallback',()=>{
 const c=setup();c.median=a=>{const s=a.slice().sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
 vm.runInContext(html.slice(html.indexOf('function markOutliers('),html.indexOf('// ── 층별 가격 프리미엄',html.indexOf('function markOutliers('))),c);
 const base={apt:'가상단지',umd:'가상동',area:84,py:34,ym:'202610',floor:12,direct:0};
 const analyze=items=>c.analyzeCompare({'11111':items},[{lawd:'11111',name:'가상단지'}],['202610','202609','202608','202607','202606','202605','202604','202603','202602','202601','202512','202511']).complexes[0].pys[0];
 const p=analyze([12,13,14,5].map((amt,i)=>({...base,amt,d:i+1})).concat({...base,amt:50,d:5,direct:1}));
 assert.equal(p.avg1.v,13);assert.equal(p.avg1.n,3);for(const key of ['avg3','avg6','avg12','avg24'])assert.equal(p[key],null);
 assert.equal(p.monthly[0].avg,13);assert.equal(p.monthly[0].n,3);assert.equal(p.avgAll,null);
 const none=analyze([{...base,amt:50,d:1,direct:1}]);for(const key of ['avg1','avg3','avg6','avg12','avg24','avgAll'])assert.equal(none[key],null);assert.equal(none.monthly.length,0);
});

test('recent averages use calendar months, carry missing months and weight months equally independently of chart window',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84,py:34,floor:12,direct:0};
 const records=[['202610',19,30],['202609',19,10],['202609',18,20],['202607',21,40],['202607',20,50],['202604',22,60],['202604',21,70],['202510',19,80],['202510',18,90],['202410',1,5],['202610',20,999]].map(([ym,d,amt])=>({...base,ym,d,amt}));
 const result=c.analyzeCompare({'11111':records},[{lawd:'11111',name:'가상단지'}],['202610'],Date.parse('2026-10-18T15:30:00Z')).complexes[0].pys[0];
 for(const [key,price,n] of [['avg1',30,1],['avg3',30,3],['avg6',44.2,5],['avg12',62.9,7],['avg24',37.3,9]]){assert.equal(result[key].v,price,key);assert.equal(result[key].n,n,key);}
 assert.equal(result.monthly.length,1);assert.equal(result.monthly[0].avg,30);assert.equal(result.monthly[0].n,1);
});

test('short-term trend compares consecutive calendar quarters at floor five and above with carry-forward',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84,py:34,floor:5,direct:0};
 const records=[{...base,ym:'202604',d:1,amt:10},{...base,ym:'202610',d:1,amt:20},{...base,ym:'202607',d:21,amt:20},{...base,ym:'202607',d:20,amt:10},{...base,ym:'202606',d:1,amt:10},{...base,ym:'202609',d:1,amt:100,floor:4}];
 const get=items=>c.analyzeCompare({'11111':items},[{lawd:'11111',name:'가상단지'}],['202610','202609','202608','202607','202606'],Date.parse('2026-10-19T00:00:00Z')).complexes[0].pys[0];
 const trend=get(records).trend;assert.equal(trend.prevAvg,11.7);assert.equal(trend.recentAvg,16.7);assert.equal(trend.pct,43);assert.equal(trend.prevN,3);assert.equal(trend.recentN,1);
 assert.equal(get(records.filter(t=>t.ym!=='202604'&&t.ym!=='202606'&&!(t.ym==='202607'&&t.d===20))).trend,null);
});

test('comparison summary shows current price then ordered period changes without trend or period averages',()=>{
 const c=setup(),result=c.compareSummaryHTML({complexes:[{name:'가상단지',pys:[{area:84,currentPrice:{v:12,n:0,ym:"202610"},changes:{m1:{basePrice:10,from:"202609",amount:2,pct:20},m3:{basePrice:13,from:"202607",amount:-1,pct:-7.7},ytd:{basePrice:12,from:"202512",amount:0,pct:0}}}]}]});
 assert.match(result,/최근 시세/);assert.match(result,/scope="row">1개월<br>[^]*?\(26.09\)/);assert.match(result,/10.0억/);assert.match(result,/▲2.0억 \(20%\)/);assert.match(result,/▼1.0억 \(8%\)/);assert.match(result,/0.0억 \(0%\)/);
 assert.doesNotMatch(result,/최근 거래|단기 추세|개월 평균|조회 기간 최고가/);assert.match(result,/class="cmp-current-row"><th scope="row">최근 시세<br>[^]*?\(26.10\)/);
 const labels=[...result.matchAll(/scope="row">([^<]+)/g)].map(m=>m[1]);assert.deepEqual(labels.slice(-11),['최근 3년 최고가','최근 시세','1개월','3개월','6개월','YTD','1년','2년','3년','4년','5년']);
});
test('comparison changes use the current calendar month and exact prior months including December YTD',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84,py:34,floor:10,direct:0,d:1};
 const records=[['202109',3],['202110',4],['202209',4],['202309',5],['202310',6],['202410',8],['202510',10],['202512',12],['202604',15],['202607',16],['202609',18]].map(([ym,amt])=>({...base,ym,amt}));
 const p=c.analyzeCompare({'11111':records},[{lawd:'11111',name:'가상단지'}],['202610','202609'],Date.parse('2026-10-20T00:00:00Z')).complexes[0].pys[0];
 assert.equal(p.currentPrice.v,18);assert.equal(p.currentPrice.n,0);
 for(const [key,amount,pct,from] of [['m1',0,0,'202609'],['m3',2,12.5,'202607'],['m6',3,20,'202604'],['ytd',6,50,'202512'],['y1',8,80,'202510'],['y2',10,125,'202410'],['y3',12,200,'202310'],['y4',14,350,'202210'],['y5',14,350,'202110']]){
 assert.equal(p.changes[key].basePrice,18-amount,key);assert.equal(p.changes[key].amount,amount,key);assert.equal(p.changes[key].pct,pct,key);assert.equal(p.changes[key].from,from,key);}
});

test('comparison region includes city, district and neighborhood without subway row',()=>{
 const c=setup();c.REGIONS=[['경기',[['안양 동안구','41173']]],['서울',[['마포구','11440']]]];
 const result=c.compareSummaryHTML({complexes:[{name:'가상A',lawd:'41173',umd:'비산동',pys:[]},{name:'가상B',lawd:'11440',umd:'아현동',pys:[]}]});
 assert.match(result,/scope="row">지역/);assert.match(result,/안양시 동안구 비산동/);assert.match(result,/서울시 마포구 아현동/);assert.doesNotMatch(result,/법정동|지하철/);
});

test('three-year high uses actual eligible trades independently of graph query period',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84,py:34,floor:10,direct:0,d:1};
 const records=[['202310',50],['202311',22],['202609',18],['202610',20]].map(([ym,amt])=>({...base,ym,amt}));
 records.push({...base,ym:'202609',amt:99,direct:1});
 const p=c.analyzeCompare({'11111':records},[{lawd:'11111',name:'가상단지'}],['202610'],Date.parse('2026-10-20T00:00:00Z')).complexes[0].pys[0];
 assert.equal(p.high3.price,22);assert.equal(p.high3.ym,'202311');assert.equal(p.high.price,20);assert.equal(p.currentPrice.ym,'202610');
});

test('common dates stay in row headings even when a selected complex lacks that period price',()=>{
 const c=setup(),result=c.compareSummaryHTML({asOfYm:'202610',complexes:[{name:'가상A',pys:[]},{name:'가상B',pys:[{area:84,currentPrice:{v:12,ym:'202610'},changes:{m1:{basePrice:12,from:'202609',amount:0,pct:0}}}]}]});
 const rows=[...result.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);
 for(const [label,date] of [['최근 시세','26.10'],['1개월','26.09'],['3개월','26.07'],['YTD','25.12'],['5년','21.10']]){
  const row=rows.find(r=>r.includes('scope="row">'+label+'<br>'));assert.ok(row);assert.ok(row.split('</th>')[0].includes(date));assert.ok(!row.split('</th>')[1].includes(date));
 }
 assert.match(result,/<tr class="cmp-current-row">/);
});
