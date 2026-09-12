#!/usr/bin/env node
// 신설/공사중 지하철 노선(GTX·신안산선·월곶판교선 등, data/subway-lines.json 참고) 관련 최신 뉴스를
// 네이버 뉴스 검색 API로 모아 data/subway-news.json에 저장한다. 미개통 노선의 역 위치·개통상태는
// (README에 적어뒀듯) 공식 구조화 API가 없어 data/subway-lines.json에 수동 정리해두는데, "그 정보가
// 아직 유효한지"를 매번 사람이 뉴스를 찾아 확인하는 부담을 줄이려고 최신 관련 뉴스만 자동으로 붙여준다
// (역 목록·개통상태 자체를 뉴스에서 자동으로 파싱해 덮어쓰지는 않음 — 오탐 위험이 커서 사람 확인 전제로 링크만 제공).
//
// 사용법: NAVER_CLIENT_ID=xxx NAVER_CLIENT_SECRET=yyy node scripts/collect-subway-news.mjs [--only=gtxa,sinansan]
//
// 네이버 오픈API 신청: https://developers.naver.com/apps/#/register (검색 API, 무료 — 일 25,000건)

import { writeFile, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const OUT_FILE = "data/subway-news.json";
const MAX_AGE_DAYS = 180; // 이보다 오래된 뉴스는 "최신 소식"으로서 의미가 낮아 제외
const PER_LINE = 5; // 노선당 최종 노출 개수

// data/subway-lines.json의 표시명("월곶판교선(월판선)" 등)은 검색 쿼리로 그대로 쓰면 괄호 탓에
// 결과가 줄어들 수 있어, 노선별로 검색에 쓸 핵심 키워드를 따로 둔다(이름이 바뀌면 여기도 같이 수정 필요).
const NEWS_QUERY = {
  gtxa: "GTX-A",
  gtxb: "GTX-B",
  gtxc: "GTX-C",
  sinansan: "신안산선",
  wolpan: "월곶판교선",
};

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

async function searchNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=20&sort=date`;
  const res = await fetch(url, {
    headers: { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`네이버 뉴스 검색 실패 (${res.status}): ${query}`);
  const json = await res.json();
  return json.items || [];
}

function toDateOnly(pubDate) {
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function collectLine(id, query) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  let items;
  try {
    items = await searchNews(query);
  } catch (e) {
    console.error(`  [${id}] 검색 실패, 건너뜀:`, e.message);
    return null; // 실패한 노선은 기존 파일의 값을 그대로 유지(아래 merge 참고) — 빈 배열로 덮어쓰지 않음
  }
  const seen = new Set();
  const news = [];
  for (const it of items) {
    const d = new Date(it.pubDate).getTime();
    if (Number.isNaN(d) || d < cutoff) continue;
    const link = it.originallink || it.link;
    if (!link || seen.has(link)) continue;
    // 검색어와 무관한 오검색을 줄이기 위해 제목/요약에 핵심 키워드가 실제로 들어있는지만 최소 확인
    const text = stripHtml(it.title) + " " + stripHtml(it.description);
    if (!text.includes(query)) continue;
    seen.add(link);
    news.push({ title: stripHtml(it.title), link, pubDate: toDateOnly(it.pubDate) });
    if (news.length >= PER_LINE) break;
  }
  return news;
}

async function main() {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.");
    process.exit(1);
  }
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }));
  const only = args.only ? String(args.only).split(",") : null;

  let existing = {};
  try {
    existing = JSON.parse(await readFile(OUT_FILE, "utf8")).lines || {};
  } catch (e) { /* 최초 실행 등 파일이 없으면 빈 값으로 시작 */ }

  const lines = {};
  for (const [id, query] of Object.entries(NEWS_QUERY)) {
    if (only && !only.includes(id)) { if (existing[id]) lines[id] = existing[id]; continue; }
    console.log(`[${id}] "${query}" 검색 중…`);
    const result = await collectLine(id, query);
    lines[id] = result ?? existing[id] ?? [];
    await new Promise((r) => setTimeout(r, 200)); // 호출 간 약간의 간격(요청 폭주 방지)
  }

  const out = { updated: new Date().toISOString().slice(0, 10), lines };
  await writeFile(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`${OUT_FILE} 저장 완료`);

  try {
    execSync(`git add ${OUT_FILE}`, { stdio: "inherit" });
    const diff = execSync("git diff --cached --name-only").toString().trim();
    if (!diff) { console.log("변경 없음 — 커밋 생략"); return; }
    execSync(`git commit -m "chore: 노선 호재 관련 뉴스 갱신 ${out.updated}"`, { stdio: "inherit" });
    for (let attempt = 1; attempt <= 5; attempt++) {
      try { execSync("git push", { stdio: "inherit" }); break; }
      catch (e) {
        if (attempt === 5) throw e;
        console.error(`  push 거절됨, fetch+rebase 후 재시도 (${attempt}/5)`);
        execSync("git fetch origin main", { stdio: "inherit" });
        execSync("git rebase origin/main", { stdio: "inherit" });
      }
    }
  } catch (e) {
    console.error("커밋/푸시 실패:", e.message);
    try { execSync("git rebase --abort", { stdio: "ignore" }); } catch {}
    process.exit(1);
  }
}

main();
