import test from 'node:test';import assert from 'node:assert/strict';import {changePeriods,regionalChange,selectRegionalSamples} from '../shared/regional-change.mjs';
test('monthly includes current month through as-of day and handles January rollover',()=>{const p=changePeriods('2026-10-21');assert.equal(p.monthly[0].label,'2026-10');assert.equal(p.monthly.length,12);assert.equal(p.monthly[11].label,'2025-11');assert.equal(new Date(p.monthly[0].end).toISOString().slice(0,10),'2026-10-22');assert.equal(p.monthly[1].label,'2026-09');const jan=changePeriods('2026-01-02').monthly[0];assert.equal(new Date(jan.previousStart).toISOString().slice(0,7),'2025-12');});
test('same complex composition compares mean unit prices and excludes unmatched or direct trades',()=>{const p=changePeriods('2026-10-13').monthly[1],items=[];for(let i=0;i<5;i++)for(let k=0;k<2;k++){items.push({apt:'단지'+i,umd:'동',area:84,floor:7,amt:10,ym:'202608',d:10},{apt:'단지'+i,umd:'동',area:84,floor:7,amt:11,ym:'202609',d:10});}items.push({apt:'단지0',umd:'동',area:84,floor:7,amt:100,ym:'202609',d:10,direct:1},{apt:'다른단지',umd:'동',area:84,floor:7,amt:100,ym:'202609',d:10});const r=regionalChange(items,p);assert.equal(r.rate,10);assert.equal(r.currentTrades,10);assert.equal(regionalChange(items.slice(0,4),p).rate,null);});
test('fixed samples give each complex return equal weight with one trade per month',()=>{const p=changePeriods('2026-10-13').monthly[1],rows=[];for(const [apt,old,now] of [['A',10,11],['B',100,90],['outside',10,100]]){rows.push({apt,umd:'동',area:50,amt:old,ym:'202608',d:1},{apt,umd:'동',area:50,amt:now,ym:'202609',d:1});}const samples=['A','B','no-trade'].map(apt=>JSON.stringify(['동',apt]));const result=regionalChange(rows,p,{},samples);assert.equal(result.rate,null);assert.equal(result.groups,2);assert.equal(result.sampleCount,3);});

test('three comparable complexes is the minimum, one trade per month is sufficient',()=>{const p=changePeriods('2026-10-13').monthly[1];const items=Array.from({length:3},(_,i)=>[{apt:'단지'+i,umd:'동',area:50,amt:10,ym:'202608',d:1},{apt:'단지'+i,umd:'동',area:50,amt:11,ym:'202609',d:1}]).flat();assert.equal(regionalChange(items,p).rate,10);assert.equal(regionalChange(items.slice(0,4),p).rate,null);});

test('top thirty ranking has no per-complex trade count minimum and uses completed selection window',()=>{const start=Date.UTC(2025,9,1),end=Date.UTC(2026,9,1);const items=Array.from({length:60},(_,i)=>({apt:'A'+i,umd:'동',area:50,amt:i+1,ym:'202609',d:1}));items.push({apt:'future',umd:'동',area:50,amt:999,ym:'202610',d:1},{apt:'direct',umd:'동',area:50,amt:999,ym:'202609',d:1,direct:1});const samples=selectRegionalSamples(items,{},start,end);assert.equal(samples.length,30);assert.equal(samples[0].name,'A59');assert.equal(samples[29].name,'A30');assert.equal(samples[0].trades,1);});

test('detail rows exactly cover the complexes used in the aggregate',()=>{const p=changePeriods('2026-10-13').monthly[1];const items=Array.from({length:3},(_,i)=>[{apt:'단지'+i,umd:'동',area:50,amt:10,ym:'202608',d:1},{apt:'단지'+i,umd:'동',area:50,amt:11,ym:'202609',d:1}]).flat();const m=regionalChange(items,p);assert.equal(m.comparisons.length,m.groups);assert.equal(m.comparisons[0].previousTrades,1);assert.equal(m.comparisons[0].currentTrades,1);assert.ok(Math.abs(m.comparisons.reduce((sum,x)=>sum+x.rate,0)/m.groups-m.rate)<.00001);});

test('supply price uses matched supply pyeong for prices and top sample selection',()=>{const p=changePeriods('2026-10-13').monthly[1];const rows=[{apt:'A',umd:'동',area:84,py:33,amt:9.9,ym:'202608',d:1},{apt:'A',umd:'동',area:84,py:33,amt:10.89,ym:'202609',d:1},{apt:'B',umd:'동',area:84,py:50,amt:12,ym:'202609',d:1}];const result=regionalChange(rows,p);assert.ok(Math.abs(result.comparisons[0].previousPrice-.3)<1e-9);assert.ok(Math.abs(result.comparisons[0].currentPrice-.33)<1e-9);assert.ok(Math.abs(result.comparisons[0].rate-10)<1e-9);const selected=selectRegionalSamples(rows,{},p.start,p.end);assert.equal(selected[0].name,'A');});

const p=changePeriods('2026-10-21').monthly[1];
const t=(apt,ym,py,unit)=>({apt,umd:'동',area:py*2.5,py,amt:py*unit,ym,d:1});
test('highest current unit-price type is used consistently for both months without transaction weights',()=>{
 const rows=[t('A','202608',20,.5),t('A','202609',20,.55),...Array.from({length:9},()=>t('A','202608',50,.3)),t('A','202609',50,.4)];
 const a=regionalChange(rows,p).comparisons[0];assert.equal(a.py,20);assert.equal(a.previousPrice,.5);assert.equal(a.currentPrice,.55);assert.ok(Math.abs(a.rate-10)<1e-8);assert.equal(a.matchedTypes.length,1);
});
test('all positive supply sizes enter comparisons and sample selection',()=>{
 const rows=[12,19,20,40,41,80].flatMap(py=>[t('A'+py,'202608',py,1),t('A'+py,'202609',py,1.1)]);
 assert.equal(regionalChange(rows,p).groups,6);assert.equal(selectRegionalSamples(rows,{},p.start,p.end).length,6);
});
test('empty months carry historical prices and preserve zero actual trade counts',()=>{
 const rows=[t('A','202601',60,.5),t('B','202602',15,.4),t('C','202608',45,.6),t('C','202609',45,.66)];
 const r=regionalChange(rows,p);assert.equal(r.groups,3);assert.equal(r.rate,3.33);
 const a=r.comparisons.find(x=>x.name==='A');assert.equal(a.previousPrice,.5);assert.equal(a.currentPrice,.5);assert.equal(a.currentTrades,0);assert.equal(a.previousTrades,0);assert.equal(a.rate,0);
});
test('future prices never fill past months and new highest types have no backwards fill',()=>{
 const rows=[t('new','202609',25,1),t('future','202610',30,3),t('A','202608',20,.5),t('A','202609',80,.8)];
 assert.equal(regionalChange(rows,p).groups,0);
});
test('a carried highest-price type is not replaced by a newly traded cheaper type',()=>{
 const a=regionalChange([t('A','202601',15,1),t('A','202609',70,.6)],p).comparisons[0];
 assert.equal(a.py,15);assert.equal(a.currentPrice,1);assert.equal(a.rate,0);assert.equal(a.currentTrades,0);
});
test('regional rates keep equal complex weights and exclude cancellations',()=>{
 const rows=[t('A','202608',60,1),t('A','202609',60,1.3),t('B','202601',12,1),t('C','202601',80,1),{...t('B','202609',12,10),cancelled:true}];
 const r=regionalChange(rows,p);assert.equal(r.groups,3);assert.equal(r.rate,10);
});

test('current month carries September price and excludes trades after the as-of day',()=>{
 const now=changePeriods('2026-10-21').monthly[0];
 const r=regionalChange([t('A','202609',30,1),{...t('A','202610',30,2),d:22},t('B','202609',30,1),t('B','202610',30,1.3),t('C','202608',50,1)],now);
 assert.equal(r.groups,3);assert.equal(r.rate,10);assert.equal(r.comparisons.find(x=>x.name==='A').currentPrice,1);
});

test('year-to-date compares December with selected month rather than averaging year or compounding regional rates',async()=>{
 const {regionalYtdPeriod}=await import('../shared/regional-change.mjs');
 const period=regionalYtdPeriod(changePeriods('2026-10-21').monthly[0]);
 assert.equal(new Date(period.previousStart).toISOString().slice(0,7),'2025-12');
 const rows=[t('A','202512',30,1),t('A','202601',30,10),t('A','202610',30,1.2),t('B','202511',40,1),t('C','202512',60,1),t('C','202609',60,.9)];
 const r=regionalChange(rows,period);assert.equal(r.groups,3);assert.equal(r.rate,3.33);
 assert.equal(r.comparisons.find(x=>x.name==='B').rate,0);
 const january=regionalYtdPeriod(changePeriods('2026-01-02').monthly[0]);assert.equal(january.previousStart,Date.UTC(2025,11,1));
});
