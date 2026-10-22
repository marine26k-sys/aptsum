import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){const c=vm.createContext({esc:x=>String(x??''),lastData:null});vm.runInContext(html.slice(html.indexOf('function segmentHitsLabelBox('),html.indexOf('let selPy =')),c);return c;}
function fixture(){return Array.from({length:36},(_,i)=>({ym:`${24+Math.floor(i/12)}.${String(i%12+1).padStart(2,'0')}`,avg:i===5?7:i===30?12:8+i/20,n:2}));}
test('monthly chart retains every point but labels latest, extrema and three-month intervals only',()=>{
 const c=setup(),months=fixture();const svg=c.chartSVG(months,'34평',{},'매매가',84);
 const labels=[...svg.matchAll(/class="chart-price-label" data-month="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(labels.length,13);for(const i of [5,30,35])assert.ok(labels.includes(months[i].ym));
 for(const ym of labels){const i=months.findIndex(m=>m.ym===ym);assert.ok([5,30,35].includes(i)||(35-i)%3===0);}
 assert.equal(c.curChart.monthly.length,36);assert.equal(c.curChart.xs.length,36);assert.match(svg,/onclick="chartClick\(event\)"/);assert.doesNotMatch(svg,/NaN|undefined/);
});
test('carried months omit ordinary repeated labels and keep latest and tooltip details',()=>{
 const c=setup(),months=fixture();months[32]={...months[32],avg:months[31].avg,n:0,carriedFrom:months[31].ym};months[35]={...months[35],avg:months[34].avg,n:0,carriedFrom:months[34].ym};
 const svg=c.chartSVG(months,'34평',{},'매매가',84);
 assert.ok(!svg.includes(`data-month="${months[32].ym}"`));assert.ok(svg.includes(`data-month="${months[35].ym}"`));
 assert.match(c.curChart.tipFor(months[35]),/거래 0건/);assert.match(c.curChart.tipFor(months[35]),/평균가 유지/);
});
test('price labels choose positions that do not cross the chart line',()=>{
 const c=setup();
 const line=[{cx:0,cy:80},{cx:20,cy:60},{cx:40,cy:25},{cx:60,cy:45}];
 const positions=[{dx:0,dy:-11},{dx:14,dy:-11},{dx:-14,dy:-11},{dx:0,dy:16},{dx:14,dy:16},{dx:-14,dy:16},{dx:0,dy:-20},{dx:0,dy:25}];
 const labels=[{cx:20,cy:60,offsets:positions},{cx:40,cy:25,offsets:positions}];
 c.placeLabels(labels,[-11,16,-20,25],22,12,line);
 for(const p of labels){
   const x=p.cx+p.dx,y=p.cy+p.dy,box={x1:x-11,x2:x+11,y1:y-12,y2:y+2};
   assert.equal(line.some((q,i)=>i&&c.segmentHitsLabelBox(line[i-1],q,box)),false);
   assert.ok(Math.abs(p.dy)<=25);
 }
});
test('latest and nearby highest labels remain separated at the chart edge',()=>{
 const c=setup();
 const months=Array.from({length:36},(_,i)=>({ym:`${24+Math.floor(i/12)}.${String(i%12+1).padStart(2,'0')}`,avg:i===33?10.9:i===35?10.9:8+i/20,n:2}));
 const svg=c.chartSVG(months,'34평',{},'매매가',84);
 const labels=[...svg.matchAll(/<text class="chart-price-label" data-month="([^"]+)" x="([^"]+)" y="([^"]+)"/g)].map(m=>({ym:m[1],x:Number(m[2]),y:Number(m[3])}));
 const max=labels.find(l=>l.ym===months[33].ym), latest=labels.find(l=>l.ym===months[35].ym);
 assert.ok(max&&latest);
 assert.ok(Math.abs(max.x-latest.x)>=20 || Math.abs(max.y-latest.y)>=11);
});
