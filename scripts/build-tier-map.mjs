// 급지(가격 등급) 대시보드 데이터 생성 (2026.09 신규 — subuji-main 참고)
// 목적: 이미 collect-trades.mjs가 쌓아온 data/analyze/<lawd>/<ym>.json 매매 실거래를 스캔해서,
// 단지별 "평단가(공급면적 기준, 3.3㎡=1평당 가격)"를 뽑고 가격대별 6단계 등급(최상급지~하급지)으로
// 나눈 data/tier-map.json을 만든다. 순수 배치 도구 — API 호출 없음, 이미 있는 데이터만 재가공.
//
// 대상 범위: 서울·경기·부산만(수민 요청, 2026.09) — REGIONS엔 인천도 있지만 이 대시보드는 세 곳만
// 다룬다. ALL_REGIONS를 그대로 순회하되 provinceOf()로 인천 폴더는 걸러낸다.
//
// "평단가" 계산(2026.09 2차 개편 — index.html의 "전용면적 평단가"(pyprice) 탭과 같은 골격, 기준만 다름):
// 1) 단지+평형(공급면적 기준 평형 라벨, 아래 참고)별로 "최근 2년 내 최고가" 거래 1건을 뽑는다(표본이
//    1건뿐인 평형은 이상치 방지로 제외 — pyprice 탭과 동일 원칙, 우연히 섞인 이례적 면적 1건이 대표로
//    잘못 뽑히는 걸 막음).
// 2) 그렇게 나온 평형별 최고가를 각 평형의 평단가로 환산한 뒤, 그중 평단가가 가장 높은 평형 딱 1개를
//    그 단지의 대표값으로 채택 — 같은 단지라도 소형평이 대형평보다 평단가가 높은 경우가 흔해서(동일
//    단지 안에서도 평형별 프리미엄 차이가 큼), 대표 평형을 고정하지 않고 자동 선정.
//
// "공급면적 기준"이라는 점이 index.html의 pyprice 탭과 다른 부분(수민 요청, 2026.09): 국토부 실거래
// API는 전용면적만 주기 때문에, pyprice 탭은 정밀도를 위해 일부러 보간 없이 "전용면적÷3.3058"로
// 계산한다(화면에도 "전용면적 평단가"라고 명시). 반면 이 대시보드는 애초에 정밀 분석이 아니라 근사
// 등급 표시가 목적이라, 사람들이 흔히 말하는 "평당가"(공급면적 기준) 감각에 맞추는 걸 우선시했음.
// 정밀 계산 대신 collect-trades.mjs가 각 거래에 이미 붙여둔 t.py(공급면적 관행 기준 평형 라벨 —
// shared/rtms-parse.mjs의 areaToPy(), data/supply-area 실측치로 보정된 보간표)를 그대로 재사용한다.
//
// 사용법: node scripts/build-tier-map.mjs [--months=24]

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_REGIONS } from "../shared/regions.mjs";

// 평단가(만원/평, 공급면적 기준) 기준 6단계 — 국민평형(전용 84㎡≈공급면적 기준 33평) 총액 등급
// (30/20/15/11/8억)을 33평으로 나눠 평당가로 재환산한 값(9000/6000/4500/3300/2400만원/평)을
// 라운딩해 사용. 지방은 대부분 5~6등급에 몰릴 수 있는데, 이건 버그가 아니라 실제 가격 격차를
// 반영하는 것(README에도 이렇게 기록해둘 것).
const GRADES = [
  { g: 1, label: "최상급지", band: "평당 9,000만원 이상", color: "#b71c1c", min: 9000 },
  { g: 2, label: "상급지", band: "평당 6,000만~9,000만원", color: "#e64a19", min: 6000 },
  { g: 3, label: "중상급지", band: "평당 4,500만~6,000만원", color: "#f57f17", min: 4500 },
  { g: 4, label: "중급지", band: "평당 3,300만~4,500만원", color: "#00828A", min: 3300 },
  { g: 5, label: "중하급지", band: "평당 2,400만~3,300만원", color: "#0277bd", min: 2400 },
  { g: 6, label: "하급지", band: "평당 2,400만원 미만", color: "#546e7a", min: 0 },
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
const ALLOWED_PROVINCES = new Set(["서울", "경기", "부산"]); // 인천은 이 대시보드에서 제외(수민 요청)
const MIN_SAMPLES_PER_TYPE = 2; // 평형별 표본이 1건뿐이면 이상치 방지로 대표 후보에서 제외(pyprice 탭과 동일 원칙)

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const months = parseInt(args.months, 10) || 24; // "2년 내 최고가" 기준(수민 요청, 2026.09) — 기존 6개월(최근 시세 스냅샷)에서 변경

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

  // "구|동|단지명|평형(py)" -> { maxAmt, count } — 평형 단위로 2년 내 최고가와 표본 수를 집계
  const pyGroups = new Map();
  let totalTx = 0;

  for (const lawd of lawdDirs) {
    const region = LAWD_TO_REGION.get(lawd);
    if (!region) continue; // 분구 코드 등 REGIONS에 없는 폴더는 스킵(현재 배치 구조상 안 생기지만 방어)
    const province = provinceOf(region, lawd);
    if (!ALLOWED_PROVINCES.has(province)) continue; // 인천 등 대상 외 지역 폴더는 통째로 스킵
    let ymFiles;
    try { ymFiles = (await readdir(path.join(analyzeDir, lawd))).filter((f) => f.endsWith(".json")); }
    catch { continue; }
    for (const f of ymFiles) {
      const ym = f.replace(".json", "");
      if (!recentYms.has(ym)) continue;
      let j;
      try { j = JSON.parse(await readFile(path.join(analyzeDir, lawd, f), "utf-8")); }
      catch { continue; }
      for (const t of j.items || []) {
        if (t.direct) continue; // 직거래 제외 — 사이트 다른 탭과 동일 원칙
        if (!(t.py > 0)) continue; // areaToPy 실패(면적 정보 없음 등)로 평형을 못 정한 거래는 평단가 계산 불가
        totalTx++;
        const pk = `${region}|${t.umd}|${t.apt}|${t.py}`;
        const g = pyGroups.get(pk) || { region, province, dong: t.umd, name: t.apt, py: t.py, maxAmt: -Infinity, count: 0 };
        g.count++;
        if (t.amt > g.maxAmt) g.maxAmt = t.amt; // "2년 내 최고가"
        pyGroups.set(pk, g);
      }
    }
  }

  // hhcnt(세대수/준공연도) 조인 — 있으면 참고 정보로 붙임(없어도 등급 계산엔 지장 없음)
  const hhcntDir = "data/hhcnt";
  const hhLookup = new Map(); // "구|단지명(공백제거)" -> {hh, by}
  try {
    for (const f of await readdir(hhcntDir)) {
      if (!f.endsWith(".json")) continue;
      const lawd = f.replace(".json", "");
      const region = LAWD_TO_REGION.get(lawd);
      if (!region) continue;
      const j = JSON.parse(await readFile(path.join(hhcntDir, f), "utf-8"));
      for (const c of j.items || []) {
        const norm = String(c.name || "").replace(/\s/g, "");
        hhLookup.set(`${region}|${norm}`, { hh: c.hhcnt ?? null, by: c.useDate ? parseInt(String(c.useDate).slice(0, 4), 10) : null });
      }
    }
  } catch { /* hhcnt 없어도 계속 진행 */ }

  // 단지별로 평형(py) 중 평단가가 가장 높은 것 1개만 대표로 채택
  const byComplex = new Map(); // "구|동|단지명" -> 대표 평형 그룹 + ppy
  for (const g of pyGroups.values()) {
    if (g.count < MIN_SAMPLES_PER_TYPE) continue; // 표본 1건뿐인 평형은 대표 후보에서 제외
    const ck = `${g.region}|${g.dong}|${g.name}`;
    const ppy = Math.round((g.maxAmt * 10000) / g.py); // 평단가(만원/평) = 2년 내 최고가(만원) ÷ 공급면적 기준 평형
    const cur = byComplex.get(ck);
    if (!cur || ppy > cur.ppy) byComplex.set(ck, { ...g, ppy });
  }

  const result = [];
  for (const c of byComplex.values()) {
    const hh = hhLookup.get(`${c.region}|${String(c.name).replace(/\s/g, "")}`) || {};
    result.push({
      gu: c.region, province: c.province, dong: c.dong, nm: c.name,
      ppy: c.ppy, py: c.py, // 평단가(만원/평), 대표로 채택된 평형(참고용)
      g: gradeOf(c.ppy),
      hh: hh.hh ?? null, by: hh.by ?? null,
    });
  }
  result.sort((a, b) => b.ppy - a.ppy);

  const gradesOut = GRADES.map((g) => {
    const inGrade = result.filter((c) => c.g === g.g);
    const avg = inGrade.length ? Math.round(inGrade.reduce((s, c) => s + c.ppy, 0) / inGrade.length) : 0;
    return { g: g.g, label: g.label, band: g.band, color: g.color, count: inGrade.length, avg };
  });

  // 지역(구/시)별 대장주(평단가 최고 단지) 1개씩 — province 태그를 같이 들고 있어 프론트에서
  // 서울/경기/부산별로 묶어 히트맵으로 그릴 수 있음
  const byRegion = new Map();
  for (const c of result) {
    if (!byRegion.has(c.gu) || byRegion.get(c.gu).ppy < c.ppy) byRegion.set(c.gu, c);
  }
  const flagships = [...byRegion.values()].sort((a, b) => b.ppy - a.ppy);

  const out = {
    meta: {
      generated: new Date().toISOString(),
      tx: totalTx,
      complexes: result.length,
      months,
      provinces: ["서울", "경기", "부산"],
      basis: `단지+평형별 최근 ${months}개월(약 ${Math.round(months/12*10)/10}년) 내 최고가 기준, 평형 중 평단가(공급면적 기준, 3.3㎡=1평) 최고치를 단지 대표값으로 채택 — 서울·경기·부산 대상`,
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
