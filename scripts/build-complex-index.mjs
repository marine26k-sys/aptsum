import {readFile,readdir,writeFile} from 'node:fs/promises';
import {REGIONS} from '../shared/regions.mjs';
import '../shared/complex-identity.js';
const entries=[];
for(const [,regions] of REGIONS)for(const [region,lawd] of regions){
 let names={};try{names=JSON.parse(await readFile(`data/naver-names/${lawd}.json`,'utf8'));}catch{}
 const items=[];
 for(const kind of ['analyze','presale']){
  let files=[];try{files=await readdir(`data/${kind}/${lawd}`);}catch{}
  for(const file of files.filter(f=>/^\d{6}\.json$/.test(f))){const data=JSON.parse(await readFile(`data/${kind}/${lawd}/${file}`,'utf8'));items.push(...(data.items||[]));}
 }
 entries.push(...globalThis.aptsumComplexIdentity.indexEntries(items,{lawd,region},names));
}
await writeFile('data/complex-index.json',JSON.stringify({generatedAt:new Date().toISOString(),entries}));
console.log('단지 검색 목록 생성:',entries.length);
