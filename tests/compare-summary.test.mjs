import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const c=vm.createContext({matchComplex:all=>({hits:all}),naverNameOf:()=>null,markOutliers:a=>a,exclusiveAreaKey:t=>Math.floor(t.area),representativePy:()=>34,avgA:a=>a.reduce((s,t)=>s+t.amt,0)/a.length,R1:n=>Math.round(n*10)/10,ymLabel:s=>s.slice(2,4)+'.'+s.slice(4),yearsLabel:()=>'',esc:s=>String(s??'').replace(/[<>&"]/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[x])),complexBuildLabel:y=>y+'년',formatWalkDisplay:x=>x,CMP_COLORS:['teal','red'],cmpPyMap:{0:84,1:84}});
 vm.runInContext(html.slice(html.indexOf('function analyzeCompare('),html.indexOf('function esc(')),c);
 vm.runInContext(html.slice(html.indexOf('function compareSummaryHTML('),html.indexOf('function drawCompare(')),c);
 return c;
}
test('comparison statistics use the selected exclusive area and actual contract chronology',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84.99,py:34,build:'2020',floor:12};
 const data=[{...base,ym:'202610',d:1,amt:19},{...base,ym:'202610',d:15,amt:20},{...base,ym:'202609',d:2,amt:18},{...base,ym:'202606',d:3,amt:16},{...base,area:59.9,ym:'202610',d:16,amt:9}];
 const result=c.analyzeCompare({'11111':data},[{lawd:'11111',name:'가상단지'}],['202610','202609','202608','202607','202606','202605']);
 const p=result.complexes[0].pys.find(p=>p.area===84);
 assert.equal(p.latest.price,20);assert.equal(p.latest.day,15);assert.equal(p.high.price,20);assert.equal(p.low.price,16);assert.equal(p.avg3.v,19);assert.equal(p.avg3.n,3);assert.equal(p.prev3.v,16);assert.equal(p.n,4);assert.equal(p.median,18.5);
});
test('summary renders side-by-side fields, exact school details and missing values safely',()=>{
 const c=setup();const a={name:'가상<A>',umd:'가상동',count:4,build:'2020',hh:{hhcnt:1000,far:250,bcr:20,dongCnt:10,subwayWalk:'10분이내'},schoolInfo:{schools:[{name:'가상초',level:'초',distance:123,type:'공립'}]},pys:[{area:84,py:'34평',n:4,avg3:{v:19,n:3},max:20,latest:{price:20,ym:'202610',day:15,floor:12}}]};
 const b={name:'가상B',pys:[],count:0};const result=c.compareSummaryHTML({complexes:[a,b],period:'26.05 ~ 26.10'});
 assert.match(result,/<table/);assert.equal((result.match(/scope="row"/g)||[]).length,15);assert.match(result,/scope="col"/);assert.match(result,/가상&lt;A&gt;/);assert.match(result,/건폐율[^]*20%/);assert.doesNotMatch(result,/가상초|초등학교|중학교|고등학교/);assert.match(result,/지하철 도보[^]*10분이내/);assert.match(result,/<td>—<\/td>/);assert.doesNotMatch(result,/NaN|undefined|Infinity/);
 c.cmpPyMap[0]=59;assert.doesNotMatch(c.compareSummaryHTML({complexes:[a,b]}),/20.0억/);
});

test('latest comparison trade requires floor three or higher and excludes direct sales even on raw fallback',()=>{
 const c=setup(),base={apt:'가상단지',umd:'가상동',area:84,py:34,ym:'202610',amt:10};
 c.markOutliers=()=>[];
 const records=[{...base,d:1,floor:3,direct:0},{...base,d:2,floor:2,direct:0},{...base,d:3,floor:12,direct:1},{...base,d:4,floor:null,direct:0}];
 const analyze=items=>c.analyzeCompare({'11111':items},[{lawd:'11111',name:'가상단지'}],['202610']).complexes[0].pys[0];
 const p=analyze(records);assert.equal(p.latest.day,1);assert.equal(p.latest.floor,3);assert.equal(analyze(records.slice(1)).latest,null);
});
