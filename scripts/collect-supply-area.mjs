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
import { norm, resolveComplexNames } from "../shared/name-match.mjs";

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
function commitProgress(message, allowEmpty = false) {
  try {
    if (!existsSync("data/supply-area")) return;
    execSync("git add data/supply-area", { stdio: "inherit" });
    const diff = execSync("git diff --cached --name-only").toString().trim();
    // allowEmpty: 완료 커밋 전용 — collect-hhcnt.mjs와 동일한 이유(2026.09 발견)로, limit이 COMMIT_EVERY로
    // 정확히 나눠떨어지면 바로 앞 중간 커밋([skip ci])이 이미 마지막 건까지 다 커밋해버려 여기서 diff가
    // 비어 완료 커밋이 조용히 no-op되고 skip ci 없는 커밋이 하나도 안 생겨 Netlify 배포가 안 되는 문제가
    // 있을 수 있어 선제적으로 동일하게 방어.
    if (!diff && !allowEmpty) return;
    execSync(`git commit ${allowEmpty ? "--allow-empty " : ""}-m ${JSON.stringify(message)}`, { stdio: "inherit" });
    pushWithRetry();
    console.log(`  (중간 커밋 완료: ${message})`);
  } catch (e) {
    console.error("  중간 커밋 실패(계속 진행):", e.message);
    try { execSync("git rebase --abort", { stdio: "ignore" }); } catch {}
  }
}

// 2026.09 — 전용률(전용면적÷공급면적) 상한. 아파트는 계단·복도·엘리베이터 같은 주거공용이 반드시
// 있어서 전용률이 85%를 넘을 수 없다. 그보다 높게 나온 건 이 스캔이 그 세대의 공용 행을 다 못 잡은
// 것이므로(=수집 실패) 저장하지 않는다 — 저장해버리면 "이 타입은 확보됨"으로 간주돼 영영 다시 안
// 긁고, 잘못된 평형이 서비스에 그대로 나간다. 저장을 안 하면 다음 실행 때 자동으로 재시도된다.
const MAX_EXCLUSIVE_RATIO = 0.85;

const AREA_URL = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo";

function xtag(b, name) {
  const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1].trim() : "";
}
// 2026.09 발견 — "특정 세대 평수가 실제보다 조금 크게 나옴" 버그 조사용: 같은 동/호로 지하 창고·관리동
// 부속시설 등 비주거 전유 레코드가 같이 잡혀 합산되는 것으로 추정. 정확한 필드명이 실전 응답에서
// 검증 전이라(추측성 태그명), 일단 후보 필드를 다 뽑아두고 아래 diagUnknownTags()로 실제 태그 목록을
// 한 번 찍어서 맞는지 확인한 뒤 필터링 조건을 확정한다.
function xtagAny(b, names) {
  for (const name of names) {
    const v = xtag(b, name);
    if (v) return v;
  }
  return "";
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
      // 아래 둘은 2026.09 실전 로그로 필드명 확정됨(mainPurpsCdNm="아파트"/"창고"/"주차장" 등,
      // mainAtchGbCdNm="주건축물"/"부속건축물") — collectComplexSupplyArea의 비주거/부속 필터에서 사용.
      purpose: xtagAny(b, ["mainPurpsCdNm", "etcPurps"]),
      mainAtch: xtagAny(b, ["mainAtchGbCdNm"]),
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
// 실거래에서 "이 단지에 실제로 거래된 전용면적 타입"과 "거래가 일어난 법정동"을 뽑는다.
// 법정동은 이름이 비슷한 단지가 여러 개일 때 매칭 후보를 좁히는 데 쓴다(shared/name-match.mjs).
async function loadKnownAreasByComplex(lawd) {
  const dir = path.join("data/analyze", lawd);
  const map = new Map(); // normalizedName -> { areas:Set<roundedArea>, umds:Set<법정동명> }
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
        let e = map.get(k);
        if (!e) { e = { areas: new Set(), umds: new Set() }; map.set(k, e); }
        e.areas.add(Math.round(t.area));
        if (t.umd) e.umds.add(t.umd);
      }
    } catch { /* 개별 월 파일 손상은 무시하고 계속 */ }
  }
  return map;
}

// 2026.09 발견 — 같은 단지가 실행마다 "확보"/"못 찾음(실제스캔:[])"을 오갔던 원인: data.go.kr API는
// 실패해도 HTTP 상태코드는 200을 주고 본문에 에러를 담아서 줌(정상 성공은 resultCode="00", 또는
// 아예 다른 스키마인 <OpenAPI_ServiceResponse>로 인증/트래픽 관련 에러를 줌). 지금까지는 이걸 구분 안 하고
// "본문에 <item> 없음 = 이 페이지가 마지막(진짜 데이터 없음)"으로 해석해버려서, 일시적인 서버 에러를
// "이 단지는 대상 없음"으로 오판했음 — 재시도해야 할 걸 그냥 포기해버린 셈.
function checkApiError(xml) {
  if (xml.includes("OpenAPI_ServiceResponse")) {
    const msg = xtag(xml, "returnAuthMsg") || xtag(xml, "returnReasonCode") || "OpenAPI_ServiceResponse 에러(인증/트래픽 관련으로 추정)";
    return msg;
  }
  const code = xtag(xml, "resultCode");
  if (code && code !== "00") return `resultCode=${code} ${xtag(xml, "resultMsg")}`;
  return null;
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
      const apiError = checkApiError(text);
      if (apiError) {
        if (attempt === 2) return { rows: [], rateLimited: true, error: apiError };
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      }
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
  const excludedRows = []; // 2026.09 — 아래 필터로 걸러낸 행 기록(진단/검증용, 개수가 비정상적으로 많으면 필터 조건 재검토 필요)
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
      if (row.gb.includes("전유")) {
        // 전유(exclu)는 실거래 전용면적과 매칭하는 기준값이라 무조건 합산 — mainAtch/purpose로 거르면 안 됨.
        // (2026.09 발견: 일부 단지는 세대 자체의 전유 레코드가 mainAtchGbCdNm="부속건축물"로 등록돼 있어서,
        // 여기에 필터를 걸면 그 단지는 전유면적이 통째로 안 잡혀 매칭 자체가 실패함 — 실전 회귀로 확인함)
        u.exclu += row.area;
      } else if (row.gb.includes("공용")) {
        // 공용(pubuse)만 필터링 — "공급면적(전용+주거공용)"에는 부속건축물(관리동/경로당 등) 소속 공용이나
        // 기타공용(창고·주차장·기계실 등)이 포함되면 안 됨. 실전 로그로 확인된 패턴:
        // 롯데캐슬노블·개포더샵트리에(부속건축물 복리시설/부대시설), 래미안그레이튼(부속건축물 소속 미세 조각),
        // 한화진넥스빌(주건축물 소속이지만 창고/주차장) — 모두 공용 쪽에서만 나타났고 전유 쪽엔 없었음(2026.09).
        const isNonResidentialCommon = row.mainAtch !== "주건축물" || /창고|주차|기계실|전기실|경비|관리|복리시설|부대시설/.test(row.purpose);
        if (isNonResidentialCommon) {
          excludedRows.push({ k, gb: row.gb, area: row.area, purpose: row.purpose, mainAtch: row.mainAtch });
        } else {
          u.pubuse += row.area;
        }
      }
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
    const supply = u.exclu + u.pubuse;
    if (!(supply > 0) || u.exclu / supply > MAX_EXCLUSIVE_RATIO) continue; // 공용을 다 못 잡음 → 저장 안 함(다음 실행에 재시도)
    result[rounded] = { exclusiveArea: Math.round(u.exclu * 100) / 100, supplyArea: Math.round(supply * 100) / 100 };
  }
  return { types: result, debug: { pagesScanned, seenAreas: [...seenAreas].sort((a,b)=>a-b), rateLimited, lastError, excludedRows } }; // debug는 2026.08 진단용(못 찾았을 때만 출력)
}

// 2026.09 — 이미 저장돼 있는 "전용률 85% 초과" 타입을 걷어낸다. 이걸 안 하면 두 가지가 동시에 막힌다:
// (1) 잘못된 평형이 계속 서비스에 나가고, (2) targets 필터가 "타입 수를 다 채웠다"고 보고 그 단지를
// 영영 다시 안 긁어서 스스로 복구되지 않는다. 지우면 다음 실행에 정상적으로 재수집 대상이 된다.
function dropBrokenTypes(out) {
  let dropped = 0;
  for (const [name, types] of Object.entries(out.items)) {
    if (!Array.isArray(types)) continue;
    const kept = types.filter((t) => Number.isFinite(t.supplyArea) && t.supplyArea > 0 && t.exclusiveArea / t.supplyArea <= MAX_EXCLUSIVE_RATIO);
    if (kept.length === types.length) continue;
    dropped += types.length - kept.length;
    if (kept.length) out.items[name] = kept;
    else delete out.items[name];
  }
  return dropped;
}

// 로그용 — 실거래명과 대장명이 다르면 둘 다 보여줘서 매칭이 맞는지 눈으로 확인할 수 있게 한다.
function label(c, dealName) {
  return norm(c.name) === dealName ? c.name : `${dealName}(대장: ${c.name})`;
}

// 2026.09 저장 키 이전 — 예전 파일은 "대장 단지명"을 키로 저장했다. 이제 서비스가 조회하는
// "실거래 단지명"을 키로 쓰므로, 기존에 모아둔 타입 데이터를 새 키로 옮겨서 다시 수집하지 않게 한다.
// (옮길 곳을 못 찾는 옛 키는 지우지 않고 그대로 둔다 — 지워서 얻을 게 없고, 혹시 맞는 키였을 수 있음)
function migrateLegacyKeys(out, resolved, knownAreas) {
  const hhNameToDeal = new Map();
  for (const [dealName, c] of resolved) hhNameToDeal.set(norm(c.name), dealName);
  for (const legacyKey of Object.keys(out.items)) {
    // 실거래명 키지만 공백이 들어있는 옛 항목은 공백만 제거해 새 키로 합친다 — 안 그러면 같은 단지가
    // 두 키로 중복 저장돼서 매번 한쪽을 다시 수집하게 된다.
    const dealName = knownAreas.has(norm(legacyKey)) ? norm(legacyKey) : hhNameToDeal.get(norm(legacyKey));
    if (!dealName || dealName === legacyKey) continue;
    const prev = out.items[dealName] || [];
    const merged = new Map(prev.map((t) => [Math.round(t.exclusiveArea), t]));
    for (const t of out.items[legacyKey]) if (!merged.has(Math.round(t.exclusiveArea))) merged.set(Math.round(t.exclusiveArea), t);
    out.items[dealName] = [...merged.values()];
    delete out.items[legacyKey];
  }
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

    // 2026.09 변경 — 예전엔 out.items[c.name]에 하나라도 저장돼 있으면(부분 성공 N/M 포함) 그대로
    // 영구 스킵했음. 그래서 "2/3개 타입 확보" 같은 건 나머지 1개를 영영 못 찾은 채로 고정됐음
    // (사용자 요청으로 변경: 목표 타입을 전부 찾을 때까지 계속 재시도). 단, 이미 다 찾은 것까지 매번
    // 다시 스캔하면 API 호출만 낭비이므로, "목표 개수만큼 다 채웠는지"로만 스킵 여부를 판단한다.
    // 2026.09 변경 — 예전엔 "hhcnt 단지명과 실거래 단지명이 글자까지 똑같을 때"만 대상으로 삼아서
    // 일치율이 23%뿐이었고(헬리오시티·리센츠·파크리오 같은 대형 단지도 통째로 누락), 표기 차이를
    // 흡수하는 매칭으로 교체했다(shared/name-match.mjs 주석에 패턴 정리). 저장 키는 반드시
    // "실거래 단지명"이어야 한다 — netlify/functions/analyze.mjs의 hubPyOverride()가 실거래 단지명으로
    // 이 파일을 조회하기 때문에, 대장 단지명으로 저장하면 수집해놓고도 서비스에서 못 찾는다.
    const resolved = resolveComplexNames(hh.items, knownAreas);
    migrateLegacyKeys(out, resolved, knownAreas);
    const droppedBroken = dropBrokenTypes(out);
    if (droppedBroken) console.log(`[supply-area] ${lawd}: 공용면적이 덜 잡힌 타입 ${droppedBroken}개 제거(재수집 대상으로 되돌림)`);
    const targets = [...resolved.entries()]
      .map(([dealName, c]) => ({ c, dealName, areas: knownAreas.get(dealName).areas }))
      .filter(({ dealName, areas }) => {
        const already = out.items[dealName];
        return !(already && already.length >= areas.size); // 목표 타입 다 찾았으면 스킵
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
    await pool(batch, 1, async ({ c, dealName, areas: targetAreas }) => {
      if (circuitOpen) return; // 이미 중단 결정났으면 나머지는 건드리지 않음(그대로 미처리 상태로 남아 다음 실행에 재시도)
      await new Promise((res) => setTimeout(res, 500)); // 단지 시작 전 대기(2026.08 200ms→500ms)
      const bj = parseBunJi(c.kaptAddr);
      if (!bj) { console.log(`  ${c.name}: 지번 파싱 실패(${c.kaptAddr}), 스킵`); return; }
      try {
        // K-apt(getAphusBassInfoV5)의 bjdCode는 "시군구코드(5)+동코드(5)" 합친 10자리 전체 코드로 옴
        // (실전 확인: "2638010100" 같은 형태) — 건축HUB의 bjdongCd 파라미터는 동 코드 5자리만 받아서
        // 10자리를 그대로 넘기면 존재하지 않는 코드가 되어 매번 빈 응답(0페이지)이 나왔음(2026.08 발견).
        const bjdongCd5 = c.bjdCode.length === 10 ? c.bjdCode.slice(5) : c.bjdCode;
        const { types, debug } = await collectComplexSupplyArea(bldKey, lawd, bjdongCd5, bj.bun, bj.ji, targetAreas);
        if (Object.keys(types).length) {
          // 2026.09 — 재시도 시 이전에 이미 찾아둔 타입을 잃어버리지 않도록 병합. 반올림 전용면적을
          // 키로 합쳐서 저장(같은 타입이 다시 나오면 이번 결과로 갱신, 새 타입이면 추가).
          const prevArr = out.items[dealName] || [];
          const merged = new Map(prevArr.map((t) => [Math.round(t.exclusiveArea), t]));
          for (const v of Object.values(types)) merged.set(Math.round(v.exclusiveArea), v);
          out.items[dealName] = [...merged.values()];
          console.log(`  ${label(c, dealName)}: ${out.items[dealName].length}/${targetAreas.size}개 타입 확보${prevArr.length ? ` (기존 ${prevArr.length} + 이번 신규/갱신 ${Object.keys(types).length})` : ""}`);
          if (debug.excludedRows.length) {
            // 2026.09 — 필터로 걸러낸 비주거/부속 행 개수. 몇 건 정도는 정상(관리동 등 실제로 존재)이지만
            // 개수가 비정상적으로 많으면(예: 수백~수천 건) 필터 조건이 뭔가 놓치고 있을 수 있어 같이 남긴다.
            console.log(`    [필터] 공급면적에서 제외된 비주거/기타공용 행 ${debug.excludedRows.length}건: ${JSON.stringify(debug.excludedRows.slice(0, 3))}`);
          }
          consecutiveNetworkFailures = 0; // 성공하면 연속 실패 카운트 리셋
        } else if (debug.rateLimited) {
          // 2026.08 — "데이터가 없음"이 아니라 "재시도를 다 썼는데도 안 됨"인 경우는 명확히 구분해서 로그.
          // out.items에 저장 안 하므로 다음 실행 때 자동으로 재시도됨(영구 실패 아님).
          console.log(`  ${label(c, dealName)}: 속도 제한/네트워크 오류로 조회 실패(나중에 자동 재시도됨)${debug.lastError ? ` — ${debug.lastError}` : ""}`);
          consecutiveNetworkFailures++;
          if (consecutiveNetworkFailures >= CIRCUIT_BREAKER_THRESHOLD && !circuitOpen) {
            circuitOpen = true;
            console.log(`\n⚠️  연속 ${CIRCUIT_BREAKER_THRESHOLD}개 단지 조회 실패 — 지금 이 환경에서 건축HUB API 자체가 막혀있는 것으로 보여 실행을 중단합니다.`);
            console.log(`   (재시도해도 소용없을 가능성이 높음 — 다른 환경/시간대에 다시 시도해보세요. 지금까지 성공한 데이터는 그대로 저장됨)\n`);
          }
        } else {
          // 진단용(2026.08) — 목표 전용면적(targetAreas)과 실제 스캔 중 마주친 값(seenAreas)을 같이 찍어서
          // "페이지 부족(seenAreas가 targetAreas와 전혀 안 겹침)"인지 "반올림 미스매치(살짝 다른 값들이 보임)"인지 구분
          const prevCount = (out.items[dealName] || []).length; // 2026.09 — 재시도 대상이라 이전에 이미 일부 찾아뒀을 수 있음
          console.log(`  ${label(c, dealName)}: 못 찾음(${prevCount}/${targetAreas.size}${prevCount ? ", 이번엔 신규 0" : ""}) — 목표:[${[...targetAreas].sort((a,b)=>a-b).join(",")}] 실제스캔:[${debug.seenAreas.join(",")}] (${debug.pagesScanned}페이지)`);
          consecutiveNetworkFailures = 0; // 이건 진짜 응답을 받은 케이스라 네트워크 실패가 아님 — 리셋
        }
      } catch (e) {
        console.error(`  ${label(c, dealName)}: 조회 실패 -`, e.message);
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
    // 2026.09 — "누적 확보"에 부분 성공(N/M, N<M)도 포함되게 바뀌어서(재시도 대상으로 남겨두려고),
    // 완전 확보와 부분 확보를 나눠서 보여준다 — 안 그러면 "누적 X개"가 다 끝난 것처럼 오해될 수 있음.
    const fullyDone = Object.entries(out.items).filter(([name, arr]) => {
      const e = knownAreas.get(norm(name));
      return e && arr.length >= e.areas.size;
    }).length;
    const totalSaved = Object.keys(out.items).length;
    console.log(`[supply-area] ${lawd}: 전체 ${hh.items?.length ?? "?"}개 단지 중 매칭 가능 대상 ${targets.length}개, 이번 실행 ${batch.length}개 시도 → 누적 ${totalSaved}개 단지(완전 확보 ${fullyDone} / 부분 확보 ${totalSaved - fullyDone})`);
  }

  commitProgress(`chore: 공급면적 배치 수집 완료 커밋 ${new Date().toISOString()}`, true);
}

main().catch((e) => {
  console.error(e);
  commitProgress(`chore: 공급면적 배치 수집 중단 시점까지 커밋 ${new Date().toISOString()}`);
  process.exit(1);
});
