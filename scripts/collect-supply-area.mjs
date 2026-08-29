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
// kaptAddr(예: "서울특별시 강남구 대치동 316 은마아파트")는 "...번지 단지명"까지 붙어서 오는 게 실제 형식임
// (2026.08 실전 테스트로 확인 — 처음엔 "주소 끝이 곧 번지"라고 잘못 가정해서 100% 파싱 실패했음, 끝은
// 항상 단지명 텍스트였음). 그래서 "끝에서 숫자 찾기"가 아니라 "공백으로 나눈 토큰 중 순수 숫자(-숫자
// 포함) 토큰을 앞에서부터 찾기"로 변경 — 시도/시군구/동 이름은 전부 한글이라 숫자만으로 된 토큰은
// 번지뿐이라는 전제(단, "성수동1가"처럼 숫자가 글자에 붙어있는 동명은 토큰 전체가 숫자가 아니라서
// 안전하게 건너뜀).
function parseBunJi(kaptAddr) {
  if (!kaptAddr) return null;
  if (/\s산\s/.test(kaptAddr) || /\s산\d/.test(kaptAddr)) return null; // "산" 번지는 platGbCd가 달라 별도 처리 필요 — 일단 스킵
  const tokens = kaptAddr.trim().split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const m = tok.match(/^(\d+)(?:-(\d+))?-?$/); // "344" / "138-"(부번 생략, 끝 대시만 있음) / "24-3" 등
    if (m) return { bun: m[1].padStart(4, "0"), ji: (m[2] || "0").padStart(4, "0") };
  }
  return null;
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
  // 초당 요청 제한(429) + 네트워크 레벨 예외("fetch failed"/UND_ERR_CONNECT_TIMEOUT 등) 둘 다 재시도.
  // (2026.08 5→2회로 축소 — 공격적인 재시도가 오히려 데이터센터 IP 대역 차단을 유발했을 가능성이 있어
  // 훨씬 보수적으로 조정. 이젠 "재시도로 뚫어보기"보다 "막혀있으면 빨리 포기하고 전체를 중단"하는
  // 쪽으로 전략 전환 — main()의 circuit breaker 참고)
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${AREA_URL}?${q}`, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429) {
        if (attempt === 2) return { rows: [], rateLimited: true };
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      }
      const text = await r.text();
      return { rows: parseAreaXml(text), rateLimited: false };
    } catch (e) {
      if (attempt === 2) return { rows: [], rateLimited: true, error: `${e.message} | cause: ${e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : "없음"}` };
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  return { rows: [], rateLimited: true };
}

// 한 단지의 대표 타입별 공급면적을 찾는다. targetAreas(정수 반올림 전용면적 집합)에 있는 값과 일치하는
// (동,호)를 만나면 그 키를 계속 누적 추적(전유+공용 다 더함) — 페이지 상한까지 스캔.
async function collectComplexSupplyArea(key, sigunguCd, bjdongCd, bun, ji, targetAreas) {
  const units = {}; // "동|호" -> {exclu, pubuse, matchedType}
  const foundTypes = new Set();
  const seenAreas = new Set(); // 진단용 — 실제로 스캔 중 마주친 전유면적(반올림) 전부 기록
  let pagesScanned = 0;
  let rateLimited = false; // 2026.08 — "데이터가 진짜 없음"과 "429/네트워크 예외로 결국 못 받아옴"을 구분하기 위한 플래그
  let lastError = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res;
    try { res = await fetchAreaPage(key, sigunguCd, bjdongCd, bun, ji, page); }
    catch (e) { lastError = e.message; break; } // fetchAreaPage 자체는 이제 거의 안 던지지만(재시도 다 내부에서 처리) 안전망으로 유지
    pagesScanned = page; // 요청은 실제로 나갔으니(성공이든 rateLimited든) 여기서 기록 — "0페이지"라는 오해 방지
    if (res.rateLimited) { rateLimited = true; lastError = res.error || null; break; } // 재시도 다 썼는데도 실패 — 더 진행해봐야 소용없음
    const rows = res.rows;
    if (!rows.length) break; // 더 이상 페이지 없음(진짜 끝)
    for (const row of rows) {
      const k = `${row.dong}|${row.ho}`;
      const u = (units[k] = units[k] || { exclu: 0, pubuse: 0 });
      if (row.gb.includes("전유")) u.exclu += row.area;
      else if (row.gb.includes("공용")) u.pubuse += row.area;
      const rounded = Math.round(u.exclu);
      if (rounded > 0) seenAreas.add(rounded);
      if (targetAreas.has(rounded)) foundTypes.add(rounded);
    }
    if (foundTypes.size >= targetAreas.size) break; // 목표 타입 다 찾았으면 조기 종료(API 호출 절약)
    if (page < MAX_PAGES) await new Promise((res) => setTimeout(res, 1000)); // 페이스 훨씬 보수적으로(2026.08 150ms→1000ms — 공격적인 요청 패턴이 IP 차단을 유발했을 가능성)
  }
  // targetAreas와 일치하는 (동,호)들만 골라 최종 결과로 정리 — 같은 타입 여러 유닛이 잡히면 첫 번째 것 사용
  const result = {}; // roundedExclusiveArea -> {exclusiveArea, supplyArea}
  for (const u of Object.values(units)) {
    const rounded = Math.round(u.exclu);
    if (!targetAreas.has(rounded) || result[rounded]) continue;
    result[rounded] = { exclusiveArea: Math.round(u.exclu * 100) / 100, supplyArea: Math.round((u.exclu + u.pubuse) * 100) / 100 };
  }
  return { types: result, debug: { pagesScanned, seenAreas: [...seenAreas].sort((a,b)=>a-b), rateLimited, lastError } }; // debug는 2026.08 진단용(못 찾았을 때만 출력)
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

    // 2026.08: 동시 2~3개로도 대량 연속 처리 시 UND_ERR_CONNECT_TIMEOUT(데이터센터 IP 대역 차단 의심)이
    // 발생 — 1(완전 순차)로 낮추고, 단지 시작 전 대기도 늘림. 처리량보다 "막혀있으면 최대한 빨리 알아채고
    // 멈추기"를 우선.
    const remaining = Math.max(0, limit - processed);
    const batch = targets.slice(0, remaining);
    // 회로차단기(circuit breaker, 2026.08 추가) — 연속으로 계속 네트워크 실패가 나면, 이미 막혀있다고
    // 보고 남은 수천 개를 헛되이 다 시도하는 대신 즉시 전체 실행을 중단한다(안 그러면 시간·API 시도만
    // 낭비하고, 혹시 진짜 차단 상태라면 계속 두드릴수록 차단이 더 굳어질 수도 있음).
    const CIRCUIT_BREAKER_THRESHOLD = 5;
    let consecutiveNetworkFailures = 0;
    let circuitOpen = false;
    await pool(batch, 1, async (c) => {
      if (circuitOpen) return; // 이미 중단 결정났으면 나머지는 건드리지 않음(그대로 미처리 상태로 남아 다음 실행에 재시도)
      await new Promise((res) => setTimeout(res, 500)); // 단지 시작 전 대기(2026.08 200ms→500ms)
      const bj = parseBunJi(c.kaptAddr);
      if (!bj) { console.log(`  ${c.name}: 지번 파싱 실패(${c.kaptAddr}), 스킵`); return; }
      const targetAreas = knownAreas[norm(c.name)];
      try {
        // K-apt(getAphusBassInfoV5)의 bjdCode는 "시군구코드(5)+동코드(5)" 합친 10자리 전체 코드로 옴
        // (실전 확인: "2638010100" 같은 형태) — 건축HUB의 bjdongCd 파라미터는 동 코드 5자리만 받아서
        // 10자리를 그대로 넘기면 존재하지 않는 코드가 되어 매번 빈 응답(0페이지)이 나왔음(2026.08 발견).
        const bjdongCd5 = c.bjdCode.length === 10 ? c.bjdCode.slice(5) : c.bjdCode;
        const { types, debug } = await collectComplexSupplyArea(bldKey, lawd, bjdongCd5, bj.bun, bj.ji, targetAreas);
        if (Object.keys(types).length) {
          out.items[c.name] = Object.values(types);
          console.log(`  ${c.name}: ${Object.keys(types).length}/${targetAreas.size}개 타입 확보`);
          consecutiveNetworkFailures = 0; // 성공하면 연속 실패 카운트 리셋
        } else if (debug.rateLimited) {
          // 2026.08 — "데이터가 없음"이 아니라 "재시도를 다 썼는데도 안 됨"인 경우는 명확히 구분해서 로그.
          // out.items에 저장 안 하므로 다음 실행 때 자동으로 재시도됨(영구 실패 아님).
          console.log(`  ${c.name}: 속도 제한/네트워크 오류로 조회 실패(나중에 자동 재시도됨)${debug.lastError ? ` — ${debug.lastError}` : ""}`);
          consecutiveNetworkFailures++;
          if (consecutiveNetworkFailures >= CIRCUIT_BREAKER_THRESHOLD && !circuitOpen) {
            circuitOpen = true;
            console.log(`\n⚠️  연속 ${CIRCUIT_BREAKER_THRESHOLD}개 단지 조회 실패 — 지금 이 환경에서 건축HUB API 자체가 막혀있는 것으로 보여 실행을 중단합니다.`);
            console.log(`   (재시도해도 소용없을 가능성이 높음 — 다른 환경/시간대에 다시 시도해보세요. 지금까지 성공한 데이터는 그대로 저장됨)\n`);
          }
        } else {
          // 진단용(2026.08) — 목표 전용면적(targetAreas)과 실제 스캔 중 마주친 값(seenAreas)을 같이 찍어서
          // "페이지 부족(seenAreas가 targetAreas와 전혀 안 겹침)"인지 "반올림 미스매치(살짝 다른 값들이 보임)"인지 구분
          console.log(`  ${c.name}: 못 찾음(0/${targetAreas.size}) — 목표:[${[...targetAreas].sort((a,b)=>a-b).join(",")}] 실제스캔:[${debug.seenAreas.join(",")}] (${debug.pagesScanned}페이지)`);
          consecutiveNetworkFailures = 0; // 이건 진짜 응답을 받은 케이스라 네트워크 실패가 아님 — 리셋
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
    });

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
