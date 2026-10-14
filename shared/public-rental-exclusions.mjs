// 확인된 공공임대 평형만 일반 실거래 분석에서 제외한다.
// 원본 월별 파일은 보존한다. 면적이 작거나 매매가 없다는 이유만으로 제외하지 않는다.
// 마포래미안푸르지오: 서울시 재개발임대 661세대.
// https://ms.smc.seoul.kr/attach/record/SEOUL/appendix/a10/A0050614.pdf
// 전월세 원본 등록 면적: 36.9796㎡, 41.9838㎡ (1~4단지, 아현동).
export const PUBLIC_RENTAL_RULES = [{
  lawd:'11440', umd:'아현동',
  names:['마포래미안푸르지오','마포래미안푸르지오1단지','마포래미안푸르지오2단지','마포래미안푸르지오3단지','마포래미안푸르지오4단지'],
  exclusiveAreas:[36.9796,41.9838],
}];
const norm=value=>String(value||'').replace(/\s/g,'');
export function isConfirmedPublicRental(item,lawd){
  const area=Number(item.area);
  if(!Number.isFinite(area))return false;
  return PUBLIC_RENTAL_RULES.some(rule=>String(lawd)===rule.lawd&&norm(item.umd)===norm(rule.umd)&&rule.names.some(name=>norm(name)===norm(item.apt))&&rule.exclusiveAreas.some(size=>Math.abs(size-area)<=0.01));
}
export function excludeConfirmedPublicRental(items,lawd){
  return items.filter(item=>!isConfirmedPublicRental(item,lawd));
}
