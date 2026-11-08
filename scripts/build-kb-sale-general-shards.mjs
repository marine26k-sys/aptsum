#!/usr/bin/env node
// Build small lawd-scoped lookup files so complex analysis never downloads the full KB snapshot.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REGIONS } from '../shared/regions.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const snapshot = JSON.parse(await readFile(path.join(ROOT, 'data/kb-sale-general.json'), 'utf8'));
const targets = JSON.parse(await readFile(path.join(ROOT, 'data/kb-sale-general-targets.json'), 'utf8'));
const regionLawds = new Map(REGIONS.flatMap(([city, districts]) =>
  districts.map(([district, lawd]) => [`${city}|${district}`, lawd])));
const targetById = new Map(targets.items.map(row => [Number(row.naverId), row]));
const shards = new Map();

for (const complex of snapshot.complexes) {
  const target = targetById.get(Number(complex.naverId));
  if (!target) throw new Error(`KB complex missing Naver target: ${complex.naverId}`);
  const lawd = regionLawds.get(`${target.city}|${target.district}`);
  if (!lawd) throw new Error(`Region code missing: ${target.city} ${target.district}`);
  if (!shards.has(lawd)) shards.set(lawd, []);
  shards.get(lawd).push({
    name: complex.name,
    dong: complex.dong,
    url: complex.url,
    areas: complex.areas.map(area => ({
      type: area.type,
      exclusiveM2: area.exclusiveM2,
      supplyM2: area.supplyM2,
      households: area.households,
      saleGeneralManwon: area.saleGeneralManwon,
    })),
  });
}

const outputDir = path.join(ROOT, 'data/kb-sale-general');
await mkdir(outputDir, { recursive: true });
const expected = new Set([...shards.keys()].map(lawd => `${lawd}.json`));
for (const file of await readdir(outputDir)) {
  if (file.endsWith('.json') && !expected.has(file)) await rm(path.join(outputDir, file));
}
for (const [lawd, complexes] of shards) {
  const data = {
    schemaVersion: snapshot.schemaVersion,
    collectedAt: snapshot.collectedAt,
    kbReferenceDate: snapshot.kbReferenceDate,
    complexes: complexes.sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.dong.localeCompare(b.dong, 'ko')),
  };
  await writeFile(path.join(outputDir, `${lawd}.json`), JSON.stringify(data), 'utf8');
}
console.log(`Built ${shards.size} KB sale lookup shards for ${snapshot.matchedComplexCount} complexes.`);
