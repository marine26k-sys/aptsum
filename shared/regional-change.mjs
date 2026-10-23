import {areaToPy} from './rtms-parse.mjs';
const supplyPy=t=>Number.isFinite(t.py)&&t.py>0?t.py:areaToPy(Math.round(t.area));
export const REGIONAL_PY_MIN=0,REGIONAL_PY_MAX=null;
export const REGIONAL_HISTORY_MONTHS=24;
export function regionalSupplyPy(t){return supplyPy(t);}
const eligiblePy=py=>Number.isFinite(py)&&py>0;
export function median(values){const a=[...values].sort((a,b)=>a-b),n=a.length;return n?n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null;}
export function tradeDay(t){const y=Number(String(t.ym).slice(0,4)),m=Number(String(t.ym).slice(4)),d=Number(t.d);if(!y||!m||!d)return NaN;const time=Date.UTC(y,m-1,d),date=new Date(time);return date.getUTCMonth()===m-1&&date.getUTCDate()===d?time:NaN;}
// 비교월에 거래가 있는 모든 공급평형을 같은 평형의 전월 시세와 비교한다.
// 무거래월은 과거 월평균을 이어받으며 미래 거래로 과거를 채우지 않는다.
function prepareRegionalHistory(items,cutoff,names){
 const groupsByKey=new Map();
 for(const t of items){
  if(t.direct||t.cancel||t.cancelled||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  const date=tradeDay(t),py=supplyPy(t);
  if(!Number.isFinite(date)||date>=cutoff||!eligiblePy(py))continue;
  const apt=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,apt]);
  const types=groupsByKey.get(key)||new Map(),months=types.get(py)||new Map();
  const ym=String(t.ym),entry=months.get(ym)||{sum:0,n:0,date:Date.UTC(Number(ym.slice(0,4)),Number(ym.slice(4))-1,1)};
  entry.sum+=t.amt/py;entry.n++;months.set(ym,entry);types.set(py,months);groupsByKey.set(key,types);
 }
 for(const types of groupsByKey.values())for(const [py,months] of types)types.set(py,[...months.values()].sort((a,b)=>a.date-b.date));
 return groupsByKey;
}
export function regionalChange(items,period,names={},samples=null,history=null){
 const average=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
 const allowed=samples?new Set(samples):null,groupsByKey=history||prepareRegionalHistory(items,period.end,names);
 const comparisons=[];let previousTrades=0,currentTrades=0;
 for(const [key,types] of groupsByKey){
  if(allowed&&!allowed.has(key))continue;
  const candidates=[];
  for(const [py,months] of types){
   const entries=months.filter(x=>x.date<period.end);
   if(!entries.length)continue;
   const previous=entries.filter(x=>x.date<period.start).at(-1),current=entries.at(-1);
   candidates.push({py,previousPrice:previous?previous.sum/previous.n:null,currentPrice:current.sum/current.n,
    previousTrades:previous&&previous.date>=period.previousStart?previous.n:0,currentTrades:current.date>=period.start?current.n:0});
  }
  const [umd,name]=JSON.parse(key);
  for(const candidate of candidates){
   if(!(candidate.previousPrice>0))continue;
   candidate.rate=(candidate.currentPrice/candidate.previousPrice-1)*100;
   comparisons.push({name,umd,matchedTypes:[candidate],...candidate});
   previousTrades+=candidate.previousTrades;currentTrades+=candidate.currentTrades;
  }
 }
 const groups=comparisons.length;
 const complexes=new Set(comparisons.map(x=>JSON.stringify([x.umd,x.name]))).size;
 return {comparisons,rate:groups>=3?(Math.round(average(comparisons.map(x=>x.rate))*100)/100||0):null,groups,complexes,sampleCount:samples?.length??complexes,previousTrades,currentTrades,previousPrice:groups?average(comparisons.map(x=>x.previousPrice)):null,currentPrice:groups?average(comparisons.map(x=>x.currentPrice)):null};
}
// 시작월 시세와 끝월의 동일 평형 시세를 비교하는 모든 월 조합.
export function regionalPeriodMatrix(items,periods,names={},samples=null,available=null){
 if(!periods.length)return {};
 const history=prepareRegionalHistory(items,Math.max(...periods.map(p=>p.end)),names),result={};
 for(let endIndex=0;endIndex<periods.length-1;endIndex++)for(let startIndex=endIndex+1;startIndex<periods.length;startIndex++){
  const first=periods[startIndex],last=periods[endIndex],date=new Date(first.start);
  const p={start:Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1),previousStart:first.start,end:last.end};
  const key=first.label+'|'+last.label,required=[];const day=new Date(first.start);
  while(+day<last.end){required.push(day.toISOString().slice(0,7).replace('-',''));day.setUTCMonth(day.getUTCMonth()+1);}
  if(available&&!required.every(ym=>available.has(ym))){result[key]={rate:null,groups:0,missing:true};continue;}
  const {rate,groups,complexes}=regionalChange(items,p,names,samples,history);result[key]={rate,groups,complexes};
 }
 return result;
}

export function changePeriods(asOf){const date=new Date(asOf+'T00:00:00Z');if(!Number.isFinite(+date))throw Error('invalid date');const month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
 const monthly=Array.from({length:REGIONAL_HISTORY_MONTHS},(_,i)=>{const d=new Date(month),y=d.getUTCFullYear(),m=d.getUTCMonth()-i;return {id:`m${i}`,label:new Date(Date.UTC(y,m,1)).toISOString().slice(0,7),start:Date.UTC(y,m,1),end:i===0?+date+86400000:Date.UTC(y,m+1,1),previousStart:Date.UTC(y,m-1,1)};});
 return {monthly};}

// 연초 대비는 전년 12월 시세와 선택월 시세를 직접 비교한다.
export function regionalYtdPeriod(period){
 const year=new Date(period.start).getUTCFullYear();
 return {...period,start:Date.UTC(year,0,1),previousStart:Date.UTC(year-1,11,1)};
}

// 최근 완료된 12개월의 공급평당 평균 가격 상위 30개. 선정 후 목록은 고정한다.
export function selectRegionalSamples(items,names={},start,end,limit=30){
 const groups=new Map();
 for(const t of items){const date=tradeDay(t);if(!(date>=start&&date<end)||t.direct||t.cancel||t.cancelled||!t.apt||!t.umd||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  if(!eligiblePy(supplyPy(t)))continue;
  const name=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,name]);const row=groups.get(key)||{key,name,umd:t.umd,sum:0,trades:0};row.sum+=t.amt/supplyPy(t);row.trades++;groups.set(key,row);
 }
 return [...groups.values()].map(({sum,...r})=>({...r,price:sum/r.trades})).sort((a,b)=>b.price-a.price||a.key.localeCompare(b.key,'ko')).slice(0,limit);
}
