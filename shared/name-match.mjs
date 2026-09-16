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
// 오매칭은 잘못된 평형을 표시하게 되므로 "못 찾는 것"보다 나쁘다. 그래서 부분 문자열 포함은
// 허용하지 않고 접두/접미 관계만 인정하며, 후보가 2개 이상이면 법정동으로 좁히고, 그래도 좁혀지지
// 않으면 매칭을 포기한다(보류).

// 한글/영문 혼용 표기 통일 — 길이가 긴 규칙을 먼저 적용해야 부분 치환으로 어긋나지 않는다.
const ALIAS = [
  [/에스케이뷰/g, "SKVIEW"], [/SK뷰/g, "SKVIEW"],
  [/에스케이/g, "SK"], [/엘지/g, "LG"], [/지에스/g, "GS"],
  [/케이씨씨/g, "KCC"], [/케이티/g, "KT"],
  [/이편한세상/g, "E편한세상"],
  [/써미트/g, "SUMMIT"], [/써밋/g, "SUMMIT"],
  [/뷰/g, "VIEW"],
];

export const norm = (s) => String(s || "").replace(/\s/g, "");

// 매칭 비교용 키 — 표기 차이를 최대한 지운 형태. 저장 키로는 쓰지 않는다(사람이 못 읽음).
export function nameKey(s) {
  let x = norm(s).replace(/[()（）,.\-_·・'"]/g, "");
  x = x.replace(/(임대|분양)$/, "").replace(/아파트$/, "").replace(/아파트(?=\d)/g, "");
  // 1기 신도시(평촌·분당·산본 등)는 "향촌마을현대4차"처럼 하위 동네명 "마을"을 이름 중간에 붙이는 관행이
  // 있는데, 실거래·네이버 표기가 이걸 붙였다 뗐다 해서(예: 실거래 [향촌마을현대4차] ↔ 네이버 [향촌현대4차])
  // 접두/접미 규칙으론 못 잡는다(중간 삽입이라 어느 쪽도 아님) — 아예 지우고 비교(2026.09).
  x = x.replace(/마을/g, "");
  // 실거래는 "우성4"처럼 "차"/"단지"를 떼고 등록되는 경우가 많은데(네이버는 "우성4차"로 등록) 접두/접미
  // 규칙만으론 못 잡음(숫자 뒤에 글자가 "붙는" 방향이라 끝이 다름) — 숫자+차/단지 접미사를 지우고 비교.
  // 주의: "현대6차"(178세대)와 "현대6단지"(421세대)처럼 "차"와 "단지"가 실제로는 다른 동을 가리키는 경우가
  // 있어(2026.09 확인, 광진구·인천 영종구 등 88개 지역 중 2건), 이 규칙만으로 잘못 합쳐질 위험이 있다.
  // 하지만 이 함수는 "비교 키"일 뿐이고, 실제 저장은 build-hhcnt-naver.mjs가 비교키 충돌 시
  // keyIndex를 null로 막고(resolveComplexNames도 동일하게 후보 여럿이면 보류), naverLookup()의 폴백
  // 스캔도 후보 간 세대수가 다르면 포기하도록 이미 돼 있어 — 두 형태가 공존하는 단지는 자동으로
  // 매칭 보류(K-apt 폴백)되고, 한쪽만 있는(훨씬 흔한) 경우만 이 규칙으로 구제된다.
  x = x.replace(/(\d+)(차|단지)$/, "$1");
  x = x.toUpperCase();
  for (const [re, to] of ALIAS) x = x.replace(re, to);
  return x;
}

// hhcnt의 kaptAddr("서울특별시 송파구 가락동 479 헬리오시티아파트")에서 법정동만 뽑는다.
export function dongOfAddr(addr) {
  const m = String(addr || "").match(/([가-힣0-9]+(?:동|가|읍|면|리))\s+\d/);
  return m ? m[1] : "";
}

// hhcnt 단지 목록 → { 정규화된 실거래 단지명 -> hhcnt 단지 } 매핑.
// dealMeta: Map(정규화 실거래명 -> { umds:Set<법정동명> })
// 정확 일치를 먼저 전부 확정한 뒤, 남은 것만 퍼지 매칭한다(정확 일치가 항상 우선).
export function resolveComplexNames(hhItems, dealMeta) {
  const resolved = new Map(); // 실거래명(norm) -> hhcnt 단지
  const claimed = new Set();  // 이미 배정된 hhcnt 단지(중복 조회 방지)
  const items = (hhItems || []).filter((c) => c.kaptAddr && c.bjdCode);

  for (const c of items) {
    const n = norm(c.name);
    if (dealMeta.has(n) && !resolved.has(n)) { resolved.set(n, c); claimed.add(c); }
  }

  const rest = items.filter((c) => !claimed.has(c))
    .map((c) => ({ c, k: nameKey(c.name), dong: dongOfAddr(c.kaptAddr) }));

  for (const [n, meta] of dealMeta) {
    if (resolved.has(n)) continue;
    const dk = nameKey(n);
    if (dk.length < 2) continue; // 너무 짧은 이름은 오매칭 위험이 커서 아예 시도하지 않음
    let cands = rest.filter((h) => h.k === dk);
    if (!cands.length) {
      // 실거래명이 "현대"·"극동"처럼 아주 짧으면 접미 관계만 인정한다 — 대장명이 "옥수극동"처럼
      // 동네명을 앞에 붙이는 건 같은 단지지만, "신금호"→"신금호파크자이"처럼 뒤에 뭐가 더 붙는 건
      // 대개 다른 단지다(2026.09 실데이터 표본 확인).
      const shortName = dk.length <= 3;
      cands = rest.filter((h) => h.k.length >= 3 && (shortName
        ? h.k.endsWith(dk)
        : (h.k.endsWith(dk) || dk.endsWith(h.k) || h.k.startsWith(dk) || dk.startsWith(h.k))));
    }
    if (cands.length > 1) {
      // 법정동이 같은 후보만 남긴다 — "현대3차"처럼 한 구에 같은 이름이 여러 개인 경우를 가른다.
      const narrowed = cands.filter((h) => h.dong && meta.umds.has(h.dong));
      if (narrowed.length) cands = narrowed;
    }
    if (cands.length > 1) {
      // 임대/분양 동이 따로 등록된 같은 단지(예: 신당남산타운임대 / 신당남산타운(분양))는 주소가 같다.
      const addrs = new Set(cands.map((h) => h.c.kaptAddr));
      if (addrs.size === 1) cands = [cands[0]];
    }
    if (cands.length !== 1) continue; // 0개(못 찾음) 또는 2개 이상(모호) → 보류
    resolved.set(n, cands[0].c);
    claimed.add(cands[0].c);
  }
  return resolved;
}
