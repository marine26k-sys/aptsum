import {readFile,writeFile,readdir} from 'node:fs/promises';
import {REGIONS} from '../shared/regions.mjs';
import {changePeriods,regionalChange,selectRegionalSamples} from '../shared/regional-change.mjs';
const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const periods=changePeriods(asOf),regions=[];
let fixed;try{fixed=JSON.parse(await readFile('data/regional-samples.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;fixed={selectedAt:asOf,regions:{}};}
const selectionEnd=periods.monthly[0].end,selectionDate=new Date(selectionEnd);selectionDate.setUTCFullYear(selectionDate.getUTCFullYear()-1);const selectionStart=+selectionDate;
if(fixed.method!=='top50-unit-price-v1')fixed={method:'top50-unit-price-v1',selectedAt:asOf,selectionStart:new Date(selectionStart).toISOString().slice(0,10),selectionEnd:new Date(selectionEnd).toISOString().slice(0,10),regions:{},details:{}};
const earliest=Math.min(...Object.values(periods).flat().map(p=>p.previousStart));
for(const [province,rows] of REGIONS)for(const [name,lawd] of rows){
 let files=[];try{files=await readdir(`data/analyze/${lawd}`);}catch{}
 const items=[];const available=new Set();
 let names={};try{names=JSON.parse(await readFile(`data/naver-names/${lawd}.json`,'utf8'));}catch{}
 const selectionItems=[];
 for(const file of files.filter(f=>/^\d{6}\.json$/.test(f))){const ym=file.slice(0,6);const data=JSON.parse(await readFile(`data/analyze/${lawd}/${file}`,'utf8'));if(!Array.isArray(data.items))throw Error('invalid trade data');selectionItems.push(...data.items);
 if(Date.UTC(+ym.slice(0,4),+ym.slice(4)-1,1)>=earliest-32*86400000){items.push(...data.items);available.add(ym);}}
 if(!fixed.regions[lawd]){const selected=selectRegionalSamples(selectionItems,names,selectionStart,selectionEnd);fixed.regions[lawd]=selected.map(x=>x.key);fixed.details[lawd]=selected;}
 const metrics={};for(const [kind,ps] of Object.entries(periods))metrics[kind]=ps.map(p=>{
  const required=[];const day=new Date(p.previousStart);while(+day<p.end){required.push(day.toISOString().slice(0,7).replace('-',''));day.setUTCDate(1);day.setUTCMonth(day.getUTCMonth()+1);}
  return required.every(ym=>available.has(ym))?regionalChange(items,p,names,fixed.regions[lawd]):{rate:null,groups:0,sampleCount:fixed.regions[lawd].length,previousTrades:0,currentTrades:0,missing:true};});
 regions.push({province,name,lawd,metrics});
}
await writeFile('data/regional-samples.json',JSON.stringify(fixed));
await writeFile('data/regional-change.json',JSON.stringify({asOf,sampleMethod:fixed.method,sampleSelectionStart:fixed.selectionStart,sampleSelectionEnd:fixed.selectionEnd,sampleSelectedAt:fixed.selectedAt,generatedAt:new Date().toISOString(),periods,regions}));
console.log(`지역별 실거래 변동률 생성: ${regions.length}개 지역 (${asOf})`);
