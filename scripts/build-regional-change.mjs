import {applyNaverSupplyAreas} from '../shared/supply-area-loader.mjs';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {REGIONS} from '../shared/regions.mjs';
import {changePeriods,regionalChange,regionalPeriodMatrix,selectRegionalSamples,regionalSupplyPy,REGIONAL_PY_MIN,REGIONAL_PY_MAX} from '../shared/regional-change.mjs';
const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const periods=changePeriods(asOf),regions=[];
await mkdir('data/regional-change-details',{recursive:true});
let fixed;try{fixed=JSON.parse(await readFile('data/regional-samples.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;fixed={selectedAt:asOf,regions:{}};}
const selectionEnd=periods.monthly[0].start,selectionDate=new Date(selectionEnd);selectionDate.setUTCFullYear(selectionDate.getUTCFullYear()-1);const selectionStart=+selectionDate;
if(fixed.method!=='top30-supply-price-all-sizes-v2')fixed={method:'top30-supply-price-all-sizes-v2',selectedAt:asOf,selectionStart:new Date(selectionStart).toISOString().slice(0,10),selectionEnd:new Date(selectionEnd).toISOString().slice(0,10),regions:{},details:{}};
const allFixed={selectedAt:asOf,regions:{}};
for(const [province,rows] of REGIONS)for(const [name,lawd] of rows){
 let files=[];try{files=await readdir(`data/analyze/${lawd}`);}catch{}
 const items=[];const available=new Set();
 let names={};try{names=JSON.parse(await readFile(`data/naver-names/${lawd}.json`,'utf8'));}catch{}
 let supplyAreas=[];try{supplyAreas=JSON.parse(await readFile(`data/supply-area-naver/${lawd}.json`,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const selectionItems=[];
 for(const file of files.filter(f=>/^\d{6}\.json$/.test(f))){const ym=file.slice(0,6);const data=JSON.parse(await readFile(`data/analyze/${lawd}/${file}`,'utf8'));if(!Array.isArray(data.items))throw Error('invalid trade data');const calibrated=applyNaverSupplyAreas(data.items,supplyAreas,lawd);selectionItems.push(...calibrated);
 items.push(...calibrated);available.add(ym);}
 if(!fixed.regions[lawd]){const selected=selectRegionalSamples(selectionItems,names,selectionStart,selectionEnd);fixed.regions[lawd]=selected.map(x=>x.key);fixed.details[lawd]=selected;}
 const eligibleKeys=new Set(selectionItems.filter(t=>{const py=regionalSupplyPy(t);return Number.isFinite(py)&&py>0&&!t.direct&&!t.cancel&&!t.cancelled&&t.amt>0;}).map(t=>JSON.stringify([t.umd,names[`${t.apt}|${t.umd}`]||t.apt])));
 const regionAllSamples=[...eligibleKeys].sort();allFixed.regions[lawd]=regionAllSamples;
 const metrics={};for(const [kind,ps] of Object.entries(periods))metrics[kind]=ps.map(p=>{
  const required=[];const day=new Date(p.previousStart);while(+day<p.end){required.push(day.toISOString().slice(0,7).replace('-',''));day.setUTCDate(1);day.setUTCMonth(day.getUTCMonth()+1);}
  return required.every(ym=>available.has(ym))?regionalChange(items,p,names,fixed.regions[lawd]):{rate:null,groups:0,sampleCount:fixed.regions[lawd].length,previousTrades:0,currentTrades:0,missing:true};});
 const allMetrics={};for(const [kind,ps] of Object.entries(periods))allMetrics[kind]=ps.map(p=>{
  const required=[];const day=new Date(p.previousStart);while(+day<p.end){required.push(day.toISOString().slice(0,7).replace('-',''));day.setUTCDate(1);day.setUTCMonth(day.getUTCMonth()+1);}
  const samples=regionAllSamples;
  return required.every(ym=>available.has(ym))?regionalChange(items,p,names,samples):{rate:null,groups:0,sampleCount:samples.length,previousTrades:0,currentTrades:0,missing:true};});
 const periodMetrics=regionalPeriodMatrix(items,periods.monthly,names,fixed.regions[lawd],available);
 const allPeriodMetrics=regionalPeriodMatrix(items,periods.monthly,names,regionAllSamples,available);
 const details={all:{},top50:{}};periods.monthly.forEach((p,i)=>{details.all[p.label]=allMetrics.monthly[i].comparisons||[];details.top50[p.label]=metrics.monthly[i].comparisons||[];delete allMetrics.monthly[i].comparisons;delete metrics.monthly[i].comparisons;});
 await writeFile(`data/regional-change-details/${lawd}.json`,JSON.stringify(details));
 regions.push({province,name,lawd,metrics,allMetrics,periodMetrics,allPeriodMetrics});
}
await writeFile('data/regional-samples.json',JSON.stringify(fixed));
await writeFile('data/regional-all-samples.json',JSON.stringify(allFixed));
await writeFile('data/regional-change.json',JSON.stringify({asOf,supplyPyMin:REGIONAL_PY_MIN,supplyPyMax:REGIONAL_PY_MAX,priceBasis:'supply-pyeong',comparisonMethod:'highest-unit-price-type-monthly-carry-complex-equal',priceUnit:'억원/평',sampleMethod:fixed.method,sampleSelectionStart:fixed.selectionStart,sampleSelectionEnd:fixed.selectionEnd,sampleSelectedAt:fixed.selectedAt,generatedAt:new Date().toISOString(),periods,regions}));
console.log(`지역별 실거래 변동률 생성: ${regions.length}개 지역 (${asOf})`);
