// 실거래 단지명으로 저장된 보정표만 조회한다. 이름 추정은 로컬 가져오기에서
// naver의 비교 규칙 + 법정동 + K-apt 세대수 검증을 통과한 뒤 수행한다.
const norm = s => String(s || '').replace(/\s/g,'');
const caches = new Map();
// 네이버 원본의 공급면적 평형 표기: 소수점 0.8 이상 올림, 미만 버림.
// naver/src/utils/helpers.py의 AreaConverter 및 공급면적 엑셀과 동일하다.
export function supplyAreaToPy(supplyArea) {
  return Math.floor(Number((supplyArea * 0.3025).toFixed(10)) + 0.2);
}
export function applyNaverSupplyAreas(items, records) {
  const types = new Map();
  const households = new Map();
  for (const row of Array.isArray(records) ? records : []) {
    if (!row?.apt || !Number.isInteger(row.hh) || row.hh <= 0 || !Number.isFinite(row.exclusiveArea) || !Number.isFinite(row.supplyArea) || !(row.exclusiveArea > 0 && row.supplyArea > row.exclusiveArea)) continue;
    const name = norm(row.apt);
    if (!households.has(name)) households.set(name,new Set());
    households.get(name).add(row.hh);
    const key = `${name}|${Math.round(row.exclusiveArea)}`;
    const py = supplyAreaToPy(row.supplyArea);
    if (!types.has(key)) types.set(key, {py,hh:row.hh});
    else if (types.get(key)?.py !== py || types.get(key)?.hh !== row.hh) types.set(key,null);
  }
  return items.map(t => {
    const name = norm(t.apt);
    const hit = types.get(`${name}|${Math.round(t.area)}`);
    if (!hit || households.get(name)?.size !== 1 || (t.hh != null && t.hh !== hit.hh)) return t;
    return {...t,py:hit.py};
  });
}
async function load(origin,lawd) {
  const key = `${origin}|${lawd}`;
  if(caches.has(key))return caches.get(key);
  const read=async path=>{try{const r=await fetch(`${origin}/data/${path}/${encodeURIComponent(lawd)}.json`);return r.ok?await r.json():null;}catch{return null;}};
  const [hub,naver]=await Promise.all([/^\d{5}$/.test(lawd)?read('supply-area'):null,read('supply-area-naver')]);
  const map=new Map(Object.entries(hub?.items||{}).map(([n,t])=>[norm(n),t]));
  const data={map,naver};caches.set(key,data);return data;
}
export async function applySupplyAreaOverrides(items,lawd,origin) {
  if(!origin||!lawd)return items;
  const {map,naver}=await load(origin,lawd);
  const hubItems=items.map(t=>{
    const types=map.get(norm(t.apt));if(!Array.isArray(types))return t;
    const match=types.find(ty=>Math.round(ty.exclusiveArea)===Math.round(t.area));
    if(!match||!Number.isFinite(match.supplyArea)||!(match.supplyArea>0)||match.exclusiveArea/match.supplyArea>.85)return t;
    const py=supplyAreaToPy(match.supplyArea);
    return Math.abs(py-t.py)>3?t:{...t,py};
  });
  return applyNaverSupplyAreas(hubItems,naver);
}
