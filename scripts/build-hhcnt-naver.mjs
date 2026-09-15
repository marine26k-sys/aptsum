#!/usr/bin/env node
// 네이버 부동산 크롤링 결과(수민 제공)를 data/hhcnt-naver/<lawd>.json 으로 변환한다 — 2026.09 신규.
//
// 왜 필요한가: 기존 세대수 소스인 K-apt(data/hhcnt)는 의무관리대상 공동주택만 등록돼 있어 소규모 단지가
// 통째로 빠지고, 단지명이 "신당남산타운(분양)"처럼 관리용 표기라 실거래명과 잘 안 맞는다. 그래서
// hhcnt.mjs의 matchKapt()가 "한신"을 엉뚱한 202세대 단지로, "두산"을 560세대 임대동으로 매칭하는 일이
// 있었고(MANUAL_OVERRIDE/PARTIAL_OVERRIDE에 손으로 박아둔 이유), 실데이터로 훑어보니 연 회전율이
// 20%를 넘는 비현실적 매칭이 35건 더 있었다.
// 네이버 데이터는 단지명이 실거래 표기에 가깝고 구·동이 같이 오므로 이 두 문제를 동시에 줄인다.
//
// 입력(3개 JSON, ID는 네이버 단지ID로 공통):
//   complex_region_map.json   : { "<id>": {시,구,동} }
//   complex_meta_map.json     : { "<id>": {세대수,준공년월,연차,용적률,건폐율,총동수} }
//   complex_high_map.json     : { "<id>": {단지명, 면적별:[...]} }  ← 단지명 출처(없으면 --names 파일)
//
// 사용법:
//   node scripts/build-hhcnt-naver.mjs --region=a.json --meta=b.json --high=c.json [--names=d.json]
//
// 매칭 단위를 "구"로 잡은 이유: /api/hhcnt는 {lawd, names[]}만 받고 동(umd)을 안 받는다. 동까지 쓰면
// 커버리지가 59.5%, 구 단위면 58.0%로 1.5%p 차이뿐이라(서울 실거래 12개월 기준) API·클라이언트를
// 건드리지 않는 쪽을 택했다. 구 안에서 이름이 겹치고 세대수까지 다르면 아예 저장하지 않아 K-apt로 폴백된다.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { REGIONS } from "../shared/regions.mjs";
import { norm, nameKey } from "../shared/name-match.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
for (const k of ["region", "meta", "high"]) {
  if (!args[k]) { console.error(`--${k}=<파일경로> 가 필요합니다.`); process.exit(1); }
}
const J = async (p) => JSON.parse(await readFile(p, "utf-8"));

const region = await J(args.region);
const meta = await J(args.meta);
const high = await J(args.high);
const extraNames = args.names ? await J(args.names) : {};

// 2026.09 버그 수정 — 구 이름만으로 매핑하면 "중구"(서울 11140 / 부산 26110), "강서구"(서울 11500 /
// 부산 26440)처럼 시·도가 다른데 구 이름이 같은 경우가 뒤 항목(부산)으로 덮어써져서, 서울 신당동(중구)
// 데이터가 부산 중구 파일로, 서울 등촌동(강서구) 데이터가 부산 강서구 파일로 잘못 들어갔다(실행 후
// 발견·수정). "시+구"로 키를 잡아야 구분된다. 네이버 크롤링의 "시" 필드는 "서울"처럼 짧게 오므로
// REGIONS의 시·도명이 그와 일치하는지 확인해서 매핑한다("경기"/"인천"도 마찬가지로 짧은 이름 사용).
const guToLawd = new Map();
for (const [si, list] of REGIONS) for (const [gu, code] of list) guToLawd.set(`${si}|${gu}`, code);

// lawd -> 정규화명 -> [{hh, ...}]
const byLawd = new Map();
let total = 0, noName = 0, noHh = 0, noRegion = 0;
for (const id of Object.keys(region)) {
  const R = region[id];
  const lawd = guToLawd.get(`${R["시"]}|${R["구"]}`);
  if (!lawd) { noRegion++; continue; }
  const name = (high[id] && high[id]["단지명"]) || extraNames[id];
  if (!name) { noName++; continue; }
  const m = meta[id];
  if (!m || !(m["세대수"] > 0)) { noHh++; continue; }
  total++;
  const entry = {
    name,                                   // 화면·디버깅용 원문 표기
    hh: m["세대수"],
    umd: R["동"] || null,
    built: m["준공년월"] || null,            // "1990.09" — K-apt의 useDate보다 정밀
    far: m["용적률"] === "" ? null : m["용적률"],   // 용적률(%)
    bcr: m["건폐율"] === "" ? null : m["건폐율"],   // 건폐율(%)
    dongCnt: m["총동수"] === "" ? null : m["총동수"],
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
    // 같은 구 안에 같은 이름이 여럿인데 세대수까지 다르면 어느 쪽인지 정할 수 없다 → 저장 안 함(K-apt 폴백).
    // 세대수가 전부 같으면(같은 단지가 동별로 쪼개져 등록된 경우 등) 하나만 남겨도 안전하다.
    if (new Set(arr.map((x) => x.hh)).size > 1) { dropped += arr.length; continue; }
    items[key] = arr[0];
    saved++;
  }
  // nameKey(표기 차이를 지운 비교용 키)도 같이 저장해 서버가 매번 계산하지 않게 한다.
  const keyIndex = {};
  for (const key of Object.keys(items)) {
    const k = nameKey(key);
    if (!keyIndex[k]) keyIndex[k] = key;
    else keyIndex[k] = null; // 비교키가 겹치면 모호 → 사용 안 함
  }
  await writeFile(path.join("data/hhcnt-naver", `${lawd}.json`), JSON.stringify({ items, keyIndex, updatedAt: new Date().toISOString() }));
  files++;
}
console.log(`입력 ${Object.keys(region).length}개 단지 → 사용 ${total} (이름없음 ${noName} / 세대수없음 ${noHh} / 지역매핑실패 ${noRegion})`);
console.log(`저장: ${files}개 지역 파일, 단지 ${saved}개 (이름충돌로 제외 ${dropped}개)`);
