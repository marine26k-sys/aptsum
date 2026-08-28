#!/usr/bin/env node
// 건축HUB(건축물대장 전유공용면적) API로 단지별 "대표 타입"의 실제 공급면적(전유+공용)을 수집해
// data/supply-area/<lawd>.json 에 저장한다 (areaToPy() 보간표 대신 실측값 — 2026.08 착수).
//
// 설계 배경(2026.08 시행착오 기록 — 다음에 또 헤매지 않기 위해 남겨둠):
// - 건축HUB는 아파트명이 아니라 "지번 주소"로 조회하는데, 같은 지번에 단지 전체(수천~수만 세대분)
//   전유/공용 면적이 한 줄씩 다 섞여 있어서(은마아파트 예시: 24,066건) 무작정 다 훑으면 너무 느림.
// - 그런데 "한 동에는 한 가지 면적 타입만 있다"(예: 은마 10동은 전부 34평형) — 즉 단지 전체를
//   훑을 필요 없이, 이미 아는 "이 단지에 실제로 거래된 전용면적 값들"(우리가 이미 배치 수집해둔
//   data/analyze/<lawd>/<ym>.json 실거래 데이터에서 바로 뽑을 수 있음)과 일치하는 유닛을
//   딱 하나씩만 찾으면 그게 그 타입 전체를 대표하는 공급면적이 됨.
// - K-apt "공동주택 기본 정보제공 서비스"(getAphusBassInfoV5)는 전용면적 "구간별 세대수"만 주지
//   정확한 공급면적은 안 줌 — 이 API로는 이 작업이 안 됨(수민이 직접 API 문서 확인, 2026.08).
// - 페이지네이션은 실제로 동작함(pageNo로 다른 데이터 나옴, 라이브 테스트 확인) — 다만 같은 세대의
//   전유/공용 여러 줄이 항상 연달아 오는 건 아닐 수 있어(예: 15동 706호는 3줄 연달아 옴), 목표
//   전용면적과 일치하는 유닛을 찾은 뒤에도 그 (동,호) 키는 계속 누적 합산하면서 스캔을 이어감.
//
// 사용법: DATA_GO_KR_KEY=xxx BLDHUB_KEY=yyy node scripts/collect-supply-area.mjs [--only=11680] [--limit=20]
// - limit: 이번 실행에서 처리할 단지 수 상한(기본 30) — API 호출량이 커서(단지당 최대 MAX_PAGES 페이지)
//   한 번에 전체를 다 못 돌리므로, 이미 처리된 단지는 건너뛰고 나머지를 이어서 처리하는 방식으로
//   여러 번 실행에 걸쳐 점진적으로 채운다(collect-hhcnt.mjs의 재시작 가능 설계와 동일한 취지).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { ALL_LAWDS } from "../shared/regions.mjs";

const PUSH_RETRIES = 5;
const COMMIT_EVERY = 5; // 공급면적 수집은 단지당 비용이 커서(최대 MAX_PAGES 페이지) hhcnt보다 자주 중간 커밋
const MAX_PAGES = 30;   // 단지당 안전 상한(30페이지 × 100건 = 최대 3,000건 조회) — 대형 단지도 보통 이 안에서 대표 타입 다 찾힘
const MONTHS_FOR_TYPES = 24; // 최근 2년 실거래면 현재 거래되는 평형 타입은 거의 다 잡힘(단종된 옛 타입까지 다 찾을 필요는 없음)

function pushWithRetry() {
  for (let attempt = 1; attempt <= PUSH_RETRIES; attempt++) {
    try { execSync("git push", { stdio: "inherit" }); return; }
    catch (e) {
      if (attempt === PUSH_RETRIES) throw e;
      console.error(`  push 거절됨, fetch+rebase 후 재시도 (${attempt}/${PUSH_RETRIES})`);
      execSync("git fetch origin main", { stdio: "inherit" });
      execSync("git rebase origin/main", { stdio: "inherit" });
    }
  }
}
function commitProgress(message) {
  try {
    if (!existsSync("data/supply-area")) return;
    execSync("git add data/supply-area", { stdio: "inherit" });
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

const AREA_URL = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo";
const norm = (s) => String(s || "").replace(/\s/g, "");

function xtag(b, name) {
  const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1].trim() : "";
}
function parseAreaXml(xml) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    items.push({
      dong: xtag(b, "dongNm"), ho: xtag(b, "hoNm"),
      gb: xtag(b, "exposPubuseGbCdNm"), // "전유" | "공용" — 실전 검증된 필드명(2026.08)
      area: parseFloat(xtag(b, "area")) || 0,
    });
  }
  return items;
}

// kaptAddr(예: "서울특별시 강남구 대치동 316" / "...산 24-3")는 자유입력 텍스트라 형식이 들쭉날쭉함.
// "숫자[-숫자]"로 끝나는 표준 지번만 파싱하고, "산" 번지나 파싱 실패는 null(스킵) 처리 —
// 잘못 자른 번지로 엉뚱한 건물을 조회하는 것보다 건너뛰는 게 안전(오늘 하루 종일 배운 원칙과 동일).
function parseBunJi(kaptAddr) {
  if (!kaptAddr) return null;
  if (/\s산\s/.test(kaptAddr) || /\s산\d/.test(kaptAddr)) return null; // "산" 번지는 platGbCd가 달라 별도 처리 필요 — 일단 스킵
  const m = kaptAddr.trim().match(/(\d+)(?:-(\d+))?\s*$/);
  if (!m) return null;
  return { bun: m[1].padStart(4, "0"), ji: (m[2] || "0").padStart(4, "0") };
}

// 최근 N개월 실거래 파일에서 단지별 "실제 관측된 전용면적" 집합을 만든다(정수 반올림 — 84.92/84.96처럼
// 같은 타입 내 미세 오차는 하나로 묶기 위함). data/analyze/<lawd>/<ym>.json은 이미 배치로 다 모여있어
// 새로 API를 부를 필요가 없음.
function recentYms(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
async function loadKnownAreasByComplex(lawd) {
  const dir = path.join("data/analyze", lawd);
  const map = {}; // normalizedName -> Set<roundedArea>
  if (!existsSync(dir)) return map;
  const yms = new Set(recentYms(MONTHS_FOR_TYPES));
  for (const f of readdirSync(dir)) {
    const ym = f.replace(".json", "");
    if (!yms.has(ym)) continue;
    try {
      const j = JSON.parse(await readFile(path.join(dir, f), "utf-8"));
      for (const t of j.items || []) {
        if (!t.area) continue;
        const k = norm(t.apt);
        (map[k] = map[k] || new Set()).add(Math.round(t.area));
      }
    } catch { /* 개별 월 파일 손상은 무시하고 계속 */ }
  }
  return map;
}

async function fetchAreaPage(key, sigunguCd, bjdongCd, bun, ji, pageNo) {
  const q = `serviceKey=${encodeURIComponent(key)}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&numOfRows=100&pageNo=${pageNo}`;
  // 초당 요청 제한(429) 재시도 — 이 스크립트가 단지당 최대 MAX_PAGES번 연달아 호출하는 구조라
  // collect-hhcnt.mjs에서 실제로 겪었던 429 문제에 가장 취약함(2026.08)
  for (let attempt = 0; attempt <= 3; attempt++) {
    const r = await fetch(`${AREA_URL}?${q}`, { signal: AbortSignal.timeout(20000) });
    if (r.status === 429) {
      if (attempt === 3) return [];
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      continue;
    }
    const text = await r.text();
    return parseAreaXml(text);
  }
  return [];
}

// 한 단지의 대표 타입별 공급면적을 찾는다. targetAreas(정수 반올림 전용면적 집합)에 있는 값과 일치하는
// (동,호)를 만나면 그 키를 계속 누적 추적(전유+공용 다 더함) — 페이지 상한까지 스캔.
async function collectComplexSupplyArea(key, sigunguCd, bjdongCd, bun, ji, targetAreas) {
  const units = {}; // "동|호" -> {exclu, pubuse, matchedType}
  const foundTypes = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let rows;
    try { rows = await fetchAreaPage(key, sigunguCd, bjdongCd, bun, ji, page); }
    catch { break; } // 네트워크 오류 시 이번 단지는 지금까지 찾은 것만으로 마무리
    if (!rows.length) break; // 더 이상 페이지 없음
    for (const row of rows) {
      const k = `${row.dong}|${row.ho}`;
      const u = (units[k] = units[k] || { exclu: 0, pubuse: 0 });
      if (row.gb.includes("전유")) u.exclu += row.area;
      else if (row.gb.includes("공용")) u.pubuse += row.area;
      const rounded = Math.round(u.exclu);
      if (targetAreas.has(rounded)) foundTypes.add(rounded);
    }
    if (foundTypes.size >= targetAreas.size) break; // 목표 타입 다 찾았으면 조기 종료(API 호출 절약)
    if (page < MAX_PAGES) await new Promise((res) => setTimeout(res, 150)); // 초당 요청 제한 여유를 위한 페이스 조절(2026.08)
  }
  // targetAreas와 일치하는 (동,호)들만 골라 최종 결과로 정리 — 같은 타입 여러 유닛이 잡히면 첫 번째 것 사용
  const result = {}; // roundedExclusiveArea -> {exclusiveArea, supplyArea}
  for (const u of Object.values(units)) {
    const rounded = Math.round(u.exclu);
    if (!targetAreas.has(rounded) || result[rounded]) continue;
    result[rounded] = { exclusiveArea: Math.round(u.exclu * 100) / 100, supplyArea: Math.round((u.exclu + u.pubuse) * 100) / 100 };
  }
  return result;
}

async function pool(items, limit, worker) {
  let i = 0;
  async function run() { while (i < items.length) { const idx = i++; await worker(items[idx]); } }
  await Promise.all(Array.from({ length: limit }, run));
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  const bldKey = process.env.BLDHUB_KEY;
  if (!key || !bldKey) { console.error("DATA_GO_KR_KEY / BLDHUB_KEY 환경변수가 필요합니다."); process.exit(1); }
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const lawds = args.only ? args.only.split(",") : ALL_LAWDS.filter((c) => /^\d{5}$/.test(c)); // 분구 지역(BC-/HS-/IC-)은 우선 제외 — 코드 체계가 달라 별도 처리 필요, 추후 확장
  const limit = parseInt(args.limit, 10) || 30;

  await mkdir("data/supply-area", { recursive: true });
  let processed = 0;

  for (const lawd of lawds) {
    if (processed >= limit) break;
    const hhFile = path.join("data/hhcnt", `${lawd}.json`);
    if (!existsSync(hhFile)) { console.log(`[supply-area] ${lawd}: data/hhcnt 없음, 스킵(먼저 collect-hhcnt 실행 필요)`); continue; }
    const hh = JSON.parse(await readFile(hhFile, "utf-8"));
    const knownAreas = await loadKnownAreasByComplex(lawd);

    const outFile = path.join("data/supply-area", `${lawd}.json`);
    const out = existsSync(outFile) ? JSON.parse(await readFile(outFile, "utf-8")) : { items: {} };

    const targets = (hh.items || []).filter((c) => {
      if (out.items[c.name]) return false; // 이미 처리됨(재실행 시 이어서)
      if (!c.kaptAddr || !c.bjdCode) return false; // hhcnt 데이터가 아직 kaptAddr/bjdCode 없는 옛 버전이면 스킵
      const areas = knownAreas[norm(c.name)];
      return areas && areas.size > 0; // 실거래 데이터에서 이 단지의 전용면적 타입을 못 찾으면(이름 표기 차이 등) 스킵
    });

    for (const c of targets) {
      if (processed >= limit) break;
      const bj = parseBunJi(c.kaptAddr);
      if (!bj) { console.log(`  ${c.name}: 지번 파싱 실패(${c.kaptAddr}), 스킵`); continue; }
      const targetAreas = knownAreas[norm(c.name)];
      try {
        const result = await collectComplexSupplyArea(bldKey, lawd, c.bjdCode, bj.bun, bj.ji, targetAreas);
        if (Object.keys(result).length) {
          out.items[c.name] = Object.values(result);
          console.log(`  ${c.name}: ${Object.keys(result).length}/${targetAreas.size}개 타입 확보`);
        } else {
          console.log(`  ${c.name}: 못 찾음(0/${targetAreas.size})`);
        }
      } catch (e) {
        console.error(`  ${c.name}: 조회 실패 -`, e.message);
      }
      processed++;
      if (processed % COMMIT_EVERY === 0) {
        out.updatedAt = new Date().toISOString();
        await writeFile(outFile, JSON.stringify(out));
        commitProgress(`chore: 공급면적 배치 수집 중간 커밋 (${processed}/${limit}) ${new Date().toISOString()} [skip ci]`);
      }
    }

    out.updatedAt = new Date().toISOString();
    await writeFile(outFile, JSON.stringify(out));
    console.log(`[supply-area] ${lawd}: 이번 실행 ${targets.length}개 단지 중 처리 완료, 누적 ${Object.keys(out.items).length}개 단지`);
  }

  commitProgress(`chore: 공급면적 배치 수집 완료 커밋 ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  commitProgress(`chore: 공급면적 배치 수집 중단 시점까지 커밋 ${new Date().toISOString()}`);
  process.exit(1);
});
