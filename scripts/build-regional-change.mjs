import {readFile,writeFile,readdir} from 'node:fs/promises';
import {REGIONS} from '../shared/regions.mjs';
import {changePeriods,regionalChange} from '../shared/regional-change.mjs';
const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const periods=changePeriods(asOf),regions=[];
const earliest=Math.min(...Object.values(periods).flat().map(p=>p.previousStart));
for(const [province,rows] of REGIONS)for(const [name,lawd] of rows){
 let files=[];try{files=await readdir(`data/analyze/${lawd}`);}catch{}
 const items=[];const available=new Set();
 for(const file of files.filter(f=>/^\d{6}\.json$/.test(f))){const ym=file.slice(0,6);if(Date.UTC(+ym.slice(0,4),+ym.slice(4)-1,1)<earliest-32*86400000)continue;const data=JSON.parse(await readFile(`data/analyze/${lawd}/${file}`,'utf8'));if(!Array.isArray(data.items))throw Error('invalid trade data');items.push(...data.items);available.add(ym);}
 let names={};try{names=JSON.parse(await readFile(`data/naver-names/${lawd}.json`,'utf8'));}catch{}
 const metrics={};for(const [kind,ps] of Object.entries(periods))metrics[kind]=ps.map(p=>{
  const required=[];const day=new Date(p.previousStart);while(+day<p.end){required.push(day.toISOString().slice(0,7).replace('-',''));day.setUTCDate(1);day.setUTCMonth(day.getUTCMonth()+1);}
  return required.every(ym=>available.has(ym))?regionalChange(items,p,names):{rate:null,groups:0,previousTrades:0,currentTrades:0,missing:true};});
 regions.push({province,name,lawd,metrics});
}
await writeFile('data/regional-change.json',JSON.stringify({asOf,generatedAt:new Date().toISOString(),periods,regions}));
console.log(`지역별 실거래 변동률 생성: ${regions.length}개 지역 (${asOf})`);
