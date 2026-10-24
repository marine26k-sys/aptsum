#!/usr/bin/env node
// 리치고 정비사업 스냅샷 수집기
// 사용법: node scripts/collect-redevelopment.mjs
// 리치고가 제공하는 검색 결과(재건축·재개발)를 모은 뒤 사업지별 상세 일정까지 저장한다.
import { writeFile } from 'node:fs/promises';

const ENDPOINT = 'https://m.richgo.ai/api/mcp';
const QUERIES = process.env.RICHGO_REDEVELOPMENT_QUERIES
  ? process.env.RICHGO_REDEVELOPMENT_QUERIES.split(',').map(x => x.trim()).filter(Boolean)
  : ['재건축', '재개발', '안양'];

async function callTool(id, name, args) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!response.ok) throw new Error(`Richgo ${response.status}`);
  const payload = await response.json();
  if (payload?.result?.structuredContent) return payload.result.structuredContent;
  const text = payload?.result?.content?.find(x => x.type === 'text')?.text;
  if (!text) throw new Error('Richgo 응답이 비어 있습니다.');
  return JSON.parse(text);
}

const found = new Map();
for (const query of QUERIES) {
  const result = await callTool(crypto.randomUUID(), 'search_redevelopment', { query });
  for (const site of result?.sites || []) if (site.site_id) found.set(site.site_id, site);
}

const sites = [];
let completed = 0;
const queue = [...found.keys()];
async function worker() {
  while (queue.length) {
    const siteId = queue.shift();
    try {
      const detail = await callTool(crypto.randomUUID(), 'get_redevelopment', { site_id: siteId });
      if (detail?.site_id) sites.push(detail);
    } catch (error) {
      console.warn(`[redevelopment] ${siteId} 실패: ${error.message}`);
    } finally {
      completed += 1;
      console.log(`[redevelopment] ${completed}/${found.size}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(4, queue.length || 1) }, worker));
sites.sort((a, b) => String(a.region || '').localeCompare(String(b.region || ''), 'ko') || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));

await writeFile('data/redevelopment.json', JSON.stringify({
  source: '리치고(Richgo) m.richgo.ai',
  asOf: new Date().toISOString(),
  query: QUERIES,
  sites,
}, null, 2) + '\n');
console.log(`[redevelopment] 저장 완료: ${sites.length}개 사업지`);
