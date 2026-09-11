#!/usr/bin/env node
// apt.wiki에서 특정 단지의 위키 문서를 가져와 카드 생성에 필요한 정보를 구조화해
// data/apt-wiki-cache/<단지명>.json 으로 저장한다 (개인 참고용 — apt.wiki robots.txt는
// /api/, /wiki/*/edit, /wiki/*/history 를 제외한 일반 문서 조회를 허용함).
//
// 사용법: node scripts/apt-wiki-card.mjs "평촌래미안푸르지오"
//
// 장점/단점/타임라인처럼 이미 구조화된 항목은 그대로 뽑아내고, 나머지 서술형 섹션(입지·교육·
// 커뮤니티 등)은 원문 문단을 h2 제목별로 모아두기만 한다 — 카드 문구로 다듬는 건 사람이
// (또는 대화로) 하는 편이 요약 품질이 낫고, 페이지 전체를 매번 다시 안 읽어도 되게 해준다.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UA = "Mozilla/5.0 (compatible; aptsum-personal-tool/1.0)";

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

async function fetchWikiPage(name) {
  const url = `https://apt.wiki/wiki/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  return { url, html: await res.text() };
}

function extractHeader(html) {
  const title = stripTags(html.match(/<h1 class="title">(.*?)<\/h1>/s)?.[1] ?? "");
  const subtitle = stripTags(html.match(/<p class="subtitle">(.*?)<\/p>/s)?.[1] ?? "");
  return { title, subtitle };
}

// apt.wiki 문서엔 같은 h3 클래스(h3-pos/h3-neg)를 쓰는 목록이 여러 번 나올 수 있다
// (예: 여담의 "주민만 아는 단점" vs 마지막 "8. 주민 평가"의 정식 "장점"/"단점·유의점").
// headingText로 정확한 제목을 지정해 원하는 목록만 골라낸다.
function extractList(html, cls, headingText) {
  const re = new RegExp(`<h3 class="h3 ${cls}"[^>]*>(.*?)</h3>\\s*<ul>(.*?)</ul>`, "gs");
  let listHtml = "";
  for (const m of html.matchAll(re)) {
    if (stripTags(m[1]) === headingText) listHtml = m[2];
  }
  const items = [...listHtml.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => {
    const raw = m[1];
    const label = stripTags(raw.match(/<strong[^>]*>(.*?)<\/strong>/s)?.[1] ?? "");
    const desc = stripTags(raw.replace(/<strong[^>]*>.*?<\/strong>/s, "")).replace(/^:\s*/, "");
    return label ? { label, desc } : { label: stripTags(raw), desc: "" };
  });
  return items;
}

// 일부 문서는 장점/단점을 <ul><li> 목록이 아니라 "장점으로는 ... 꼽힌다." 식의 서술형
// 문단(+ 뒤따르는 입주민 한줄평 인용)으로 적는다. 목록 추출이 비면 이 형태로 재시도한다.
function extractProse(html, keyword) {
  const paraRe = new RegExp(
    `<p class="wp"[^>]*><strong class="kw">${keyword}</strong>(.*?)</p>\\s*(?:<blockquote class="wq"[^>]*>\\s*<p class="wp"[^>]*>(.*?)</p>)?`,
    "s"
  );
  const m = html.match(paraRe);
  if (!m) return null;
  return { text: stripTags(m[1]).replace(/^\s*[.,]?\s*/, `${keyword} `), quote: m[2] ? stripTags(m[2]) : "" };
}

function extractTimeline(html) {
  const events = [...html.matchAll(
    /<div class="timeline-event[^"]*">.*?<div class="timeline-date">(.*?)<\/div>.*?<div class="timeline-body">(.*?)<\/div>/gs
  )].map((m) => ({ date: stripTags(m[1]), text: stripTags(m[2]) }));
  return events;
}

function extractSections(html) {
  // h2 제목과 그 다음 h2 전까지의 본문을 통째로 묶는다 (표/목차/사이드바용 h2도 섞여 들어올 수 있어
  // 짧은 항목은 호출부에서 걸러 쓰면 됨).
  const heads = [...html.matchAll(/<h2 class="h2"[^>]*>(.*?)<a class="sec-edit"/gs)];
  const sections = {};
  for (let i = 0; i < heads.length; i++) {
    const name = stripTags(heads[i][1]);
    const start = heads[i].index + heads[i][0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : html.length;
    sections[name] = stripTags(html.slice(start, end)).slice(0, 4000);
  }
  return sections;
}

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('사용법: node scripts/apt-wiki-card.mjs "단지명"');
    process.exit(1);
  }

  const page = await fetchWikiPage(name);
  if (!page) {
    console.error(`apt.wiki에서 "${name}" 문서를 찾을 수 없습니다 (직접 URL 매칭 실패).`);
    process.exit(1);
  }

  const { title, subtitle } = extractHeader(page.html);
  let pros = extractList(page.html, "h3-pos", "장점");
  let cons = extractList(page.html, "h3-neg", "단점·유의점");
  let prosProse = null;
  let consProse = null;
  if (pros.length === 0) prosProse = extractProse(page.html, "장점");
  if (cons.length === 0) consProse = extractProse(page.html, "단점");
  const timeline = extractTimeline(page.html);
  const sections = extractSections(page.html);

  const result = {
    name,
    sourceUrl: page.url,
    title,
    subtitle,
    pros,
    cons,
    prosProse,
    consProse,
    timeline,
    sections,
  };

  const outDir = path.join("data", "apt-wiki-cache");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${name}.json`);
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`저장됨: ${outPath}`);
  console.log(`- 제목: ${title}`);
  console.log(`- 부제: ${subtitle}`);
  console.log(
    `- 장점 ${pros.length}개${prosProse ? "(서술형 문단 대체)" : ""}, ` +
      `단점 ${cons.length}개${consProse ? "(서술형 문단 대체)" : ""}, 타임라인 ${timeline.length}건`
  );
  console.log(`- 섹션: ${Object.keys(sections).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
