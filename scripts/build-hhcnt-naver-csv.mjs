#!/usr/bin/env node
// 네이버 부동산 크롤링 결과를 CSV(수민 제공, 서울/경기/인천)로 받아 data/hhcnt-naver/<lawd>.json 으로
// 변환한다 — 2026.09. build-hhcnt-naver.mjs(JSON 3파일 입력, 서울만 있던 최초 버전)의 후속으로, 이번엔
// 시/구/동/단지코드/단지명/세대수/준공년월/연차/용적률/건폐율/총동수 컬럼이 한 CSV에 이미 합쳐져 온다.
//
// 사용법: node scripts/build-hhcnt-naver-csv.mjs --csv=<파일경로>
//
// 시/구는 REGIONS의 표기(예: "화성 동탄구", "부천 원미구")와 동일하게 와서 그대로 lawd(pseudo-code
// 포함)로 매핑된다 — build-hhcnt-naver.mjs와 동일한 "시+구" 복합키 매핑(구 이름만으로는 서울/부산처럼
// 겹치는 경우가 있어 반드시 시와 같이 봐야 함).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { REGIONS } from "../shared/regions.mjs";
import { norm, nameKey } from "../shared/name-match.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
if (!args.csv) { console.error("--csv=<파일경로> 가 필요합니다."); process.exit(1); }

// 최소 CSV 파서 — 따옴표로 감싼 필드 안의 쉼표(예: "삼웅1,2차")를 지원한다.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = await readFile(args.csv, "utf-8");
const rows = parseCSV(raw.replace(/^﻿/, "")); // BOM 제거
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

const guToLawd = new Map();
for (const [si, list] of REGIONS) for (const [gu, code] of list) guToLawd.set(`${si}|${gu}`, code);

const byLawd = new Map();
let total = 0, noName = 0, noHh = 0, noRegion = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length < 6) continue;
  const si = row[idx["시"]]?.trim();
  const gu = row[idx["구"]]?.trim();
  const umd = row[idx["동"]]?.trim();
  const name = row[idx["단지명"]]?.trim();
  const hh = +row[idx["세대수"]];
  if (!si || !gu) { noRegion++; continue; }
  const lawd = guToLawd.get(`${si}|${gu}`);
  if (!lawd) { noRegion++; continue; }
  if (!name) { noName++; continue; }
  if (!(hh > 0)) { noHh++; continue; }
  total++;
  const g = (k) => { const v = row[idx[k]]?.trim(); return v ? v : null; };
  const entry = {
    name,
    hh,
    umd: umd || null,
    built: g("준공년월"),
    far: g("용적률") !== null ? +g("용적률") : null,
    bcr: g("건폐율") !== null ? +g("건폐율") : null,
    dongCnt: g("총동수") !== null ? +g("총동수") : null,
  };
  if (!byLawd.has(lawd)) byLawd.set(lawd, new Map());
  const bucket = byLawd.get(lawd);
  const key = norm(name);
  if (!bucket.has(key)) bucket.set(key, []);
  bucket.get(key).push(entry);
}

await mkdir("data/hhcnt-naver", { recursive: true });
let files = 0, saved = 0, dropped = 0;
for (const [lawd, bucket] of byLawd) {
  const items = {};
  for (const [key, arr] of bucket) {
    if (new Set(arr.map((x) => x.hh)).size > 1) { dropped += arr.length; continue; }
    items[key] = arr[0];
    saved++;
  }
  const keyIndex = {};
  for (const key of Object.keys(items)) {
    const k = nameKey(key);
    if (!keyIndex[k]) keyIndex[k] = key;
    else keyIndex[k] = null;
  }
  await writeFile(path.join("data/hhcnt-naver", `${lawd}.json`), JSON.stringify({ items, keyIndex, updatedAt: new Date().toISOString() }));
  files++;
}
console.log(`입력 ${rows.length - 1}행 → 사용 ${total} (이름없음 ${noName} / 세대수없음 ${noHh} / 지역매핑실패 ${noRegion})`);
console.log(`저장: ${files}개 지역 파일, 단지 ${saved}개 (이름충돌로 제외 ${dropped}개)`);
