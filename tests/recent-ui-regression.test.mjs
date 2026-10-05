import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('price-band current average includes 90 days while other rise tabs keep 30 days',()=>{
 const now=new Date(2026,9,3).getTime();class FixedDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const ctx=vm.createContext({Date:FixedDate,markOutliers:a=>a,avgA:a=>a.reduce((n,t)=>n+t.amt,0)/a.length,R1:n=>Math.round(n*10)/10});
 vm.runInContext(html.slice(html.indexOf('function analyzeLongTermRise('),html.indexOf('// ═══ 전세 변동률')),ctx);
 const rows=[['202609',20,10],['202608',15,14],['202607',10,18],['202609',1,22],['202510',18,8]].map(([ym,d,amt])=>({apt:'단지',umd:'동',py:25,gu:'구',area:59,ym,d,amt}));
 assert.equal(ctx.analyzePriceBandRise(rows,[],12,16,'current').rows[0].recentAvg,16);
 assert.equal(ctx.analyzeLongTermRise(rows,[],12,true).rows[0].recentAvg,10);
});
test('chart month selectors calculate amount and rate and constrain endpoint order',()=>{
 const options=Array.from({length:4},(_,i)=>({value:String(i),disabled:false}));
 const shade={attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
 const nodes={chartRangeStart:{value:'2',options:structuredClone(options)},chartRangeEnd:{value:'3',options:structuredClone(options)},chartRangeResult:{},chartRangeShade:shade};
 const ctx=vm.createContext({document:{getElementById:id=>nodes[id]},curChart:{monthly:[{ym:'24.02',avg:6},{ym:'24.03',avg:7},{ym:'24.04',avg:8},{ym:'24.05',avg:10}],xs:[10,40,70,100]},esc:x=>x,hideTip(){}});
 vm.runInContext(html.slice(html.indexOf('function updateChartRange('),html.indexOf('function chartClick(')),ctx);
 ctx.updateChartRange('start');
 assert.match(nodes.chartRangeResult.innerHTML,/24.04 → 24.05/);
 assert.match(nodes.chartRangeResult.innerHTML,/\+2\.0억/);
 assert.match(nodes.chartRangeResult.innerHTML,/\+25\.0%/);
 assert.equal(shade.attrs.x,70);assert.equal(shade.attrs.width,30);
 assert.equal(nodes.chartRangeStart.options[3].disabled,true);
 assert.equal(nodes.chartRangeEnd.options[2].disabled,true);
 nodes.chartRangeEnd.value='2';ctx.updateChartRange('end');
 assert.equal(nodes.chartRangeStart.value,'1');assert.equal(nodes.chartRangeEnd.value,'2');
 assert.match(nodes.chartRangeResult.innerHTML,/24.03 → 24.04/);
});
test('price slider bounds adjust to region and include exact upper boundary',()=>{
 const nodes={lsAskMin:{min:0,max:50,value:0},lsAskMax:{min:0,max:50,value:49}};const ctx=vm.createContext({document:{getElementById:id=>nodes[id]},lsHhBase:()=>300,lsSync(){}});
 vm.runInContext(html.slice(html.indexOf('function lsAskLimits('),html.indexOf('function lsPyActive(')),ctx);ctx.lsAskBounds([{ask:12,hh:400},{ask:17.3,hh:500}]);assert.equal(+nodes.lsAskMax.value,17.5);assert.equal(ctx.lsAskMatch({ask:14},{q0:12,q1:14}),true);assert.equal(ctx.lsAskMatch({ask:14.1},{q0:12,q1:14}),false);
});
