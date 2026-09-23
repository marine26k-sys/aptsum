// 급지(가격 등급) 대시보드 데이터 생성 (2026.09 신규 — subuji-main 참고)
// 목적: 이미 collect-trades.mjs가 쌓아온 data/analyze/<lawd>/<ym>.json 매매 실거래를 스캔해서,
// 단지별 "평단가(공급면적 기준, 3.3㎡=1평당 가격)"를 뽑고 가격대별 6단계 등급(최상급지~하급지)으로
// 나눈 data/tier-map.json을 만든다. 순수 배치 도구 — API 호출 없음, 이미 있는 데이터만 재가공.
//
// 대상 범위: 서울·경기·인천·부산(2026.09 인천 재포함, 운영자 요청) — REGIONS에 있는 4개 시·도 전부 다룬다.
//
// "평단가" 계산(2026.09 2차 개편 — index.html의 "전용면적 평단가"(pyprice) 탭과 같은 골격, 기준만 다름):
// 1) 단지+평형(공급면적 기준 평형 라벨, 아래 참고)별로 "최근 3년(기본 36개월) 내 최고가" 거래 1건을 뽑는다(표본이
//    1건뿐인 평형은 이상치 방지로 제외 — pyprice 탭과 동일 원칙, 우연히 섞인 이례적 면적 1건이 대표로
//    잘못 뽑히는 걸 막음).
// 2) 그렇게 나온 평형별 최고가를 각 평형의 평단가로 환산한 뒤, 그중 평단가가 가장 높은 평형 딱 1개를
//    그 단지의 대표값으로 채택 — 같은 단지라도 소형평이 대형평보다 평단가가 높은 경우가 흔해서(동일
//    단지 안에서도 평형별 프리미엄 차이가 큼), 대표 평형을 고정하지 않고 자동 선정.
//    단, 후보는 20~39평 범위로 한정(2026.09, 운영자 요청) — 초소형(원룸/오피스텔급) 평형이 이례적으로
//    높은 평단가를 찍어 대표값으로 잘못 뽑히는 걸 막기 위함. 이 범위에 해당하는 평형이 하나도 없는
//    단지는 급지 지도 목록에서 통째로 빠진다(의도된 동작).
//
// "공급면적 기준"이라는 점이 index.html의 pyprice 탭과 다른 부분(운영자 요청, 2026.09): 국토부 실거래
// API는 전용면적만 주기 때문에, pyprice 탭은 정밀도를 위해 일부러 보간 없이 "전용면적÷3.3058"로
// 계산한다(화면에도 "전용면적 평단가"라고 명시). 반면 이 대시보드는 애초에 정밀 분석이 아니라 근사
// 등급 표시가 목적이라, 사람들이 흔히 말하는 "평당가"(공급면적 기준) 감각에 맞추는 걸 우선시했음.
// 정밀 계산 대신 collect-trades.mjs가 각 거래에 이미 붙여둔 t.py(공급면적 관행 기준 평형 라벨 —
// shared/rtms-parse.mjs의 areaToPy(), data/supply-area 실측치로 보정된 보간표)를 그대로 재사용한다.
//
// 사용법: node scripts/build-tier-map.mjs [--months=36]

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_REGIONS } from "../shared/regions.mjs";
import { resolveComplexNames } from "../shared/name-match.mjs";

// 평단가(만원/평, 공급면적 기준) 기준 6단계 — 국민평형(전용 84㎡≈공급면적 기준 33평) 총액 등급
// (30/20/15/11/8억)을 33평으로 나눠 평당가로 재환산한 값(9000/6000/4500/3300/2400만원/평)을
// 라운딩해 사용. 지방은 대부분 5~6등급에 몰릴 수 있는데, 이건 버그가 아니라 실제 가격 격차를
// 반영하는 것(README에도 이렇게 기록해둘 것).
const GRADES = [
  { g: 1, label: "최상급지", band: "평당 0.90억 이상", color: "#b71c1c", min: 9000 },
  { g: 2, label: "상급지", band: "평당 0.60억~0.90억", color: "#e64a19", min: 6000 },
  { g: 3, label: "중상급지", band: "평당 0.45억~0.60억", color: "#f57f17", min: 4500 },
  { g: 4, label: "중급지", band: "평당 0.33억~0.45억", color: "#00828A", min: 3300 },
  { g: 5, label: "중하급지", band: "평당 0.24억~0.33억", color: "#0277bd", min: 2400 },
  { g: 6, label: "하급지", band: "평당 0.24억 미만", color: "#546e7a", min: 0 },
];
function gradeOf(manwonPerPy) {
  for (const g of GRADES) if (manwonPerPy >= g.min) return g.g;
  return GRADES[GRADES.length - 1].g;
}

const LAWD_TO_REGION = new Map(ALL_REGIONS.map(([name, code]) => [code, name]));
// 지역명 -> 대분류(서울/경기/인천/부산) — REGIONS 원본 구조에서 역으로 추출
function buildProvinceMap() {
  // shared/regions.mjs가 REGIONS를 export 안 하고 평탄화된 ALL_REGIONS만 export하므로,
  // 여기선 지역명 접두어로 대략 구분(서울 25구는 REGIONS[0]과 이름이 고정돼 있어 안전하게 매핑 가능).
  const SEOUL_GU = new Set(["강남구","강동구","강북구","강서구","관악구","광진구","구로구","금천구","노원구","도봉구","동대문구","동작구","마포구","서대문구","서초구","성동구","성북구","송파구","양천구","영등포구","용산구","은평구","종로구","중구","중랑구"]);
  return (region, lawd) => {
    if (SEOUL_GU.has(region) && !lawd.startsWith("26")) return "서울";
    if (lawd.startsWith("26")) return "부산";
    if (lawd.startsWith("28") || lawd.startsWith("IC-")) return "인천";
    return "경기";
  };
}
const provinceOf = buildProvinceMap();
const ALLOWED_PROVINCES = new Set(["서울", "경기", "인천", "부산"]); // 2026.09 인천 재포함(운영자 요청) — 원래도 배치 수집 대상이었는데 대시보드에서만 빼뒀던 것
const MIN_SAMPLES_PER_TYPE = 2; // 평형별 표본이 1건뿐이면 이상치 방지로 대표 후보에서 제외(pyprice 탭과 동일 원칙)
const PY_MIN = 20, PY_MAX = 39; // 대표 평형 후보를 20~39평 범위로 한정(2026.09, 운영자 요청) — 초소형/초대형 평형의
// 이례적 평단가가 단지 대표값으로 잘못 뽑히는 걸 막기 위함. 범위 밖 평형은 표본이 많아도 대표 후보에서 제외.

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const months = parseInt(args.months, 10) || 36; // "3년 내 최고가" 기준(운영자 요청, 2026.09) — 6개월 → 2년 → 3년으로 변경

  const analyzeDir = "data/analyze";
  let lawdDirs;
  try { lawdDirs = await readdir(analyzeDir); }
  catch { console.error(`${analyzeDir} 없음 — collect-trades.mjs가 먼저 돌아야 함`); process.exit(1); }

  // 최근 N개월 ym 목록(YYYYMM) 계산
  const now = new Date();
  const recentYms = new Set();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    recentYms.add(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // "구|동|단지명|평형(py)" -> { maxAmt, count } — 평형 단위로 기간 내 최고가와 표본 수를 집계
  const pyGroups = new Map();
  // 단지명 표기가 "청담 르엘"/"청담르엘"처럼 띄어쓰기만 다른 경우 서로 다른 단지로 갈라져 급지 목록에
  // 중복으로 뜨던 문제(2026.09 제보) — 그룹 키는 공백을 제거한 이름으로 통일해서 합치되, 화면에 보여줄
  // 이름은 실제 등장한 표기 중 가장 많이 쓰인 것을 그대로 채택한다(index.html의 여러 이름-정규화 로직과
  // 동일 원칙). "구|동|정규화된 단지명" -> {원문 표기: 등장 횟수}
  const nameVariantsByCk = new Map();
  let totalTx = 0;
  // lawd -> Map(정규화 실거래명 -> {umds:Set<법정동명>}) — hhcnt 퍼지 매칭(resolveComplexNames)에 필요한
  // "이 이름이 어느 동에서 나왔는지" 정보. lawd별로 collect-supply-area.mjs와 동일한 방식으로 매칭한다.
  const dealMetaByLawd = new Map();

  // presale 디렉토리(data/presale/<lawd>/<ym>.json)도 매매(analyze)와 동일한 방식으로 함께 스캔한다.
  // (2026.09 버그 수정: 원래 이 스크립트가 analyzeDir만 읽어서, 준공 전이라 매매 실거래가 아예 없고
  // 분양권·입주권 거래만 있는 신축 단지는 급지 지도 단지 목록·히트맵에서 통째로 빠졌었음 — 검단·청라
  // 같은 신축 밀집 지역에서 특히 눈에 띔. 사이트의 다른 랭킹 탭들(단지분석·연간 저평가 등)은 이미
  // 매매+분양권을 합쳐서 보여주므로 여기도 맞춤. 단, 이 배치는 index.html의 mergeTradeAndPresaleForRanking처럼
  // 정교한 단지명 정규화·매칭을 하지 않고 원문 그대로 그룹핑한다 — 표기가 완전히 같으면 매매와 자동으로
  // 합쳐지고, 다르면 별도 항목으로 집계된다(간단하지만 "목록에서 아예 빠지는" 문제는 해결).
  const presaleDir = "data/presale";

  for (const lawd of lawdDirs) {
    const region = LAWD_TO_REGION.get(lawd);
    if (!region) continue; // 분구 코드 등 REGIONS에 없는 폴더는 스킵(현재 배치 구조상 안 생기지만 방어)
    const province = provinceOf(region, lawd);
    if (!ALLOWED_PROVINCES.has(province)) continue; // 인천 등 대상 외 지역 폴더는 통째로 스킵

    for (const [dir, isPresale] of [[analyzeDir, false], [presaleDir, true]]) {
      let ymFiles;
      try { ymFiles = (await readdir(path.join(dir, lawd))).filter((f) => f.endsWith(".json")); }
      catch { continue; } // 매매·분양권 중 한쪽 폴더가 아직 없는 지역도 있으므로 개별적으로 스킵
      for (const f of ymFiles) {
        const ym = f.replace(".json", "");
        if (!recentYms.has(ym)) continue;
        let j;
        try { j = JSON.parse(await readFile(path.join(dir, lawd, f), "utf-8")); }
        catch { continue; }
        for (const t of j.items || []) {
          if (t.direct) continue; // 직거래 제외 — 사이트 다른 탭과 동일 원칙
          if (!(t.py > 0)) continue; // areaToPy 실패(면적 정보 없음 등)로 평형을 못 정한 거래는 평단가 계산 불가
          totalTx++;
          const nameNorm = String(t.apt).replace(/\s/g, ""); // 띄어쓰기 표기 차이 통합용 키(화면 표기는 아래서 별도 채택)
          const ck = `${region}|${t.umd}|${nameNorm}`;
          const pk = `${ck}|${t.py}`;
          const g = pyGroups.get(pk) || { region, province, dong: t.umd, name: nameNorm, py: t.py, maxAmt: -Infinity, area: null, count: 0, presaleOnly: true };
          g.count++;
          if (!isPresale) g.presaleOnly = false; // 매매 거래가 한 건이라도 섞이면 더 이상 "분양권 전용"이 아님
          if (t.amt > g.maxAmt) { g.maxAmt = t.amt; g.area = t.area || null; } // "기간 내 최고가"와 그 거래의 전용면적(㎡)
          pyGroups.set(pk, g);
          const variants = nameVariantsByCk.get(ck) || {};
          variants[t.apt] = (variants[t.apt] || 0) + 1;
          nameVariantsByCk.set(ck, variants);
          let dealMeta = dealMetaByLawd.get(lawd);
          if (!dealMeta) { dealMeta = new Map(); dealMetaByLawd.set(lawd, dealMeta); }
          let dm = dealMeta.get(nameNorm);
          if (!dm) { dm = { umds: new Set() }; dealMeta.set(nameNorm, dm); }
          if (t.umd) dm.umds.add(t.umd);
        }
      }
    }
  }

  // hhcnt(세대수/준공연도) 조인 — 있으면 참고 정보로 붙임(없어도 등급 계산엔 지장 없음).
  // 예전엔 "hhcnt 단지명과 실거래 단지명이 공백 제거 후 글자까지 똑같을 때"만 매칭해서 일치율이
  // 20% 안팎이었음(collect-supply-area.mjs가 동일한 문제를 겪고 고친 이력 — 위 367번째 줄 주석 참고).
  // shared/name-match.mjs의 resolveComplexNames로 교체(표기 차이 흡수 + 법정동으로 후보 좁히기,
  // 2026.09 발견 — 82%가 세대수/년식 미표시였음).
  const hhcntDir = "data/hhcnt";
  const hhLookup = new Map(); // "구|단지명(공백제거)" -> {hh, by}
  try {
    for (const f of await readdir(hhcntDir)) {
      if (!f.endsWith(".json")) continue;
      const lawd = f.replace(".json", "");
      const region = LAWD_TO_REGION.get(lawd);
      if (!region) continue;
      const j = JSON.parse(await readFile(path.join(hhcntDir, f), "utf-8"));
      const dealMeta = dealMetaByLawd.get(lawd) || new Map();
      const resolved = resolveComplexNames(j.items, dealMeta);
      for (const [nameNorm, c] of resolved) {
        hhLookup.set(`${region}|${nameNorm}`, { hh: c.hhcnt ?? null, by: c.useDate ? parseInt(String(c.useDate).slice(0, 4), 10) : null });
      }
    }
  } catch { /* hhcnt 없어도 계속 진행 */ }

  // 단지별로 평형(py) 중 평단가가 가장 높은 것 1개만 대표로 채택
  const byComplex = new Map(); // "구|동|정규화된 단지명" -> 대표 평형 그룹 + ppy
  for (const g of pyGroups.values()) {
    if (g.count < MIN_SAMPLES_PER_TYPE) continue; // 표본 1건뿐인 평형은 대표 후보에서 제외
    if (g.py < PY_MIN || g.py > PY_MAX) continue; // 20~39평 범위 밖 평형은 대표 후보에서 제외
    const ck = `${g.region}|${g.dong}|${g.name}`;
    const ppy = Math.round((g.maxAmt * 10000) / g.py); // 평단가(만원/평) = 기간 내 최고가(만원) ÷ 공급면적 기준 평형
    const cur = byComplex.get(ck);
    if (!cur || ppy > cur.ppy) byComplex.set(ck, { ...g, ppy });
  }

  const result = [];
  for (const [ck, c] of byComplex) {
    const hh = hhLookup.get(`${c.region}|${c.name}`) || {}; // c.name은 이미 공백 제거된 정규화 표기라 그대로 사용
    // 화면에 보여줄 이름은 실제 등장 표기 중 가장 많이 쓰인 것으로(정규화 키는 중복 제거용일 뿐 화면엔 안 씀)
    const variants = nameVariantsByCk.get(ck);
    const displayName = variants ? Object.entries(variants).sort((a, b) => b[1] - a[1])[0][0] : c.name;
    result.push({
      gu: c.region, province: c.province, dong: c.dong, nm: displayName,
      ppy: c.ppy, py: c.py, ar: c.area != null ? Math.floor(c.area) : null, // 평단가(만원/평), 대표 평형(참고용), 그 거래의 전용면적(㎡, 다른 탭과 동일하게 내림)
      amt: Math.round(c.maxAmt * 10000), // 그 평형의 기간 내 최고가(매매가, 만원 단위) — 화면에 평단가와 함께 표시
      g: gradeOf(c.ppy),
      hh: hh.hh ?? null, by: hh.by ?? null,
      presaleOnly: !!c.presaleOnly, // 매매 실거래가 아직 없어 분양권·입주권만으로 집계된 단지(프론트에서 배지 표시용)
    });
  }
  result.sort((a, b) => b.ppy - a.ppy);

  // min을 결과에도 노출(2026.09, 동별 평단가 히트맵용) — 프론트에서 단지 단위가 아니라 "동 평균 평단가"처럼
  // 새로 계산한 값을 등급 색상표에 맞춰 분류해야 하는 경우가 생겨서, 그 경계값(min)을 그대로 실어보낸다.
  const gradesOut = GRADES.map((g) => {
    const inGrade = result.filter((c) => c.g === g.g);
    const avg = inGrade.length ? Math.round(inGrade.reduce((s, c) => s + c.ppy, 0) / inGrade.length) : 0;
    return { g: g.g, label: g.label, band: g.band, color: g.color, min: g.min, count: inGrade.length, avg };
  });

  // 지역(구/시)별 대장주(평단가 최고 단지) 1개씩 — province 태그를 같이 들고 있어 프론트에서
  // 서울/경기/부산별로 묶어 히트맵으로 그릴 수 있음
  // 2026.09 버그 수정: 키를 c.gu(구 이름)만 썼더니 서울·부산에 동명 구(중구·강서구)가 있어 평단가
  // 낮은 쪽(주로 부산)이 통째로 밀려 사라지는 문제(운영자 리포트) — 8차 개편 때 목록 필터는 "시·도::구"
  // 복합키로 고쳤는데 이 집계는 그때 놓쳤던 부분. province까지 포함한 복합키로 수정.
  const byRegion = new Map();
  for (const c of result) {
    const rk = `${c.province}|${c.gu}`;
    if (!byRegion.has(rk) || byRegion.get(rk).ppy < c.ppy) byRegion.set(rk, c);
  }
  const flagships = [...byRegion.values()].sort((a, b) => b.ppy - a.ppy);

  const out = {
    meta: {
      generated: new Date().toISOString(),
      tx: totalTx,
      complexes: result.length,
      months,
      provinces: ["서울", "경기", "인천", "부산"],
      basis: `단지+평형별 최근 ${months}개월 (약 ${Math.round(months/12*10)/10}년) 내 최고가 기준 (매매·분양권·입주권 포함), ${PY_MIN}~${PY_MAX}평 범위의 평형 중 평단가 (공급면적 기준, 3.3㎡=1평) 최고치를 단지 대표값으로 채택 — 서울·경기·인천·부산 대상`,
    },
    grades: gradesOut,
    complexes: result,
    flagships,
  };

  await writeFile("data/tier-map.json", JSON.stringify(out));
  console.log(`완료: 단지 ${result.length}개, 거래 ${totalTx}건 스캔`);
  for (const g of gradesOut) console.log(`  ${g.label}(${g.band}): ${g.count}개, 평균 평당 ${g.avg.toLocaleString()}만원`);
}

main();
