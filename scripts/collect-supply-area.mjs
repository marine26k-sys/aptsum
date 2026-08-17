#!/usr/bin/env node
// 건축HUB_건축물대장정보 서비스(전유공용면적 조회)로 실제 공급면적을 확인해
// shared/supply-area-auto.mjs(자동 반영분)와 data/supply-area-review.json(검토 필요분)을 갱신한다.
//
// 흐름:
//  1) 이미 수집된 data/analyze·presale·rent/<lawd>/<ym>.json에서 단지별(apt+umd) 지번(jibun) 후보를 모은다
//     (collect-trades.mjs가 먼저 돌아 이 파일들이 있어야 함 — 이 스크립트는 그 결과물을 재사용만 함)
//  2) 단지별로 건축HUB API를 조회해 동/호 단위 전유(=전용면적)+공용면적을 합산 → 공급면적 계산
//  3) 같은 전용면적(반올림)에 대해 계산된 평형이 하나뿐이면(=타입 구분 없이 값이 일관되면) 자동 반영,
//     여러 개면(타입 A/B/C 등으로 갈리면) 자동 반영하지 않고 검토 목록에만 남김
//     — 이 캐시(자동)는 shared/supply-area.mjs의 SUPPLY_AREA_OVERRIDE(사람이 수동 등록한 값)보다
//       우선순위가 낮음. 즉 수동으로 등록해둔 값이 있으면 항상 그 값이 이긴다.
//
// 사용법:
//   DATA_GO_KR_KEY=xxx node scripts/collect-supply-area.mjs [--only=11680,HS-동탄구] [--force]
// - force: 이미 자동 반영된 (단지|umd|전용면적) 키도 다시 조회 (기본은 아직 없는 것만 조회)

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { ALL_LAWDS, SPLIT_REGIONS } from "../shared/regions.mjs";
import { resolveBjdongCd } from "../shared/bjdong-codes.mjs";
import { SUPPLY_AREA_OVERRIDE } from "../shared/supply-area.mjs";

const PUSH_RETRIES = 5;
const SQM_PER_PY = 3.3058;
const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo";
const AUTO_FILE = "shared/supply-area-auto.mjs";
const REVIEW_FILE = "data/supply-area-review.json";
const TRADE_DIRS = ["data/analyze", "data/presale", "data/rent"]; // 지번 후보를 모으는 원본(매매/분양권/전세 전부 훑음)

function pushWithRetry() {
  for (let attempt = 1; attempt <= PUSH_RETRIES; attempt++) {
    try {
      execSync("git push", { stdio: "inherit" });
      return;
    } catch (e) {
      if (attempt === PUSH_RETRIES) throw e;
      console.error(`  push 거절됨, fetch+rebase 후 재시도 (${attempt}/${PUSH_RETRIES})`);
      execSync("git fetch origin main", { stdio: "inherit" });
      execSync("git rebase origin/main", { stdio: "inherit" });
    }
  }
}

function commitProgress(message) {
  try {
    const targets = [AUTO_FILE, REVIEW_FILE].filter((p) => existsSync(p));
    if (!targets.length) return;
    execSync(`git add ${targets.join(" ")}`, { stdio: "inherit" });
    const diff = execSync("git diff --cached --name-only").toString().trim();
    if (!diff) return;
    execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: "inherit" });
    pushWithRetry();
    console.log(`  (중간 커밋 완료: ${message})`);
  } catch (e) {
    console.error("  중간 커밋 실패(계속 진행):", e.message);
    try { execSync("git rebase --abort", { stdio: "ignore" }); } catch {}
  }
}

// lawd(예: "11680", "HS-동탄구") → 실제 조회용 시군구코드(5자리) 하나. 구코드가 없으면 null.
function resolveSigunguCd(lawd) {
  if (/^\d{5}$/.test(lawd)) return lawd;
  const prefix = Object.keys(SPLIT_REGIONS).find((p) => lawd.startsWith(p));
  if (!prefix) return null;
  const guName = lawd.slice(prefix.length);
  return SPLIT_REGIONS[prefix].codes[guName] || null;
}

// "542-1" → {bun:"0542", ji:"0001"} / "542" → {bun:"0542", ji:"0000"}
// (jibun 표기가 실제로 어떤 형태로 오는지는 최초 실행 로그로 확인 필요 — 예상과 다르면 이 함수만 고치면 됨)
function parseJibun(jibun) {
  if (!jibun) return null;
  const [bunRaw, jiRaw] = String(jibun).split("-");
  const bun = (bunRaw || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
  if (!bun || bun === "0000") return null;
  const ji = (jiRaw || "0").replace(/\D/g, "").padStart(4, "0").slice(-4);
  return { bun, ji };
}

function xtag(b, name) {
  const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1].trim() : "";
}

async function readJsonSafe(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

// data/analyze|presale|rent 전체를 훑어 단지별(sigunguCd+umd+apt) 지번 후보와, 실제 등장한 전용면적(반올림) 집합을 모은다
async function collectComplexes() {
  const complexes = new Map(); // key: `${sigunguCd}|${umd}|${apt}` → { sigunguCd, umd, apt, jibuns:Set, areas:Set }

  for (const dir of TRADE_DIRS) {
    if (!existsSync(dir)) continue;
    const lawds = await readdir(dir);
    for (const lawd of lawds) {
      const sigunguCd = resolveSigunguCd(lawd);
      if (!sigunguCd) continue;
      const lawdDir = path.join(dir, lawd);
      let files;
      try { files = await readdir(lawdDir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const json = await readJsonSafe(path.join(lawdDir, f));
        if (!json || !Array.isArray(json.items)) continue;
        for (const it of json.items) {
          if (!it.apt || !it.umd || !it.jibun || !it.area) continue;
          const key = `${sigunguCd}|${it.umd}|${it.apt}`;
          if (!complexes.has(key)) {
            complexes.set(key, { sigunguCd, umd: it.umd, apt: it.apt, jibuns: new Set(), areas: new Set() });
          }
          const c = complexes.get(key);
          c.jibuns.add(it.jibun);
          c.areas.add(Math.round(it.area));
        }
      }
    }
  }
  return [...complexes.values()];
}

async function fetchExposPubuse(key, sigunguCd, bjdongCd, bun, ji) {
  const qs = new URLSearchParams({
    serviceKey: key, sigunguCd, bjdongCd, bun, ji, numOfRows: "500", pageNo: "1",
  });
  try {
    const r = await fetch(`${BASE}?${qs.toString()}`, { signal: AbortSignal.timeout(20000) });
    const xml = await r.text();
    const items = [];
    const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
    let m;
    while ((m = re.exec(xml))) {
      const b = m[1];
      items.push({
        dong: xtag(b, "dongNm"), ho: xtag(b, "hoNm"),
        gbn: xtag(b, "exposPubuseGbCdNm"), area: parseFloat(xtag(b, "area")) || 0,
      });
    }
    return items;
  } catch {
    return [];
  }
}

// 한 단지의 지번(여러 개일 수 있음) 전체를 조회해 동/호 단위로 전유+공용 합산 → { roundedExclusive: Set(py) } 반환
async function resolveComplexSupply(key, complex) {
  const bjdongCd = resolveBjdongCd(complex.sigunguCd, complex.umd);
  if (!bjdongCd) return { pyByArea: new Map(), unresolved: "bjdong" };

  const byUnit = {};
  for (const jibun of complex.jibuns) {
    const parsed = parseJibun(jibun);
    if (!parsed) continue;
    const items = await fetchExposPubuse(key, complex.sigunguCd, bjdongCd, parsed.bun, parsed.ji);
    for (const it of items) {
      const k = `${it.dong}|${it.ho}`;
      byUnit[k] = byUnit[k] || { exclusive: 0, common: 0 };
      if (it.gbn.includes("전유")) byUnit[k].exclusive += it.area;
      else byUnit[k].common += it.area;
    }
  }

  const pyByArea = new Map(); // roundedExclusive → Set(py)
  for (const u of Object.values(byUnit)) {
    if (!u.exclusive) continue;
    const rounded = Math.round(u.exclusive);
    if (!complex.areas.has(rounded)) continue; // 실거래에 실제로 등장한 전용면적만 채택
    const supply = u.exclusive + u.common;
    const py = Math.round(supply / SQM_PER_PY);
    if (!pyByArea.has(rounded)) pyByArea.set(rounded, new Set());
    pyByArea.get(rounded).add(py);
  }
  return { pyByArea, unresolved: null };
}

async function pool(items, limit, worker) {
  let i = 0;
  async function run() { while (i < items.length) { const idx = i++; await worker(items[idx]); } }
  await Promise.all(Array.from({ length: limit }, run));
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) { console.error("DATA_GO_KR_KEY 환경변수가 없습니다."); process.exit(1); }
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }));
  const onlyLawds = args.only ? String(args.only).split(",") : null;
  const force = !!args.force;

  console.log("[supply-area] 실거래 데이터에서 단지 지번 후보 수집 중...");
  let complexes = await collectComplexes();
  if (onlyLawds) complexes = complexes.filter((c) => onlyLawds.includes(c.sigunguCd) || onlyLawds.some((l) => resolveSigunguCd(l) === c.sigunguCd));
  console.log(`[supply-area] 단지 ${complexes.length}개 대상 (지역 ${ALL_LAWDS.length}개 중)`);

  // 이미 수동/자동으로 반영된 (단지|umd|전용면적) 키는 --force 없으면 스킵
  let autoExisting = {};
  if (!force && existsSync(AUTO_FILE)) {
    const mod = await import(path.resolve(AUTO_FILE) + `?t=${Date.now()}`);
    autoExisting = mod.SUPPLY_AREA_AUTO || {};
  }
  const alreadyResolved = new Set([...Object.keys(SUPPLY_AREA_OVERRIDE), ...Object.keys(autoExisting)]);

  const autoOut = { ...autoExisting };
  const reviewOut = [];
  let unresolvedBjdong = 0, done = 0, skipped = 0;

  await pool(complexes, 6, async (complex) => {
    const relevantAreas = force
      ? complex.areas
      : new Set([...complex.areas].filter((a) => !alreadyResolved.has(`${complex.apt}|${complex.umd}|${a}`)));
    if (!relevantAreas.size) { skipped++; return; }

    const { pyByArea, unresolved } = await resolveComplexSupply(key, complex);
    if (unresolved === "bjdong") { unresolvedBjdong++; return; }

    for (const [area, pySet] of pyByArea) {
      if (!relevantAreas.has(area)) continue;
      const overrideKey = `${complex.apt}|${complex.umd}|${area}`;
      if (pySet.size === 1) {
        autoOut[overrideKey] = [...pySet][0]; // 타입 하나뿐 → 자동 반영
      } else {
        reviewOut.push({ apt: complex.apt, umd: complex.umd, area, candidates: [...pySet].sort((a, b) => a - b) });
      }
    }
    done++;
    if (done % 200 === 0) {
      console.log(`  진행 ${done}/${complexes.length} (자동 ${Object.keys(autoOut).length - Object.keys(autoExisting).length}건, 검토대기 ${reviewOut.length}건)`);
      await writeAutoFile(autoOut);
      await mkdir("data", { recursive: true });
      await writeFile(REVIEW_FILE, JSON.stringify({ items: reviewOut, updatedAt: new Date().toISOString() }, null, 2));
      commitProgress(`chore: 공급면적 배치 수집 중간 커밋 (${done}/${complexes.length}) ${new Date().toISOString()} [skip ci]`);
    }
  });

  await writeAutoFile(autoOut);
  await mkdir("data", { recursive: true });
  await writeFile(REVIEW_FILE, JSON.stringify({ items: reviewOut, updatedAt: new Date().toISOString() }, null, 2));

  console.log(`[supply-area] 완료 — 자동 반영 ${Object.keys(autoOut).length - Object.keys(autoExisting).length}건 신규, 검토대기 ${reviewOut.length}건, 법정동 매핑 실패 ${unresolvedBjdong}건, 이미 처리돼 스킵 ${skipped}건`);
  commitProgress(`chore: 공급면적 배치 수집 완료 커밋 ${new Date().toISOString()}`);
}

async function writeAutoFile(autoOut) {
  const header = `// 건축HUB 전유공용면적 API로 자동 계산된 공급면적 캐시 (scripts/collect-supply-area.mjs가 생성/갱신).
// 사람이 직접 손대지 말 것 — 수동으로 값을 등록하려면 shared/supply-area.mjs의 SUPPLY_AREA_OVERRIDE를 쓸 것
// (resolvePy는 SUPPLY_AREA_OVERRIDE를 이 파일보다 항상 우선함).
// 같은 전용면적에 타입(A/B/C 등)이 여러 개라 값이 갈리는 애매한 경우는 여기 안 들어가고
// data/supply-area-review.json에 후보로만 남음 — 확인 후 SUPPLY_AREA_OVERRIDE에 수동 등록할 것.

export const SUPPLY_AREA_AUTO = `;
  await mkdir(path.dirname(AUTO_FILE), { recursive: true });
  await writeFile(AUTO_FILE, header + JSON.stringify(autoOut, null, 0) + ";\n");
}

main().catch((e) => {
  console.error(e);
  commitProgress(`chore: 공급면적 배치 수집 중단 시점까지 커밋 ${new Date().toISOString()}`);
  process.exit(1);
});
