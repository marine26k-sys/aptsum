#!/usr/bin/env node
// 실거래 단지명 → 네이버 부동산 단지명 매핑표(data/naver-names/<lawd>.json) 생성 — 2026.10 신규.
//
// 왜 필요한가: 국토부 실거래 등록명은 "LIG대학마을(건영아파트3차)", "관악드림(삼성)"/"관악드림(동아)"처럼
// 사람들이 실제로 부르는 이름(네이버·호갱노노의 "건영3차", "관악드림타운")과 다른 경우가 많다. 화면에는
// 네이버 단지명을 보여주고, 네이버 단지명으로 검색해도 실거래가 찾히도록 이 표를 쓴다(운영자 요청).
//
// 매칭 기준(법정동 + 세대수 + 단지명, 운영자 지정):
//   1) 같은 구·같은 법정동의 네이버 단지만 후보로 본다.
//   2) 단지명은 naver-name-match.mjs의 공통 정규화 규칙으로 비교한다. 실거래명 전체 외에 괄호 안
//      표기("LIG대학마을(건영아파트3차)"의 "건영아파트3차")로도 시도한다.
//   3) 실거래명이 K-apt 단지(data/hhcnt)에 매칭되면 그 세대수와 네이버 세대수가 같아야 한다.
//      이름으로 못 찾았더라도 같은 법정동에 세대수·준공연도가 모두 같은 네이버 단지가 딱 하나면 채택한다.
//   4) 준공연도가 둘 다 있으면 1년 이내로 같아야 한다(실거래 건축년도 vs 네이버 준공년월).
//   4-1) 정규화한 이름이 정확히 같지 않은 매칭(접두어·접미어만 겹치는 경우 등 — 예: "봉천동아" ↔ "성현동아")은
//        의심 매칭으로 보고, K-apt 세대수가 확인되고 네이버 세대수와 같을 때만 채택한다(운영자 지정).
//   5) 후보가 둘 이상이면 채택하지 않는다(틀린 이름을 보여주느니 실거래명을 그대로 둔다).
//
// 입력: 네이버 단지 매핑표(운영자 제공 엑셀)를 JSON 배열로 바꾼 파일. 엑셀 원본은 저장소에 올리지 않는다.
//   python3 scripts/naver-xlsx-to-json.py <엑셀> <출력.json>
//   node scripts/build-naver-names.mjs --input=<출력.json>

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { REGIONS } from "../shared/regions.mjs";
import { findNaverComplex, sameHouseholds, naverNameKey } from "../shared/naver-name-match.mjs";
import { resolveComplexNames } from "../shared/name-match.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
if (!args.input) { console.error("--input=<네이버 매핑표 JSON> 이 필요합니다."); process.exit(1); }
const rows = JSON.parse(await readFile(args.input, "utf-8"));

const guToLawd = new Map();
for (const [si, list] of REGIONS) for (const [gu, code] of list) guToLawd.set(`${si}|${gu}`, code);

// lawd -> 네이버 단지 목록
const naverByLawd = new Map();
for (const r of rows) {
  const lawd = guToLawd.get(`${r["시"]}|${r["구"]}`);
  if (!lawd || !r["단지명"] || !r["법정동"]) continue;
  if (!naverByLawd.has(lawd)) naverByLawd.set(lawd, []);
  naverByLawd.get(lawd).push({
    name: String(r["단지명"]).trim(), umd: r["법정동"], hh: +r["세대수"] || 0,
    built: r["준공년월"] ? String(r["준공년월"]) : null,
  });
}

const yearOf = (s) => { const m = String(s || "").match(/(19|20)\d\d/); return m ? +m[0] : null; };
const yearOk = (a, b) => a == null || b == null || Math.abs(a - b) <= 1;

// 실거래(매매·분양권·전세) 단지명별 법정동·건축년도
async function tradeMeta(lawd) {
  const meta = new Map(); // 실거래명 -> {umds:Set, buildsByUmd:Map(법정동 -> Map(year->count))}
  for (const kind of ["analyze", "presale", "rent"]) {
    const dir = path.join("data", kind, lawd);
    if (!existsSync(dir)) continue;
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".json")) continue;
      const j = JSON.parse(await readFile(path.join(dir, f), "utf-8"));
      for (const t of j.items || []) {
        if (!t.apt) continue;
        if (!meta.has(t.apt)) meta.set(t.apt, { umds: new Set(), buildsByUmd: new Map() });
        const m = meta.get(t.apt);
        if (!t.umd) continue;
        m.umds.add(t.umd);
        if (!m.buildsByUmd.has(t.umd)) m.buildsByUmd.set(t.umd, new Map());
        const y = yearOf(t.build);
        const builds = m.buildsByUmd.get(t.umd);
        if (y) builds.set(y, (builds.get(y) || 0) + 1);
      }
    }
  }
  return meta;
}

// 끝의 "타운"만 다른 경우("관악드림" ↔ "관악드림타운")는 같은 이름으로 본다
const sameKey = (a, b) => a === b || a.replace(/타운$/, "") === b.replace(/타운$/, "");
function nameVariants(apt) {
  const out = [apt, apt.replace(/\([^)]*\)/g, "")];
  for (const m of apt.matchAll(/\(([^)]*)\)/g)) if (m[1].replace(/[\s\d,~-]|동|단지|차|번지/g, "").length >= 2) out.push(m[1]);
  return [...new Set(out.map((s) => s.trim()).filter((s) => s.length >= 2))];
}

const summary = { total: 0, byName: 0, byHh: 0, none: 0, ambiguous: 0, suspectDropped: 0 };
await mkdir("data/naver-names", { recursive: true });
for (const [lawd, naver] of naverByLawd) {
  if (!existsSync(path.join("data", "analyze", lawd))) continue;
  const meta = await tradeMeta(lawd);
  // 실거래명 -> K-apt 단지(세대수) — 법정동으로 좁히고 표기 차이를 흡수하는 기존 공통 매칭
  let kapt = new Map();
  const hhPath = path.join("data", "hhcnt", `${lawd}.json`);
  if (existsSync(hhPath)) {
    const hh = JSON.parse(await readFile(hhPath, "utf-8"));
    kapt = resolveComplexNames(hh.items || [], new Map([...meta].map(([n, m]) => [n, { umds: m.umds }])));
  }
  const map = {};
  for (const [apt, m] of meta) {
    for (const umd of m.umds) {
      summary.total++;
      const build = [...m.buildsByUmd.get(umd)].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      // 같은 실거래명이 다른 법정동에도 있으면 K-apt 세대수 매칭 결과가 어느 동 것인지 확정할 수 없다.
      const kHh = m.umds.size === 1 ? kapt.get(apt)?.hhcnt || null : null;
      const hits = new Map();
      const local = naver.filter((n) => n.umd === umd);
      if (local.length) {
        const items = Object.fromEntries(local.map((n, i) => [i, n]));
        for (const v of nameVariants(apt)) {
          const hit = findNaverComplex(items, v, { dong: umd, expectedHouseholds: kHh });
          if (!hit || !yearOk(yearOf(hit.built), build)) continue;
          const exactName = sameKey(naverNameKey(v, umd), naverNameKey(hit.name, umd));
          if (!exactName && !(kHh && sameHouseholds(hit.hh, kHh))) { summary.suspectDropped++; continue; }
          hits.set(hit.name, hit);
        }
      }
      let how = "byName";
      if (!hits.size && kHh && build) {
        // 이름으로 못 찾음 → 같은 법정동에서 세대수·준공연도가 모두 같은 네이버 단지가 하나뿐이면 채택
        const same = local.filter((n) => sameHouseholds(n.hh, kHh) && yearOf(n.built) === build);
        if (same.length === 1) { hits.set(same[0].name, same[0]); how = "byHh"; }
      }
      if (hits.size === 1) {
        const hit = [...hits.values()][0];
        if (hit.name !== apt) map[`${apt}|${umd}`] = hit.name;
        summary[how]++;
      } else if (hits.size > 1) summary.ambiguous++;
      else summary.none++;
    }
  }
  await writeFile(path.join("data", "naver-names", `${lawd}.json`), JSON.stringify(map));
}
console.log(summary);
