// 건축HUB 전유공용면적 API로 자동 계산된 공급면적 캐시 (scripts/collect-supply-area.mjs가 생성/갱신).
// 사람이 직접 손대지 말 것 — 수동으로 값을 등록하려면 shared/supply-area.mjs의 SUPPLY_AREA_OVERRIDE를 쓸 것
// (resolvePy는 SUPPLY_AREA_OVERRIDE를 이 파일보다 항상 우선함).
// 같은 전용면적에 타입(A/B/C 등)이 여러 개라 값이 갈리는 애매한 경우는 여기 안 들어가고
// data/supply-area-review.json에 후보로만 남음 — 확인 후 SUPPLY_AREA_OVERRIDE에 수동 등록할 것.
//
// 아직 배치를 한 번도 안 돌려서 비어있는 최초 상태 — collect-supply-area.mjs 최초 실행 시 이 파일 전체가 덮어써짐.

export const SUPPLY_AREA_AUTO = {};
