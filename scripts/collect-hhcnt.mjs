#!/usr/bin/env node
// 국토부 공동주택 단지목록/기본정보 API로 지역별 전체 단지의 세대수를 미리 수집해
// data/hhcnt/<lawd>.json 에 저장한다 (단지명 목록 통째로 저장 → hhcnt.mjs가 매칭만 수행).
// 세대수는 재건축 전까지 거의 안 바뀌는 값이라 배치는 주 1회 정도면 충분(GitHub Actions 스케줄 참고).
//
// 사용법: DATA_GO_KR_KEY=xxx node scripts/collect-hhcnt.mjs [--only=11680,HS-동탄구]

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { ALL_LAWDS } from "../shared/regions.mjs";

const COMMIT_EVERY = 10; // 이 개수만큼 지역을 처리할 때마다 중간 커밋 (73개 지역 전체 처리 중 죽어도 진행분 보존)

// collect-trades.mjs와 동일한 취지: 300분 타임아웃/중간 크래시에도 그때까지 받은 data/hhcnt는 살아남게 커밋·푸시
// 다른 워크플로(collect-trades 등)가 동시에 main에 푸시해 "rejected (fetch first)"가 나는 경우를 대비해
// push 실패 시 fetch + rebase 후 재시도한다 (data/hhcnt는 다른 워크플로와 파일 경로가 겹치지 않으므로
// rebase 충돌 가능성이 거의 없음).
const PUSH_RETRIES = 5;

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
    if (!existsSync("data/hhcnt")) return; // 폴더가 아직 없으면(비정상 조기 실패 등) git add가 죽는 것 방지
    execSync("git add data/hhcnt", { stdio: "inherit" });
    const diff = execSync("git diff --cached --name-only").toString().trim();
    if (!diff) return;
    execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: "inherit" });
    pushWithRetry();
    console.log(`  (중간 커밋 완료: ${message})`);
  } catch (e) {
    console.error("  중간 커밋 실패(계속 진행):", e.message);
    // rebase 도중 충돌 등으로 중단된 상태면 다음 커밋을 위해 정리
    try { execSync("git rebase --abort", { stdio: "ignore" }); } catch {}
  }
}

// (2026.08 V3→V4 전환: V3 서비스 접근이 갑자기 전체 지역에서 0건으로 실패하기 시작 — 확인해보니 수민의
// V3 "공동주택 단지 목록제공 서비스" 승인이 만료되고 같은 날 V4로 새로 승인받은 상태였음. 파라미터명은
// V3와 동일(sigunguCode)일 것으로 추정되나 실전 검증 전 — 이 호출도 0건이 계속되면 미리보기로 확인 필요)
const LIST_URL = "https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4";
// (2026.08 V4→V5 전환: V3 목록 API와 같은 시점에 승인이 갱신된 것으로 보여 같이 전환. 수민이 캡처해준
// 실제 승인 화면의 End Point/오퍼레이션명 그대로 사용(getAphusBassInfoV5/getAphusDtlInfoV5) — 필드명은
// V4와 동일할 것으로 추정되나(응답 구조 자체가 바뀌었단 언급 없었음) 실전 검증 전이라 결과 필드가
// 비어있게 나오면(hh===0 등) 여기부터 의심할 것)
const BASIS_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusBassInfoV5";
// hhcnt.mjs와 동일: 지하철호선/도보시간은 getAphusDtlInfoV5(상세정보)에만 있음 (기본정보 API엔 없음)
const DTL_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV5/getAphusDtlInfoV5";
const DIR = "data/hhcnt";

// hhcnt.mjs의 SPLIT_FALLBACK과 동일 (목록조회는 시군구코드 하나면 되므로 신규코드 우선 + 통합폐지코드 폴백)
const SPLIT_FALLBACK = {
  "HS-": { codes: { "동탄구": "41597", "만세구": "41591", "병점구": "41595", "효행구": "41593" }, old: "41590" },
  "BC-": { codes: { "원미구": "41192", "소사구": "41194", "오정구": "41196" }, old: "41190" },
  "IC-": { codes: { "제물포구": "28125", "영종구": "28155", "서해구": "28275", "검단구": "28290" }, old: null },
};

function resolveSigungu(lawd) {
  if (/^\d{5}$/.test(lawd)) return [lawd];
  const prefix = Object.keys(SPLIT_FALLBACK).find((p) => lawd.startsWith(p));
  if (!prefix) return [];
  const cfg = SPLIT_FALLBACK[prefix];
  const code = cfg.codes[lawd.slice(prefix.length)];
  if (!code) return [];
  return cfg.old ? [code, cfg.old] : [code];
}

function extractItems(json) {
  const body = json && json.response && json.response.body;
  if (!body) return null;
  if (body.item && !body.items) return [body.item];
  const items = body.items;
  if (!items) return [];
  if (typeof items === "string") return [];
  if (Array.isArray(items)) return items;
  const item = items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function fetchList(key, sgg) {
  try {
    const r = await fetch(`${LIST_URL}?serviceKey=${encodeURIComponent(key)}&sigunguCode=${sgg}&pageNo=1&numOfRows=1000&_type=json`, {
      signal: AbortSignal.timeout(20000), // 응답 없이 무한 대기해 pool() 전체가 안 끝나는 것 방지
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { return []; }
    const rawItems = extractItems(json);
    if (!rawItems) return [];
    return rawItems
      .map((it) => ({ kaptCode: it.kaptCode || it.kaptcode || "", kaptName: it.kaptName || it.kaptname || "" }))
      .filter((it) => it.kaptCode && it.kaptName);
  } catch {
    return []; // 타임아웃/네트워크 오류로 한 지역 목록조회가 실패해도 전체 스크립트가 죽지 않게
  }
}

async function fetchBasis(key, kaptCode) {
  try {
    const r = await fetch(`${BASIS_URL}?serviceKey=${encodeURIComponent(key)}&kaptCode=${encodeURIComponent(kaptCode)}&_type=json`, {
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { return null; }
    const rawItems = extractItems(json);
    if (!rawItems || !rawItems.length) return null;
    const it = rawItems[0];
    const hh = parseInt(String(it.kaptdaCnt ?? "").replace(/,/g, ""), 10);
    if (!hh) return null;
    const dongRaw = parseInt(String(it.kaptDongCnt ?? "").replace(/,/g, ""), 10);
    // kaptAddr(지번주소)·bjdCode(법정동코드)는 세대수 표시엔 안 쓰지만, 2026.08부터 공급면적 배치
    // (collect-supply-area.mjs)가 건축HUB API 호출용 주소 코드를 만드는 데 재사용 — 같은 API 응답에
    // 이미 포함돼 있어 추가 호출 없이 그냥 같이 저장해두는 것
    const kaptAddr = (it.kaptAddr && String(it.kaptAddr).trim()) || null;
    const bjdCode = (it.bjdCode && String(it.bjdCode).trim()) || null;
    return { hhcnt: hh, dongCnt: dongRaw || null, useDate: it.kaptUsedate || null, kaptAddr, bjdCode };
  } catch { return null; }
}

// subwayStation(역명)은 값 있는 단지도 있고 null인 단지도 있음(2026.08 확인) — 있으면 저장
async function fetchDtl(key, kaptCode) {
  try {
    const r = await fetch(`${DTL_URL}?serviceKey=${encodeURIComponent(key)}&kaptCode=${encodeURIComponent(kaptCode)}&_type=json`, {
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { return {}; }
    const rawItems = extractItems(json);
    if (!rawItems || !rawItems.length) return {};
    const it = rawItems[0];
    const subwayLines = String(it.subwayLine || "").split(",").map((s) => s.trim()).filter(Boolean);
    const subwayWalk = (it.kaptdWtimesub && String(it.kaptdWtimesub).trim()) || null;
    const subwayStation = (it.subwayStation && String(it.subwayStation).trim()) || null;
    if (!subwayLines.length && !subwayWalk && !subwayStation) return {};
    return { subwayLines, subwayWalk, subwayStation };
  } catch { return {}; }
}

async function pool(items, limit, worker) {
  let i = 0;
  async function run() { while (i < items.length) { const idx = i++; await worker(items[idx]); } }
  await Promise.all(Array.from({ length: limit }, run));
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) { console.error("DATA_GO_KR_KEY 환경변수가 없습니다."); process.exit(1); }
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const lawds = args.only ? args.only.split(",") : ALL_LAWDS;

  await mkdir(DIR, { recursive: true });
  let done = 0;
  for (const lawd of lawds) {
    const sggs = resolveSigungu(lawd);
    if (!sggs.length) continue;
    const lists = await Promise.all(sggs.map((s) => fetchList(key, s)));
    // 같은 kaptCode가 신규/구코드 양쪽에 잡힐 수 있어 중복 제거
    const seen = new Set();
    const complexes = [];
    for (const list of lists) for (const it of list) {
      if (seen.has(it.kaptCode)) continue;
      seen.add(it.kaptCode);
      complexes.push(it);
    }

    const out = [];
    await pool(complexes, 8, async (c) => {
      const [basis, dtl] = await Promise.all([fetchBasis(key, c.kaptCode), fetchDtl(key, c.kaptCode)]);
      if (basis) out.push({ name: c.kaptName, kaptCode: c.kaptCode, ...basis, ...dtl });
    });

    await writeFile(path.join(DIR, `${lawd}.json`), JSON.stringify({ items: out, updatedAt: new Date().toISOString() }));
    done++;
    console.log(`[hhcnt] ${lawd}: 단지 ${complexes.length}개 중 ${out.length}개 세대수 확보 (${done}/${lawds.length})`);

    if (done % COMMIT_EVERY === 0) {
      // [skip ci]: 중간 커밋은 데이터가 아직 완결되지 않았으므로 Netlify 빌드를 유발하지 않게 함
      // (완료 커밋·크래시 커밋은 아래에서 skip ci 없이 남겨둬 실제 배포가 트리거되게 함)
      commitProgress(`chore: 세대수 배치 수집 중간 커밋 (${done}/${lawds.length}) ${new Date().toISOString()} [skip ci]`);
    }
  }

  commitProgress(`chore: 세대수 배치 수집 완료 커밋 ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  commitProgress(`chore: 세대수 배치 수집 중단 시점까지 커밋 ${new Date().toISOString()}`);
  process.exit(1);
});
