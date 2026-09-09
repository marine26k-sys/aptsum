// 급지(가격 등급) 대시보드 데이터 생성 (2026.09 신규 — subuji-main 참고)
// 목적: 이미 collect-trades.mjs가 쌓아온 data/analyze/<lawd>/<ym>.json 매매 실거래를 스캔해서,
// 단지별 "국민평형(전용 84㎡) 환산가"를 뽑고 가격대별 6단계 등급(최상급지~하급지)으로 나눈
// data/tier-map.json을 만든다. 순수 배치 도구 — API 호출 없음, 이미 있는 데이터만 재가공.
//
// "환산가" 계산: 그 단지의 최근 거래 중 전용 81~87㎡(84타입) 거래가 있으면 그중 가장 최근 것을 그대로
// 쓰고, 없으면 그 단지에서 구할 수 있는 가장 최근 거래를 "가격 ∝ 전용면적"으로 선형 환산한다(정밀
// 감정평가가 아니라 "이 단지가 대략 어느 급지인가"를 보여주는 대시보드용 근사치임 — 화면에도 명시할 것).
//
// 사용법: node scripts/build-tier-map.mjs [--months=6]

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_REGIONS } from "../shared/regions.mjs";

const NATIONAL_TYPE_AREA = 84; // "국민평형" 기준 전용면적(㎡)
const TYPE_TOLERANCE = 3; // 84±3㎡(81~87㎡)까지는 실측 그대로 인정, 벗어나면 선형 환산

// subuji-main과 동일한 6단계 가격대(단위: 억) — 수도권·서울 시세 감각 기준. 지방은 대부분 5~6등급에
// 몰릴 수 있는데, 이건 버그가 아니라 실제 가격 격차를 반영하는 것(README에도 이렇게 기록해둘 것).
const GRADES = [
  { g: 1, label: "최상급지", band: "30억 이상", color: "#b71c1c", min: 30 },
  { g: 2, label: "상급지", band: "20억~30억", color: "#e64a19", min: 20 },
  { g: 3, label: "중상급지", band: "15억~20억", color: "#f57f17", min: 15 },
  { g: 4, label: "중급지", band: "11억~15억", color: "#00828A", min: 11 },
  { g: 5, label: "중하급지", band: "8억~11억", color: "#0277bd", min: 8 },
  { g: 6, label: "하급지", band: "8억 미만", color: "#546e7a", min: 0 },
];
function gradeOf(eok) {
  for (const g of GRADES) if (eok >= g.min) return g.g;
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

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const months = parseInt(args.months, 10) || 6; // 최근 N개월 거래만 봄(오래된 거래로 지금 시세 판단하면 왜곡)

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

  // complexKey(구|동|단지명) -> { latest84: {amt,ym,d}, latestAny: {amt,ym,d,area} }
  const complexes = new Map();
  let totalTx = 0;

  for (const lawd of lawdDirs) {
    const region = LAWD_TO_REGION.get(lawd);
    if (!region) continue; // 분구 코드 등 REGIONS에 없는 폴더는 스킵(현재 배치 구조상 안 생기지만 방어)
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
        totalTx++;
        const key = `${region}|${t.umd}|${t.apt}`;
        const c = complexes.get(key) || { region, dong: t.umd, name: t.apt, latest84: null, latestAny: null };
        const ymd = `${t.ym}${t.d}`;
        if (Math.abs(t.area - NATIONAL_TYPE_AREA) <= TYPE_TOLERANCE) {
          if (!c.latest84 || ymd > c.latest84.ymd) c.latest84 = { amt: t.amt, ymd, area: t.area };
        }
        if (!c.latestAny || ymd > c.latestAny.ymd) c.latestAny = { amt: t.amt, ymd, area: t.area };
        complexes.set(key, c);
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

  const result = [];
  for (const c of complexes.values()) {
    let p84Eok; // 억 단위
    if (c.latest84) {
      p84Eok = c.latest84.amt;
    } else if (c.latestAny && c.latestAny.area > 0) {
      p84Eok = c.latestAny.amt * (NATIONAL_TYPE_AREA / c.latestAny.area); // 선형 환산(근사치)
    } else {
      continue; // 쓸 거래가 아예 없으면 스킵
    }
    const hh = hhLookup.get(`${c.region}|${String(c.name).replace(/\s/g, "")}`) || {};
    result.push({
      gu: c.region, dong: c.dong, nm: c.name,
      p84: Math.round(p84Eok * 10000), // 만원 단위(subuji-main과 동일 컨벤션)
      estimated: !c.latest84, // true면 84타입 실거래가 아니라 선형 환산값이라는 표시
      g: gradeOf(p84Eok),
      hh: hh.hh ?? null, by: hh.by ?? null,
    });
  }
  result.sort((a, b) => b.p84 - a.p84);

  const gradesOut = GRADES.map((g) => {
    const inGrade = result.filter((c) => c.g === g.g);
    const avg = inGrade.length ? Math.round(inGrade.reduce((s, c) => s + c.p84, 0) / inGrade.length) : 0;
    return { g: g.g, label: g.label, band: g.band, color: g.color, count: inGrade.length, avg };
  });

  // 지역(구/시)별 대장주(최고가 단지) 1개씩
  const byRegion = new Map();
  for (const c of result) {
    if (!byRegion.has(c.gu) || byRegion.get(c.gu).p84 < c.p84) byRegion.set(c.gu, c);
  }
  const flagships = [...byRegion.values()].sort((a, b) => b.p84 - a.p84);

  const out = {
    meta: {
      generated: new Date().toISOString(),
      tx: totalTx,
      complexes: result.length,
      months,
      basis: `국민평형(전용 84±${TYPE_TOLERANCE}㎡) 최근 거래 기준, 없으면 보유 거래를 면적 비례로 선형 환산한 근사치`,
    },
    grades: gradesOut,
    complexes: result,
    flagships,
  };

  await writeFile("data/tier-map.json", JSON.stringify(out));
  console.log(`완료: 단지 ${result.length}개, 거래 ${totalTx}건 스캔`);
  for (const g of gradesOut) console.log(`  ${g.label}(${g.band}): ${g.count}개, 평균 ${(g.avg / 10000).toFixed(1)}억`);
}

main();
