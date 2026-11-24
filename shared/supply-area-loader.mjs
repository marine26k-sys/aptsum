import { excludeConfirmedPublicRental } from "./public-rental-exclusions.mjs";
// 실거래 단지명으로 저장된 보정표만 조회한다. 이름 추정은 로컬 가져오기에서
// naver의 비교 규칙 + 법정동 + K-apt 세대수 검증을 통과한 뒤 수행한다.
const norm = s => String(s || '').replace(/\s/g,'');
const kbIdentity = s => String(s || '').normalize('NFKC').replace(/[\s·ㆍ()\[\]{}.,_-]/g,'').toLocaleLowerCase('ko-KR');
const caches = new Map();
// 개정 네이버 매칭표의 supply_pyeong_rule: floor(supply_area * 0.3025).
export function supplyAreaToPy(supplyArea) {
  return Math.floor(supplyArea * 0.3025);
}
// 국토부 분양권 거래의 excluUseAr가 전용면적 대신 계약면적(또는 공급면적)으로
// 기록된 것이 공식 모집공고와 대조되어 확인된 사례만 정확한 단지·동·원본 수치로 교정한다.
// 일반적인 면적 상한 필터는 실제 대형 타입과 불완전한 면적표까지 제거할 수 있어 사용하지 않는다.
const verifiedPresaleAreaCorrections = [
  { lawds: ['HS-효행구', '41590', '41593'], apt: '봉담 중흥S-클래스 센트럴에듀', umd: '봉담읍 동화리', reported: 197.4002, exclusive: 101.0654, supply: 129.4583 },
  { lawds: ['11290'], apt: '해링턴플레이스 안암', umd: '안암동3가', reported: 106.8466, exclusive: 49.56, supply: 66.06 },
  { lawds: ['26200'], apt: '오션라이프 에일린의 뜰 1단지', umd: '동삼동', reported: 143.8741, exclusive: 74.9694, supply: 100.3806 },
  { lawds: ['26200'], apt: '오션라이프 에일린의 뜰 2단지', umd: '동삼동', reported: 141.8, exclusive: 74.9696, supply: 101.6399 },
  { lawds: ['26290'], apt: '두산위브더제니스 오션시티', umd: '우암동', reported: 144.9258, exclusive: 75.4754, supply: 101.03 },
  { lawds: ['41115'], apt: '힐스테이트 푸르지오 수원', umd: '교동', reported: 139.43, exclusive: 59.88, supply: 88.55 },
  { lawds: ['41115'], apt: '힐스테이트 푸르지오 수원', umd: '교동', reported: 116.47, exclusive: 49.92, supply: 74.06 },
  { lawds: ['41173'], apt: '평촌 엘프라우드', umd: '비산동', reported: 192.6184, exclusive: 110.57, supply: 149.36 },
  { lawds: ['41220'], apt: '지제역 푸르지오 엘리아츠', umd: '동삭동', reported: 158.6549, exclusive: 84.7027, supply: 111.5316 },
  { lawds: ['41370'], apt: '오산 라온프라이빗 스위트', umd: '고현동', reported: 165.4973, exclusive: 84.9651, supply: 110.3942 },
  { lawds: ['41390'], apt: '군자 서희스타힐스', umd: '거모동', reported: 114.7855, exclusive: 59.9921, supply: 79.5917 },
  // 공고상 전용 77.937㎡ 타입의 공급면적 소계는 100.104㎡다. 원본 100.081㎡와의
  // 차이(0.023㎡)가 단지 내 다른 공급면적보다 유일하게 작아 공급면적 오기 사례로 교정한다.
  { lawds: ['28185'], apt: 'KTX송도역 서해그랑블 더 파크', umd: '옥련동', reported: 100.081, exclusive: 77.937, supply: 100.104 },
];

function verifiedPresaleAreaCorrection(item, lawd) {
  const match = verifiedPresaleAreaCorrections.find((row) =>
    row.lawds.includes(String(lawd || '')) &&
    norm(row.apt) === norm(item?.apt) &&
    norm(row.umd) === norm(item?.umd) &&
    (Math.abs(Number(item?.area) - row.reported) <= 0.005 ||
      Math.abs(Number(item?.area) - row.exclusive) <= 0.005)
  );
  return match ? { area: match.exclusive, py: supplyAreaToPy(match.supply) } : null;
}
// 위에 등록된 공고 대조 완료 행을 먼저 교정한 뒤, 나머지는 공급면적이 네이버 단지 매핑표의
// 한 전용면적으로만 유일하게 대응할 때만 기존 방식으로 보정한다.
export function correctPresaleSupplyAreas(items, records, lawd) {
  const byName = new Map();
  for (const row of Array.isArray(records) ? records : []) {
    if (!row?.apt || !Number.isFinite(row.exclusiveArea) || !Number.isFinite(row.supplyArea)) continue;
    const key = norm(row.apt);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  return items.map(item => {
    const verified = verifiedPresaleAreaCorrection(item, lawd);
    if (verified) return { ...item, ...verified };
    const rows = byName.get(norm(item.apt)) || [];
    const supplyHits = rows.filter(row => Math.abs(row.supplyArea - Number(item.area)) <= 0.05);
    // The reported exclusive area can differ slightly from the KB/Naver type area.
    // A value near another type's supply area is ambiguous, so preserve the raw
    // exclusive area instead of moving its transactions to the smaller type.
    if (!supplyHits.length || rows.some(row => Math.abs(row.exclusiveArea - Number(item.area)) <= 0.2)) return item;
    const exclusiveAreas = [...new Set(supplyHits.map(row => row.exclusiveArea))];
    const householdCounts = [...new Set(supplyHits.map(row => row.hh).filter(Number.isInteger))];
    if (exclusiveAreas.length !== 1 || householdCounts.length > 1) return item;
    return { ...item, area: exclusiveAreas[0], py: supplyAreaToPy(supplyHits[0].supplyArea) };
  });
}
export function applyNaverSupplyAreas(items, records, lawd) {
  const exactTypes = new Map();
  const roundedTypes = new Map();
  const households = new Map();
  const addType = (map, key, py, hh) => {
    if (!map.has(key)) map.set(key, {py,hh});
    else if (map.get(key)?.py !== py || map.get(key)?.hh !== hh) map.set(key,null);
  };
  for (const row of Array.isArray(records) ? records : []) {
    if (!row?.apt || !Number.isInteger(row.hh) || row.hh <= 0 || !Number.isFinite(row.exclusiveArea) || !Number.isFinite(row.supplyArea) || !(row.exclusiveArea > 0 && row.supplyArea > row.exclusiveArea)) continue;
    const name = norm(row.apt);
    if (!households.has(name)) households.set(name,new Set());
    households.get(name).add(row.hh);
    const py = supplyAreaToPy(row.supplyArea);
    addType(exactTypes, `${name}|${row.exclusiveArea.toFixed(2)}`, py, row.hh);
    const roundedKey = `${name}|${Math.round(row.exclusiveArea)}`;
    const rounded = roundedTypes.get(roundedKey);
    if (!roundedTypes.has(roundedKey)) roundedTypes.set(roundedKey,{py,hh:row.hh,areas:[row.exclusiveArea]});
    else if (rounded && rounded.py === py && rounded.hh === row.hh) rounded.areas.push(row.exclusiveArea);
    else roundedTypes.set(roundedKey,null);
  }
  return items.map(t => {
    const name = norm(t.apt);
    const exactKey = `${name}|${Number(t.area).toFixed(2)}`;
    const rounded = roundedTypes.get(`${name}|${Math.round(t.area)}`);
    const hit = exactTypes.has(exactKey) ? exactTypes.get(exactKey) :
      rounded?.areas.some(area => Math.abs(area - t.area) <= 0.05 + 1e-9) ? rounded : null;
    if (!hit || (t.hh != null && t.hh !== hit.hh)) return t;
    return {...t,py:hit.py};
  });
}
export function applyKBTypeSupplyPyeong(items, shard) {
  if (!shard?.items || !shard?.exactExclusiveTypes) return items;
  return items.map(item => {
    const key = `${kbIdentity(item.apt)}|${kbIdentity(item.umd)}`;
    const areas = shard.items[key], exact = shard.exactExclusiveTypes[key];
    const area = Number(item.area);
    if (!areas || !exact || !(area > 0)) return item;
    const areaKey = String(Math.floor(area * 100 + 1e-7) / 100);
    const types = exact[areaKey];
    if (!Array.isArray(types) || !types.length) return item;
    const rows = areas[String(Math.floor(area))] || [];
    const matched = rows.filter(row => types.includes(row.type) && Number.isInteger(row.supplyPyeong) && row.supplyPyeong > 0);
    const pyeongs = new Set(matched.map(row => row.supplyPyeong));
    return pyeongs.size === 1 ? { ...item, py: matched[0].supplyPyeong } : item;
  });
}
async function load(origin,lawd) {
  const key = `${origin}|${lawd}`;
  const cached = caches.get(key);
  if(cached && cached.expires > Date.now())return cached.data;
  const read=async path=>{try{const r=await fetch(`${origin}/data/${path}/${encodeURIComponent(lawd)}.json`,{cache:'no-store'});return r.ok?await r.json():null;}catch{return null;}};
  const [hub,naver,kbTypes]=await Promise.all([/^\d{5}$/.test(lawd)?read('supply-area'):null,read('supply-area-naver'),read('complex-type-households')]);
  const map=new Map(Object.entries(hub?.items||{}).map(([n,t])=>[norm(n),t]));
  const data={map,naver,kbTypes};caches.set(key,{data,expires:Date.now()+60_000});return data;
}
export async function applySupplyAreaOverrides(items,lawd,origin) {
  items=excludeConfirmedPublicRental(items,lawd);
  if(!origin||!lawd)return items;
  const {map,naver,kbTypes}=await load(origin,lawd);
  const hubItems=items.map(t=>{
    const types=map.get(norm(t.apt));if(!Array.isArray(types))return t;
    const match=types.find(ty=>Math.round(ty.exclusiveArea)===Math.round(t.area));
    if(!match||!Number.isFinite(match.supplyArea)||!(match.supplyArea>0)||match.exclusiveArea/match.supplyArea>.85)return t;
    const py=supplyAreaToPy(match.supplyArea);
    return Math.abs(py-t.py)>3?t:{...t,py};
  });
  return applyKBTypeSupplyPyeong(applyNaverSupplyAreas(hubItems,naver,lawd),kbTypes);
}
export async function applyPresaleSupplyAreaOverrides(items, lawd, origin) {
  if (!origin || !lawd) return items;
  const { naver, kbTypes } = await load(origin, lawd);
  return applyKBTypeSupplyPyeong(correctPresaleSupplyAreas(items, naver, lawd),kbTypes);
}
