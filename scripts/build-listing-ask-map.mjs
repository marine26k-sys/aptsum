import { readFile, writeFile } from 'node:fs/promises';
import { REGIONS } from '../shared/regions.mjs';
import { uploadState, sameUploadState, verifiedRegionMetric } from './listing-ask-snapshot-integrity.mjs';

const baseUrl = (process.env.APTSUM_BASE_URL || 'https://aptsum.kr').replace(/\/$/, '');
async function readUploadState() {
  const response = await fetch(`${baseUrl}/api/listings?askMapVersion=1`, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`업로드 상태 조회 실패: HTTP ${response.status}`);
  const data = await response.json();
  return uploadState(data);
}
const sourceState = await readUploadState();
const sourceVersion = sourceState.uploadId;
const entries = REGIONS.flatMap(([province, regions]) => regions.map(([name, lawd]) => ({ province, name, lawd })));
const results = new Array(entries.length);
let cursor = 0;

async function load(entry) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!sourceState.lawds.includes(String(entry.lawd))) return verifiedRegionMetric(entry, null, sourceState);
      const response = await fetch(`${baseUrl}/api/listings?lawd=${encodeURIComponent(entry.lawd)}&askMap=1`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} (${entry.lawd})`);
      const metric = await response.json();
      if (String(metric.lawd) !== String(entry.lawd)) throw new Error(`지역 코드 불일치 (${entry.lawd})`);
      return verifiedRegionMetric(entry, metric, sourceState);
    } catch (cause) {
      error = cause;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw error;
}

async function worker() {
  while (cursor < entries.length) {
    const index = cursor++;
    results[index] = await load(entries[index]);
    console.log(`지도 집계 ${index + 1}/${entries.length}`);
  }
}

await Promise.all(Array.from({ length: 6 }, worker));
if (!sameUploadState(await readUploadState(), sourceState)) throw new Error('집계 중 업로드가 변경되어 다시 실행해야 합니다.');
const asOf = results.reduce((latest, row) => row.asOf && row.asOf > latest ? row.asOf : latest, '');
const outputUrl = new URL('../data/listing-ask-map.json', import.meta.url);
let previous = null;
try { previous = JSON.parse(await readFile(outputUrl, 'utf8')); } catch {}
const signature = value => JSON.stringify({ asOf: value.asOf || '', regions: value.regions || [] });
if (previous && signature(previous) === signature({ asOf, regions: results })) {
  console.log(`지도 데이터 변경 없음: ${asOf || '기준일 없음'}, ${results.length}개 지역`);
} else {
  const output = { generatedAt: new Date().toISOString(), asOf, regions: results };
  await writeFile(outputUrl, `${JSON.stringify(output)}\n`);
  console.log(`지도 데이터 갱신 완료: ${asOf || '기준일 없음'}, ${results.length}개 지역`);
}

// 별도 경량 파일로 전체 지역의 금액대별 집계를 미리 제공한다.
const bandUrl = new URL('../data/listing-ask-price-bands.json', import.meta.url);
const bandRegions = results.map(({lawd, asOf, weekly, priceBandVersion}) => ({lawd, asOf, priceBandVersion, weekly:(weekly||[]).map(({weekStart, asOf, previousAsOf, priceBands}) => ({weekStart, asOf, previousAsOf, priceBands:priceBands||{}}))}));
let oldBands = null;
try { oldBands = JSON.parse(await readFile(bandUrl, 'utf8')); } catch {}
if (!oldBands || (oldBands.sourceVersion || null) !== sourceVersion || JSON.stringify(oldBands.regions) !== JSON.stringify(bandRegions)) {
  await writeFile(bandUrl, `${JSON.stringify({generatedAt:new Date().toISOString(), sourceVersion, regions:bandRegions})}\n`);
  console.log(`금액대별 집계 갱신 완료: ${bandRegions.length}개 지역`);
} else console.log('금액대별 집계 변경 없음');
