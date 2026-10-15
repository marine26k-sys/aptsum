export function latestTwoKoreanMonths(now=Date.now()){
 const d=new Date(now+9*3600000),year=d.getUTCFullYear(),month=d.getUTCMonth();
 return [0,1].map(i=>{const v=new Date(Date.UTC(year,month-i,1));return `${v.getUTCFullYear()}${String(v.getUTCMonth()+1).padStart(2,'0')}`;});
}
export async function fetchComplexLiveMonths(lawd,fetcher=fetch,signal){
 if(!/^(?:\d{5}|(?:BC|HS|IC)-[가-힣]+)$/.test(lawd))throw Error('단지 지역을 확인할 수 없습니다.');
 const months=latestTwoKoreanMonths();
 const results=await Promise.all(['analyze','presale','rent'].map(async kind=>{
  const r=await fetcher(`/api/${kind}?lawd=${encodeURIComponent(lawd)}&yms=${months.join(',')}&live=1&refresh=${Date.now()}`,{cache:'no-store',signal});
  const d=await r.json();
  if(!r.ok||!Array.isArray(d.items)||!Array.isArray(d.failedMonths)||d.failedMonths.length||d.items.some(x=>!months.includes(x.ym)))throw Error('일부 자료를 불러오지 못했습니다. 기존 자료를 유지합니다.');
  return {kind,months,items:d.items,failedMonths:[]};
 }));
 return results;
}
