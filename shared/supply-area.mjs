// 공급면적(전용+주거공용) 실측값 오버라이드 캐시
// ─────────────────────────────────────────────────────────────
// 국토부 실거래가 API(RTMS)는 전용면적(excluUseAr)만 제공하고 공급면적은 주지 않는다.
// 기존엔 PY_ANCHORS 보간표(areaToPy)로 "전용 84㎡→33평"처럼 시장 통용 평형을 추정만 해왔음.
// 이 파일은 단지별로 실제 확인된(건축HUB 전유공용면적 API 또는 입주자모집공고 등) 공급면적 기준
// 평형을 캐시해두고, 값이 있으면 그걸 쓰고 없으면 기존 보간 추정치로 폴백하는 구조.
//
// 우선순위: SUPPLY_AREA_OVERRIDE(사람이 손으로 등록, 최우선) > SUPPLY_AREA_AUTO(배치가 자동 계산, 차선) > 보간 추정(폴백)
//
// 채우는 경로:
//  1) scripts/collect-supply-area.mjs — GitHub Actions 배치, 전 지역을 훑어 건축HUB API로 조회 후
//     같은 전용면적에 타입이 하나뿐이라 애매함이 없는 경우만 SUPPLY_AREA_AUTO(shared/supply-area-auto.mjs)에
//     자동 반영. 타입이 여러 개라 애매한 경우는 data/supply-area-review.json에 후보만 쌓아두고 반영 안 함.
//  2) scripts/fetch-supply-area.mjs — 단일 단지만 수동 조회하는 CLI. 결과를 사람이 보고 아래
//     SUPPLY_AREA_OVERRIDE에 직접 등록 (애매한 케이스, 또는 review 목록에 쌓인 것을 확인할 때 사용)
//  3) 청약 카드 제작 시 입주자모집공고에서 이미 확보한 공급면적을 수동 등록 (가장 빠르고 확실)
//
// key 포맷: `${단지명}|${umd(법정동)}|${전용면적 반올림 정수}`  →  value: 실측 평형(정수)
// 같은 단지라도 umd가 다르면(동 표기 차이) 별도 항목으로 등록해야 함 — umd는 실거래가 원본 표기 그대로 사용.
import { SUPPLY_AREA_AUTO } from "./supply-area-auto.mjs";

export const SUPPLY_AREA_OVERRIDE = {
  // 예시(값 확인 전까지는 주석 처리 상태로 둘 것):
  // "래미안원베일리|반포동|59": 25,
  // "래미안원베일리|반포동|84": 34,
};

// area: 전용면적(㎡, 반올림 전 원본값 그대로 넘겨도 됨 — 내부에서 반올림해 키 생성)
// fallbackAreaToPy: 각 파일에 이미 있는 areaToPy 함수를 그대로 주입받아 캐시 미스 시 사용
export function resolvePy(apt, umd, area, fallbackAreaToPy) {
  const rounded = Math.round(area);
  const key = `${apt}|${umd}|${rounded}`;
  const hit = SUPPLY_AREA_OVERRIDE[key] ?? SUPPLY_AREA_AUTO[key];
  return hit != null ? hit : fallbackAreaToPy(rounded);
}
