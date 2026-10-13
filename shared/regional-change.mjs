const DAY=86400000;
export function median(values){const a=[...values].sort((a,b)=>a-b),n=a.length;return n?n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null;}
export function tradeDay(t){const y=Number(String(t.ym).slice(0,4)),m=Number(String(t.ym).slice(4)),d=Number(t.d);if(!y||!m||!d)return NaN;const time=Date.UTC(y,m-1,d),date=new Date(time);return date.getUTCMonth()===m-1&&date.getUTCDate()===d?time:NaN;}
// 같은 단지·전용면적·층 구간의 기간별 중앙값을 비교하고, 비교 그룹에 같은 비중을 준다.
export function regionalChange(items,period,names={}){
 const buckets=[new Map(),new Map()];
 for(const t of items){if(t.direct||t.cancel||t.cancelled||!Number.isFinite(t.amt)||t.amt<=0||!Number.isFinite(t.area)||t.area<=0)continue;
  const date=tradeDay(t),side=date>=period.start&&date<period.end?1:date>=period.previousStart&&date<period.start?0:-1;if(side<0)continue;
  const floor=Number(t.floor);if(!Number.isFinite(floor)||floor<1)continue;
  const apt=names[`${t.apt}|${t.umd}`]||t.apt;
  const key=JSON.stringify([t.umd,apt,Math.round(t.area*100),floor<=3?'low':floor<=10?'mid':'high']);
  const arr=buckets[side].get(key)||[];arr.push(t.amt);buckets[side].set(key,arr);
 }
 const changes=[];let previousTrades=0,currentTrades=0;
 for(const [key,now] of buckets[1]){const old=buckets[0].get(key);if(!old||old.length<2||now.length<2)continue;changes.push((median(now)/median(old)-1)*100);previousTrades+=old.length;currentTrades+=now.length;}
 return {rate:changes.length>=5&&previousTrades>=10&&currentTrades>=10?Math.round(median(changes)*100)/100:null,groups:changes.length,previousTrades,currentTrades};
}
export function changePeriods(asOf){const date=new Date(asOf+'T00:00:00Z');if(!Number.isFinite(+date))throw Error('invalid date');const month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
 const monthly=Array.from({length:6},(_,i)=>{const d=new Date(month),y=d.getUTCFullYear(),m=d.getUTCMonth()-i;return {id:`m${i}`,label:new Date(Date.UTC(y,m-1,1)).toISOString().slice(0,7),start:Date.UTC(y,m-1,1),end:Date.UTC(y,m,1),previousStart:Date.UTC(y,m-2,1)};});
 return {monthly};}
