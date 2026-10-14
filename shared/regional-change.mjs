import {areaToPy} from './rtms-parse.mjs';
const supplyPy=t=>Number.isFinite(t.py)&&t.py>0?t.py:areaToPy(Math.round(t.area));
export const REGIONAL_PY_MIN=20,REGIONAL_PY_MAX=40;
export function regionalSupplyPy(t){return supplyPy(t);}
const eligiblePy=py=>Number.isFinite(py)&&py>=REGIONAL_PY_MIN&&py<=REGIONAL_PY_MAX;
export function median(values){const a=[...values].sort((a,b)=>a-b),n=a.length;return n?n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null;}
export function tradeDay(t){const y=Number(String(t.ym).slice(0,4)),m=Number(String(t.ym).slice(4)),d=Number(t.d);if(!y||!m||!d)return NaN;const time=Date.UTC(y,m-1,d),date=new Date(time);return date.getUTCMonth()===m-1&&date.getUTCDate()===d?time:NaN;}
// 같은 단지·공급평형의 월평균을 비교하고 평형 가격은 각 달의 거래 건수로 가중하고, 지역은 단지별 동일 비중으로 평균한다.
export function regionalChange(items,period,names={},samples=null){
 const buckets=[new Map(),new Map()],average=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
 for(const t of items){if(t.direct||t.cancel||t.cancelled||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  const date=tradeDay(t),side=date>=period.start&&date<period.end?1:date>=period.previousStart&&date<period.start?0:-1;if(side<0)continue;
  const apt=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,apt]),py=supplyPy(t);
  if((samples&&!samples.includes(key))||!eligiblePy(py))continue;
  const types=buckets[side].get(key)||new Map(),prices=types.get(py)||[];prices.push(t.amt/py);types.set(py,prices);buckets[side].set(key,types);
 }
 const comparisons=[];let previousTrades=0,currentTrades=0;
 for(const [key,now] of buckets[1]){const old=buckets[0].get(key);if(!old)continue;const matchedTypes=[];
  for(const [py,prices] of now){const previous=old.get(py);if(!previous)continue;const previousPrice=average(previous),currentPrice=average(prices);matchedTypes.push({py,previousPrice,currentPrice,rate:(currentPrice/previousPrice-1)*100,previousTrades:previous.length,currentTrades:prices.length});}
  if(!matchedTypes.length)continue;matchedTypes.sort((a,b)=>a.py-b.py);
  const [umd,name]=JSON.parse(key),oldCount=matchedTypes.reduce((sum,x)=>sum+x.previousTrades,0),nowCount=matchedTypes.reduce((sum,x)=>sum+x.currentTrades,0);
  const monthPrice=side=>matchedTypes.reduce((sum,x)=>sum+x[side+'Price']*x[side+'Trades'],0)/(side==='previous'?oldCount:nowCount);
  const previousPrice=monthPrice('previous'),currentPrice=monthPrice('current');
  comparisons.push({name,umd,matchedTypes,previousPrice,currentPrice,rate:(currentPrice/previousPrice-1)*100,previousTrades:oldCount,currentTrades:nowCount});previousTrades+=oldCount;currentTrades+=nowCount;
 }
 const groups=comparisons.length;
 return {comparisons,rate:groups>=3?(Math.round(average(comparisons.map(x=>x.rate))*100)/100||0):null,groups,sampleCount:samples?.length??groups,previousTrades,currentTrades,previousPrice:groups?average(comparisons.map(x=>x.previousPrice)):null,currentPrice:groups?average(comparisons.map(x=>x.currentPrice)):null};
}
export function changePeriods(asOf){const date=new Date(asOf+'T00:00:00Z');if(!Number.isFinite(+date))throw Error('invalid date');const month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
 const monthly=Array.from({length:6},(_,i)=>{const d=new Date(month),y=d.getUTCFullYear(),m=d.getUTCMonth()-i;return {id:`m${i}`,label:new Date(Date.UTC(y,m-1,1)).toISOString().slice(0,7),start:Date.UTC(y,m-1,1),end:Date.UTC(y,m,1),previousStart:Date.UTC(y,m-2,1)};});
 return {monthly};}

// 최근 완료된 12개월의 공급평당 평균 가격 상위 30개. 선정 후 목록은 고정한다.
export function selectRegionalSamples(items,names={},start,end,limit=30){
 const groups=new Map();
 for(const t of items){const date=tradeDay(t);if(!(date>=start&&date<end)||t.direct||t.cancel||t.cancelled||!t.apt||!t.umd||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  if(!eligiblePy(supplyPy(t)))continue;
  const name=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,name]);const row=groups.get(key)||{key,name,umd:t.umd,sum:0,trades:0};row.sum+=t.amt/supplyPy(t);row.trades++;groups.set(key,row);
 }
 return [...groups.values()].map(({sum,...r})=>({...r,price:sum/r.trades})).sort((a,b)=>b.price-a.price||a.key.localeCompare(b.key,'ko')).slice(0,limit);
}
