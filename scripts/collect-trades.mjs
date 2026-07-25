#!/usr/bin/env node
// 국토부 실거래(매매/분양권/전세) 월별 데이터를 지역 전체(서울·경기·인천, 73개 지역)에 대해 미리 수집해
// data/<kind>/<lawd>/<ym>.json 으로 저장한다. Netlify 함수(analyze/presale/rent.mjs)는 이 정적 파일이
// 있으면 국토부 API를 호출하지 않고 그대로 서빙한다 (netlify/functions/_static.mjs 참고).
//
// 사용법:
//   DATA_GO_KR_KEY=xxx node scripts/collect-trades.mjs [--kinds=analyze,presale,rent] [--months=60] [--refresh=4] [--force] [--only=11680,HS-동탄구]
//
// - months: 오늘 기준 과거 몇 개월치를 확보할지 (기본 60 = 5년, 사이트 조회 기간 최대값)
// - refresh: 최근 N개월은 이미 파일이 있어도 항상 다시 조회 (실거래 신고 지연으로 뒤늦게 채워지는 값을 잡기 위함,
//   README의 "최신 4개월 6시간 캐시"와 같은 취지 — 배치는 하루 1회라 4개월을 기본값으로 둠)
// - force: 전체를 무조건 재수집 (최초 백필 재실행 등)
// - only: 특정 지역 코드만 (콤마 구분) — 디버그/부분 재수집용

import { mkdir, writeFile, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { ALL_LAWDS, SPLIT_REGIONS } from "../shared/regions.mjs";
import { fetchText, parseTrade, parsePresale, parseRent } from "../shared/rtms-parse.mjs";

// GitHub Actions가 300분 타임아웃으로 죽거나 스크립트가 도중에 죽어도(API 장애 등) 그때까지
// 받아온 데이터는 살아남도록, kind 하나가 끝날 때마다(또는 catch 시) 바로 커밋·푸시해버린다.
// 커밋 identity(git config user.name/email)는 워크플로의 앞단 스텝에서 미리 설정돼 있어야 함.
function commitProgress(message) {
  try {
    execSync("git add data/analyze data/presale data/rent", { stdio: "inherit" });
    const diff = execSync("git diff --cached --name-only").toString().trim();
    if (!diff) return; // 변경 없으면 커밋 안 함
    execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log(`  (중간 커밋 완료: ${message})`);
  } catch (e) {
    // 커밋 실패해도 데이터 수집 자체는 계속 진행 (다음 중간 커밋이나 워크플로의 always() 스텝이 재시도)
    console.error("  중간 커밋 실패(계속 진행):", e.message);
  }
}

const KIND_CONFIG = {
  analyze: { url: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev", parse: parseTrade, dir: "data/analyze" },
  presale: { url: "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade", parse: parsePresale, dir: "data/presale" },
  rent:    { url: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent", parse: parseRent, dir: "data/rent" },
};

function parseArgs() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }));
  return {
    kinds: args.kinds ? String(args.kinds).split(",") : Object.keys(KIND_CONFIG),
    months: parseInt(args.months, 10) || 60,
    refresh: parseInt(args.refresh, 10) || 4,
    force: !!args.force,
    only: args.only ? String(args.only).split(",") : null,
  };
}

function recentYms(n) {
  const out = [];
  const d = new Date();
  d.setDate(1); // 월말일 오버플로 방지
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out; // 최신월 → 과거월 순
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// 지역코드(lawd) → 실제 조회에 필요한 raw 코드 묶음 해석. 결과: [{code, ymFilter?, dongFilter?}] 형태가 아니라
// analyze.mjs와 동일하게 "이 ym이 신규코드 구간인지 과거 통합코드 구간인지"를 판단해 그때그때 병합한다.
async function fetchMergedMonth(cfg, key, lawd, ym) {
  if (lawd.startsWith("IC-")) return fetchIncheonMonth(cfg, key, lawd.slice(3), ym);
  const prefix = Object.keys(SPLIT_REGIONS).find((p) => lawd.startsWith(p));
  if (!prefix) {
    const r = await fetchText(cfg.url, key, lawd, ym);
    if (r.failed) return null;
    return cfg.parse(r.text, ym);
  }
  const scfg = SPLIT_REGIONS[prefix];
  const gu = lawd.slice(prefix.length);
  const code = scfg.codes[gu];
  const dongs = scfg.dongs[gu];
  if (ym >= scfg.split) {
    const r = await fetchText(cfg.url, key, code, ym);
    if (r.failed) return null;
    return cfg.parse(r.text, ym);
  }
  const [rNew, rOld] = await Promise.all([fetchText(cfg.url, key, code, ym), fetchText(cfg.url, key, scfg.oldCode, ym)]);
  if (rNew.failed || rOld.failed) return null;
  const a = cfg.parse(rNew.text, ym);
  const b = cfg.parse(rOld.text, ym).filter((t) => dongs.includes(t.umd));
  const seen = new Set();
  const merged = [];
  for (const t of [...a, ...b]) {
    const k = `${t.apt}|${t.umd}|${t.area}|${t.amt}|${t.ym}|${t.d}|${t.floor}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(t);
  }
  return merged;
}

async function fetchIncheonMonth(cfg, key, guName, ym) {
  const scfg = SPLIT_REGIONS["IC-"];
  const code = scfg.codes[guName];
  if (ym >= scfg.split) {
    const r = await fetchText(cfg.url, key, code, ym);
    if (r.failed) return null;
    return cfg.parse(r.text, ym);
  }
  if (guName === "제물포구") {
    const [c110, c140] = await Promise.all([fetchText(cfg.url, key, "28110", ym), fetchText(cfg.url, key, "28140", ym)]);
    if (c110.failed || c140.failed) return null;
    const mainland = cfg.parse(c110.text, ym).filter((t) => !scfg.islandDongs.includes(t.umd));
    const dong = cfg.parse(c140.text, ym);
    return [...mainland, ...dong];
  }
  if (guName === "영종구") {
    const r = await fetchText(cfg.url, key, "28110", ym);
    if (r.failed) return null;
    return cfg.parse(r.text, ym).filter((t) => scfg.islandDongs.includes(t.umd));
  }
  if (guName === "서해구") {
    const r = await fetchText(cfg.url, key, "28260", ym);
    if (r.failed) return null;
    return cfg.parse(r.text, ym).filter((t) => !scfg.geomdanDongs.includes(t.umd));
  }
  if (guName === "검단구") {
    const r = await fetchText(cfg.url, key, "28260", ym);
    if (r.failed) return null;
    return cfg.parse(r.text, ym).filter((t) => scfg.geomdanDongs.includes(t.umd));
  }
  return null;
}

// 동시 실행 개수 제한 큐 (data.go.kr에 과도한 동시요청 방지)
async function pool(items, limit, worker) {
  let i = 0, ok = 0, fail = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { await worker(items[idx]); ok++; }
      catch (e) { fail++; console.error("  실패:", items[idx], e.message); }
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return { ok, fail };
}

async function main() {
  const opt = parseArgs();
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) { console.error("DATA_GO_KR_KEY 환경변수가 없습니다."); process.exit(1); }

  const lawds = opt.only || ALL_LAWDS;
  const yms = recentYms(opt.months);
  const refreshSet = new Set(yms.slice(0, opt.refresh)); // 최신 N개월

  for (const kind of opt.kinds) {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) { console.error(`알 수 없는 kind: ${kind}`); continue; }
    console.log(`\n=== ${kind} 수집 시작 (지역 ${lawds.length}개 × 최대 ${yms.length}개월) ===`);

    const tasks = [];
    for (const lawd of lawds) {
      for (const ym of yms) {
        tasks.push({ lawd, ym });
      }
    }

    const { ok, fail } = await pool(tasks, 8, async ({ lawd, ym }) => {
      const dir = path.join(cfg.dir, lawd);
      const file = path.join(dir, `${ym}.json`);
      if (!opt.force && !refreshSet.has(ym) && (await exists(file))) return; // 과거월 + 이미 있음 → 스킵

      const items = await fetchMergedMonth(cfg, key, lawd, ym);
      if (items === null) throw new Error(`${lawd} ${ym} fetch 실패`); // 실패는 파일을 안 남겨서 다음 실행 때 재시도됨

      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ ym, items, updatedAt: new Date().toISOString() }));
    });
    console.log(`${kind}: 성공 ${ok}건, 실패 ${fail}건 (총 ${tasks.length}건 중 스킵 제외)`);
    commitProgress(`chore: ${kind} 실거래 배치 수집 중간 커밋 ${new Date().toISOString()}`);
  }
}

main().catch((e) => {
  console.error(e);
  commitProgress(`chore: 실거래 배치 수집 중단 시점까지 커밋 ${new Date().toISOString()}`); // 죽기 직전까지라도 커밋
  process.exit(1);
});
