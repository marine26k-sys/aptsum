const DAY=86400000;
export function median(values){const a=[...values].sort((a,b)=>a-b),n=a.length;return n?n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null;}
export function tradeDay(t){const y=Number(String(t.ym).slice(0,4)),m=Number(String(t.ym).slice(4)),d=Number(t.d);if(!y||!m||!d)return NaN;const time=Date.UTC(y,m-1,d),date=new Date(time);return date.getUTCMonth()===m-1&&date.getUTCDate()===d?time:NaN;}
// 양쪽 달 모두 거래된 같은 단지를 같은 비중으로 비교한다.
export function regionalChange(items,period,names={},samples=null){
 const buckets=[new Map(),new Map()];
 for(const t of items){if(t.direct||t.cancel||t.cancelled||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  const date=tradeDay(t),side=date>=period.start&&date<period.end?1:date>=period.previousStart&&date<period.start?0:-1;if(side<0)continue;
  const apt=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,apt]);
  if(samples&&!samples.includes(key))continue;
  const arr=buckets[side].get(key)||[];arr.push(t.amt/t.area);buckets[side].set(key,arr);
 }
 const average=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
 const previous=[],current=[],changes=[],comparisons=[];let previousTrades=0,currentTrades=0;
 for(const [key,now] of buckets[1]){const old=buckets[0].get(key);if(!old)continue;previous.push(average(old));current.push(average(now));changes.push((average(now)/average(old)-1)*100);previousTrades+=old.length;currentTrades+=now.length;const [umd,name]=JSON.parse(key);comparisons.push({name,umd,previousPrice:average(old),currentPrice:average(now),rate:(average(now)/average(old)-1)*100,previousTrades:old.length,currentTrades:now.length});}
 const previousPrice=previous.length?average(previous):null,currentPrice=current.length?average(current):null;
 return {comparisons,rate:changes.length>=3?(Math.round(average(changes)*100)/100||0):null,groups:previous.length,sampleCount:samples?.length??previous.length,previousTrades,currentTrades,previousPrice,currentPrice};
}
export function changePeriods(asOf){const date=new Date(asOf+'T00:00:00Z');if(!Number.isFinite(+date))throw Error('invalid date');const month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
 const monthly=Array.from({length:6},(_,i)=>{const d=new Date(month),y=d.getUTCFullYear(),m=d.getUTCMonth()-i;return {id:`m${i}`,label:new Date(Date.UTC(y,m-1,1)).toISOString().slice(0,7),start:Date.UTC(y,m-1,1),end:Date.UTC(y,m,1),previousStart:Date.UTC(y,m-2,1)};});
 return {monthly};}

// 최근 완료된 12개월의 전용㎡당 평균 가격 상위 50개. 선정 후 목록은 고정한다.
export function selectRegionalSamples(items,names={},start,end,limit=50){
 const groups=new Map();
 for(const t of items){const date=tradeDay(t);if(!(date>=start&&date<end)||t.direct||t.cancel||t.cancelled||!t.apt||!t.umd||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  const name=names[`${t.apt}|${t.umd}`]||t.apt,key=JSON.stringify([t.umd,name]);const row=groups.get(key)||{key,name,umd:t.umd,sum:0,trades:0};row.sum+=t.amt/t.area;row.trades++;groups.set(key,row);
 }
 return [...groups.values()].map(({sum,...r})=>({...r,price:sum/r.trades})).sort((a,b)=>b.price-a.price||a.key.localeCompare(b.key,'ko')).slice(0,limit);
}
