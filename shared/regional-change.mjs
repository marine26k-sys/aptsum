import {areaToPy} from './rtms-parse.mjs';
const supplyPy=t=>Number.isFinite(t.py)&&t.py>0?t.py:areaToPy(Math.round(t.area));
export const REGIONAL_PY_MIN=0,REGIONAL_PY_MAX=null;
export function regionalSupplyPy(t){return supplyPy(t);}
const eligiblePy=py=>Number.isFinite(py)&&py>0;
export function median(values){const a=[...values].sort((a,b)=>a-b),n=a.length;return n?n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null;}
export function tradeDay(t){const y=Number(String(t.ym).slice(0,4)),m=Number(String(t.ym).slice(4)),d=Number(t.d);if(!y||!m||!d)return NaN;const time=Date.UTC(y,m-1,d),date=new Date(time);return date.getUTCMonth()===m-1&&date.getUTCDate()===d?time:NaN;}
// 비교월의 최고 평당가 평형을 선택하고 같은 평형의 전월 시세와 비교한다.
// 무거래월은 과거 월평균을 이어받으며 미래 거래로 과거를 채우지 않는다.
export function regionalChange(items,period,names={},samples=null){
 const average=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
 const allowed=samples?new Set(samples):null,groupsByKey=new Map();
 for(const t of items){
  if(t.direct||t.cancel||t.cancelled||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  const date=tradeDay(t),py=supplyPy(t);
  if(!Number.isFinite(date)||date>=period.end||!eligiblePy(py))continue;
  const apt=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,apt]);
  if(allowed&&!allowed.has(key))continue;
  const types=groupsByKey.get(key)||new Map(),months=types.get(py)||new Map();
  const ym=String(t.ym),entry=months.get(ym)||{sum:0,n:0,date:Date.UTC(Number(ym.slice(0,4)),Number(ym.slice(4))-1,1)};
  entry.sum+=t.amt/py;entry.n++;months.set(ym,entry);types.set(py,months);groupsByKey.set(key,types);
 }
 const comparisons=[];let previousTrades=0,currentTrades=0;
 for(const [key,types] of groupsByKey){
  const candidates=[];
  for(const [py,months] of types){
   const entries=[...months.values()].sort((a,b)=>a.date-b.date);
   const previous=entries.filter(x=>x.date<period.start).at(-1),current=entries.at(-1);
   // 비교월 최고 평당가를 먼저 선택하며, 과거 가격이 없다고 다른 평형으로 바꾸지 않는다.
   candidates.push({py,previousPrice:previous?previous.sum/previous.n:null,currentPrice:current.sum/current.n,
    previousTrades:previous&&previous.date>=period.previousStart?previous.n:0,currentTrades:current.date>=period.start?current.n:0});
  }
  candidates.sort((a,b)=>b.currentPrice-a.currentPrice||a.py-b.py);
  const selected=candidates[0];if(!selected||!(selected.previousPrice>0))continue;
  selected.rate=(selected.currentPrice/selected.previousPrice-1)*100;
  const [umd,name]=JSON.parse(key);
  comparisons.push({name,umd,matchedTypes:[selected],...selected});
  previousTrades+=selected.previousTrades;currentTrades+=selected.currentTrades;
 }
 const groups=comparisons.length;
 return {comparisons,rate:groups>=3?(Math.round(average(comparisons.map(x=>x.rate))*100)/100||0):null,groups,sampleCount:samples?.length??groups,previousTrades,currentTrades,previousPrice:groups?average(comparisons.map(x=>x.previousPrice)):null,currentPrice:groups?average(comparisons.map(x=>x.currentPrice)):null};
}
export function changePeriods(asOf){const date=new Date(asOf+'T00:00:00Z');if(!Number.isFinite(+date))throw Error('invalid date');const month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
 const monthly=Array.from({length:12},(_,i)=>{const d=new Date(month),y=d.getUTCFullYear(),m=d.getUTCMonth()-i;return {id:`m${i}`,label:new Date(Date.UTC(y,m,1)).toISOString().slice(0,7),start:Date.UTC(y,m,1),end:i===0?+date+86400000:Date.UTC(y,m+1,1),previousStart:Date.UTC(y,m-1,1)};});
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
