// 실거래 단지명 ↔ 건축물대장(K-apt, data/hhcnt) 단지명 매칭 유틸 — 2026.09 신설.
//
// 배경: scripts/collect-supply-area.mjs는 "hhcnt 단지명 == 실거래 단지명"이 정확히 일치할 때만
// 그 단지를 수집 대상으로 삼았다. 그런데 두 데이터의 표기 관행이 서로 달라서 일치율이 23%뿐이었고
// (실거래 24개월 기준 거래 건수의 25%), 헬리오시티·리센츠·파크리오 같은 대형 단지가 통째로
// 수집 대상에서 빠져 있었다. 실제로 확인된 표기 차이 패턴:
//   실거래 [헬리오시티]            ↔ 대장 [헬리오시티아파트]        — "아파트" 접미사
//   실거래 [리센츠]                ↔ 대장 [잠실리센츠]              — 지역명 접두사
//   실거래 [경희궁자이(3단지)]      ↔ 대장 [경희궁자이3단지]         — 괄호 표기
//   실거래 [약수하이츠]            ↔ 대장 [약수하이츠아파트(임대)]   — 임대/분양 구분 표기
//   실거래 [에스케이북한산시티]     ↔ 대장 [SK북한산시티아파트]      — 한글/영문 혼용
//   실거래 [매교역푸르지오SKVIEW]  ↔ 대장 [매교역푸르지오SK뷰아파트] — 뷰/VIEW 혼용
//
// naver의 정규화·매칭 규칙을 공통 모듈로 사용한다. 법정동을 먼저 좁히고,
// 세대수가 확인된 경우 K-apt와 일치해야 하며, 관리단지 후보가 여러 개면 보류한다.

import { naverNameKey, matchNaverTradeNames, sameHouseholds } from "./naver-name-match.mjs";
export const norm = (s) => String(s || "").replace(/\s/g, "");
export const nameKey = naverNameKey;

// hhcnt의 kaptAddr("서울특별시 송파구 가락동 479 헬리오시티아파트")에서 법정동만 뽑는다.
export function dongOfAddr(addr) {
  const m = String(addr || "").match(/((?:[가-힣0-9]+(?:읍|면)\s+)?[가-힣0-9]+(?:동|가|읍|면|리))\s+\d/);
  return m ? m[1] : "";
}

// hhcnt 단지 목록 → { 정규화된 실거래 단지명 -> hhcnt 단지 } 매핑.
// dealMeta: Map(정규화 실거래명 -> { umds:Set<법정동명> })
// 정확 일치를 먼저 전부 확정한 뒤, 남은 것만 퍼지 매칭한다(정확 일치가 항상 우선).
export function resolveComplexNames(hhItems, dealMeta) {
  const resolved = new Map();
  const items = (hhItems || []).filter(c => c.kaptAddr && c.bjdCode);
  const claims = new Map();
  for (const c of items) {
    const dong = dongOfAddr(c.kaptAddr);
    const candidates = new Map();
    for (const [n, meta] of dealMeta) {
      if (!dong || !meta.umds?.has(dong)) continue;
      if (meta.hh != null && !sameHouseholds(meta.hh, c.hhcnt)) continue;
      const key = nameKey(n, dong);
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push({ name: n, meta });
    }
    const local = items.filter(h => dongOfAddr(h.kaptAddr) === dong);
    const reserved = new Set(local.map(h => nameKey(h.name, dong)));
    const owners = new Map();
    for (const h of local) {
      const key = nameKey(h.name, dong);
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(h.kaptCode || h.kaptAddr);
    }
    const ambiguous = new Set([...owners].filter(([, ids]) => ids.size > 1).map(([key]) => key));
    const hits = matchNaverTradeNames(candidates, c.name, dong, { reserved, ambiguous });
    for (const hit of hits) {
      if (!claims.has(hit.name)) claims.set(hit.name, []);
      claims.get(hit.name).push(c);
    }
  }
  for (const [name, cands] of claims) {
    const codes = new Set(cands.map(c => c.kaptCode || c.kaptAddr));
    if (codes.size === 1) resolved.set(name, cands[0]);
  }
  return resolved;
}
