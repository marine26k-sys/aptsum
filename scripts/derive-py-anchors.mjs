// PY_ANCHORS(평형 보간표) 검증·개선용 분석 스크립트 (2026.09 신규)
// 목적: collect-supply-area.mjs가 지역별로 쌓아온 data/supply-area/<lawd>.json 실측값을 전부 모아서,
// 지금 areaToPy()가 쓰는 PY_ANCHORS(shared/rtms-parse.mjs)와 비교한다. 특히 130㎡ 넘는 대형 평형은
// README에 이미 "확인된 구간의 전용률 증가 추세를 연장한 추정치라 신뢰도가 낮음"이라고 적혀있는데,
// 이제 실측 데이터가 쌓였으니 그 추정을 실측으로 검증·교체할 수 있는지 확인하는 게 이 스크립트의 역할.
//
// 이 스크립트는 데이터를 고치거나 커밋하지 않는다 — 순수 리포트 출력만 함(사람이 검토 후
// shared/rtms-parse.mjs + netlify/functions/*.mjs의 PY_ANCHORS를 수동으로 갱신하는 걸 전제로 함).
// PY_ANCHORS는 3개 파일(analyze/presale/rent.mjs)+shared/rtms-parse.mjs에 사본으로 존재하므로,
// 실제로 반영할 땐 4곳 다 챙길 것(README "교훈" 참고) + CACHE_VER도 같이 올릴 것.
//
// 사용법: node scripts/derive-py-anchors.mjs [--minSamples=2]

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SQM_PER_PY = 3.3058;

// 현재 보간표(shared/rtms-parse.mjs와 반드시 동일하게 유지 — 따로 import 안 하는 이유: 이 스크립트는
// scripts/ 밖의 shared/를 프로젝트 구조상 import 가능하지만, "지금 배포된 값과 정확히 비교"하려는
// 목적이라 굳이 분리해서 사본을 여기 박아둠. shared/rtms-parse.mjs를 고치면 여기도 같이 고칠 것.
const PY_ANCHORS = [
  [29, 14], [37, 15], [39, 18], [49, 21], [50, 21], [53, 21],
  [59, 25], [60, 25], [63, 26], [68, 28], [76, 31], [77, 31],
  [84, 33], [95, 38], [97, 38], [99, 40], [105, 41], [109, 43],
  [110, 43], [113, 44], [114, 44], [116, 44], [119, 46], [129, 48],
  [130, 48], [133, 48], [134, 50], [139, 54], [143, 54], [144, 56],
  [148, 56], [150, 56], [152, 56], [156, 64], [167, 66],
];
function areaToPy(area) {
  if (!area || area <= 0) return 0;
  const A = PY_ANCHORS;
  if (area <= A[0][0]) {
    const [a0, p0] = A[0], [a1, p1] = A[1];
    return Math.round(p0 + ((area - a0) * (p1 - p0)) / (a1 - a0));
  }
  for (let i = 0; i < A.length - 1; i++) {
    const [a0, p0] = A[i], [a1, p1] = A[i + 1];
    if (area >= a0 && area <= a1) return Math.round(p0 + ((area - a0) * (p1 - p0)) / (a1 - a0));
  }
  const [a0, p0] = A[A.length - 2], [a1, p1] = A[A.length - 1];
  const slope = (p1 - p0) / (a1 - a0);
  return Math.round(p1 + (area - a1) * slope);
}

// 가중 PAVA(Pool Adjacent Violators Algorithm) — 면적이 커지는데 평형이 줄어드는 등 비단조(非單調) 구간을
// 인접 블록끼리 표본수(가중치) 가중평균으로 합쳐서 "면적↑ → 평형↑"이 항상 성립하도록 강제한다.
// (2026.08 3차 개편 때 실측 10개 단지로 "가중 PAVA 스무딩"을 이미 썼다고 코드 주석에 있어 동일 기법 재사용)
function weightedPava(points) {
  // points: [{x, y, w}], x 오름차순 정렬돼 있어야 함
  const stack = [];
  for (const p of points) {
    let block = { sumWY: p.y * p.w, sumW: p.w, xs: [p.x] };
    while (stack.length && stack[stack.length - 1].sumWY / stack[stack.length - 1].sumW > block.sumWY / block.sumW) {
      const prev = stack.pop();
      block = { sumWY: prev.sumWY + block.sumWY, sumW: prev.sumW + block.sumW, xs: [...prev.xs, ...block.xs] };
    }
    stack.push(block);
  }
  const result = new Map();
  for (const block of stack) {
    const avg = block.sumWY / block.sumW;
    for (const x of block.xs) result.set(x, avg);
  }
  return result;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const minSamples = parseInt(args.minSamples, 10) || 2; // 표본 1개짜리는 그 단지만의 특이 구조일 위험이 있어 기본 2개 이상만 신뢰

  const dir = "data/supply-area";
  let files;
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".json") && !f.startsWith("_debug_")); }
  catch { console.error(`${dir} 없음 — collect-supply-area.mjs를 먼저 돌려야 함`); process.exit(1); }

  // 반올림 전용면적 -> [{py, complex}]
  const byArea = new Map();
  let totalComplexes = 0, totalTypes = 0;
  for (const f of files) {
    const lawd = f.replace(".json", "");
    const j = JSON.parse(await readFile(path.join(dir, f), "utf-8"));
    for (const [name, types] of Object.entries(j.items || {})) {
      totalComplexes++;
      for (const t of types) {
        totalTypes++;
        const rounded = Math.round(t.exclusiveArea);
        const realPy = t.supplyArea / SQM_PER_PY; // 반올림 전 정밀값으로 평균 내고 마지막에 반올림
        if (!byArea.has(rounded)) byArea.set(rounded, []);
        byArea.get(rounded).push({ realPy, name: `${name}(${lawd})` });
      }
    }
  }

  console.log(`## PY_ANCHORS 검증 리포트`);
  console.log(`- 스캔한 지역 파일: ${files.length}개, 단지: ${totalComplexes}개, 타입: ${totalTypes}개`);
  console.log(`- 최소 표본 수 기준: ${minSamples}개 이상인 전용면적만 아래 표에 포함\n`);

  const rows = [];
  for (const [rounded, samples] of [...byArea.entries()].sort((a, b) => a[0] - b[0])) {
    if (samples.length < minSamples) continue;
    const avgRealPy = samples.reduce((s, x) => s + x.realPy, 0) / samples.length;
    const roundedRealPy = Math.round(avgRealPy);
    const currentAnchorPy = areaToPy(rounded);
    const diff = roundedRealPy - currentAnchorPy;
    const isLarge = rounded >= 125; // README상 대형(130㎡+)부터 추정치 신뢰도가 낮다고 명시된 구간 — 여유 두고 125부터 표시
    rows.push({ rounded, n: samples.length, avgRealPy: Math.round(avgRealPy * 10) / 10, roundedRealPy, currentAnchorPy, diff, isLarge, examples: samples.slice(0, 3).map((s) => s.name) });
  }

  console.log("전용면적(㎡) | 표본수 | 실측 평균 평형 | 현재 보간표 값 | 차이 | 예시 단지");
  console.log("---|---|---|---|---|---");
  for (const r of rows) {
    const flag = Math.abs(r.diff) >= 2 ? " ⚠️" : "";
    const largeTag = r.isLarge ? "🔶" : "";
    console.log(`${largeTag}${r.rounded} | ${r.n} | ${r.avgRealPy}평 | ${r.currentAnchorPy}평 | ${r.diff >= 0 ? "+" : ""}${r.diff}${flag} | ${r.examples.join(", ")}`);
  }

  // 125㎡ 이상 구간만 따로 추려서 "실측 기반 새 앵커 후보" 제안 — 사람이 검토 후 수동 반영
  const largeRows = rows.filter((r) => r.isLarge);
  if (largeRows.length) {
    // 표본 1개짜리 극단치(고급 주상복합 등)가 통계를 왜곡해서 "면적↑인데 평형↓"처럼 비단조 구간이
    // 그대로 나오는 걸 막기 위해, 전체 구간(작은 평형 포함)에 가중 PAVA를 걸어 단조 증가를 강제한다.
    // 표본수(n)를 가중치로 써서, 표본이 많은 지점의 영향력이 크도록 함.
    const allPoints = rows.map((r) => ({ x: r.rounded, y: r.avgRealPy, w: r.n })).sort((a, b) => a.x - b.x);
    const smoothed = weightedPava(allPoints);

    console.log(`\n## 대형 평형(125㎡+) 실측 기반 앵커 후보 — 가중 PAVA 스무딩 적용 (참고용, 검토 후 수동 반영할 것)`);
    console.log("면적↑ → 평형↑이 항상 성립하도록 표본수 가중 평균으로 인접 구간을 합쳐 보정한 값입니다:");
    console.log(largeRows.map((r) => `  [${r.rounded}, ${Math.round(smoothed.get(r.rounded))}], // 원본 평균 ${r.avgRealPy}평, 표본 ${r.n}개`).join("\n"));
    console.log(`\n⚠️ 표본수(n)가 1~2개인 지점은 여전히 신뢰도가 낮습니다. 지역을 더 모아서(--minSamples=3 이상 권장) 재실행 후, 그래도 표본이 부족한 지점은 기존 추정치를 유지하는 게 안전합니다.`);
  } else {
    console.log(`\n대형 평형(125㎡+) 구간에 표본이 ${minSamples}개 이상인 전용면적이 아직 없음 — 배치를 더 돌려서 데이터를 쌓은 뒤 다시 실행할 것.`);
  }
}

main();
