import {REGIONAL_HISTORY_MONTHS} from './regional-change.mjs';
// 배치/API 자료가 새 화면보다 뒤처지면 동일 배포의 정적 자료를 사용한다.
export function hasRegionalPeriodData(data){
 return !!data&&Array.isArray(data.periods?.monthly)&&data.periods.monthly.length>=REGIONAL_HISTORY_MONTHS&&
  Array.isArray(data.regions)&&data.regions.length>0&&data.regions.every(region=>
   region.periodMetrics&&typeof region.periodMetrics==='object'&&!Array.isArray(region.periodMetrics)&&
   region.allPeriodMetrics&&typeof region.allPeriodMetrics==='object'&&!Array.isArray(region.allPeriodMetrics));
}
export async function loadRegionalData(fetcher=fetch){
 for(const path of ['/api/dashboard-data?kind=regional','/data/regional-change.json']){
  try{const response=await fetcher(path,{cache:'no-store'});if(!response.ok)continue;
   const data=await response.json();if(hasRegionalPeriodData(data))return data;
  }catch{}
 }
 throw Error('regional data unavailable');
}
