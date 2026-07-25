#!/usr/bin/env node
// 국토부 공동주택 단지목록/기본정보 API로 지역별 전체 단지의 세대수를 미리 수집해
// data/hhcnt/<lawd>.json 에 저장한다 (단지명 목록 통째로 저장 → hhcnt.mjs가 매칭만 수행).
// 세대수는 재건축 전까지 거의 안 바뀌는 값이라 배치는 주 1회 정도면 충분(GitHub Actions 스케줄 참고).
//
// 사용법: DATA_GO_KR_KEY=xxx node scripts/collect-hhcnt.mjs [--only=11680,HS-동탄구]

import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { ALL_LAWDS } from "../shared/regions.mjs";

const COMMIT_EVERY = 10; // 이 개수만큼 지역을 처리할 때마다 중간 커밋 (73개 지역 전체 처리 중 죽어도 진행분 보존)

// collect-trades.mjs와 동일한 취지: 300분 타임아웃/중간 크래시에도 그때까지 받은 data/hhcnt는 살아남게 커밋·푸시
function commitProgress(message) {
  try {
    execSync("git add data/hhcnt", { stdio: "inherit" });
    const diff = execSync("git diff --cached --name-only").toString().trim();
    if (!diff) return;
    execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log(`  (중간 커밋 완료: ${message})`);
  } catch (e) {
    console.error("  중간 커밋 실패(계속 진행):", e.message);
  }
}

const LIST_URL = "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3";
const BASIS_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4";
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
    return { hhcnt: hh, dongCnt: dongRaw || null, useDate: it.kaptUsedate || null };
  } catch { return null; }
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
      const basis = await fetchBasis(key, c.kaptCode);
      if (basis) out.push({ name: c.kaptName, kaptCode: c.kaptCode, ...basis });
    });

    await writeFile(path.join(DIR, `${lawd}.json`), JSON.stringify({ items: out, updatedAt: new Date().toISOString() }));
    done++;
    console.log(`[hhcnt] ${lawd}: 단지 ${complexes.length}개 중 ${out.length}개 세대수 확보 (${done}/${lawds.length})`);

    if (done % COMMIT_EVERY === 0) {
      commitProgress(`chore: 세대수 배치 수집 중간 커밋 (${done}/${lawds.length}) ${new Date().toISOString()}`);
    }
  }

  commitProgress(`chore: 세대수 배치 수집 완료 커밋 ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  commitProgress(`chore: 세대수 배치 수집 중단 시점까지 커밋 ${new Date().toISOString()}`);
  process.exit(1);
});
