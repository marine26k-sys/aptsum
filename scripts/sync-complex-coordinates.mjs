// Sync confirmed coordinates from the operator-provided complex mapping table.
// Usage: node scripts/sync-complex-coordinates.mjs --master=/path/to/전체_단지_매핑표.json
import {readFile, writeFile} from 'node:fs/promises';
import {REGIONS} from '../shared/regions.mjs';
const arg=process.argv.find(x=>x.startsWith('--master='));
if(!arg)throw Error('--master is required');
const master=JSON.parse(await readFile(arg.slice('--master='.length),'utf8'));
const file='data/complex-coordinates.json';
const current=JSON.parse(await readFile(file,'utf8'));
const regions=new Map(REGIONS.flatMap(([city,rows])=>rows.map(([district,lawd])=>[`${city}|${district}`,lawd])));
const existing=new Map((current.items||[]).map(item=>[String(item.id),item]));
const output=new Map(existing),unknown=[];
let updated=0,added=0,withoutCoordinates=0;
for(const [id,row] of Object.entries(master)){
 const lat=row['위도'],lng=row['경도'];
 if(typeof lat!=='number'||typeof lng!=='number'||lat<33||lat>39||lng<124||lng>132){withoutCoordinates++;continue;}
 const city=row['시'],district=row['구'],umd=row['법정동'],name=row['단지명'];
 const lawd=regions.get(`${city}|${district}`);
 if(!lawd||!umd||!name){unknown.push({id,city,district,name});continue;}
 const old=existing.get(id);
 const item={id,name,city,district,umd,lawd,lat,lng,hh:Number(row['세대수'])||0};
 if(old)updated++;else added++;
 output.set(id,item);
}
const items=[...output.values()];
const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
await writeFile(file,JSON.stringify({source:'전체_단지_매핑표.json',asOf,items}));
console.log(JSON.stringify({masterRows:Object.keys(master).length,updated,added,withoutCoordinates,unknownRegions:unknown.length,total:items.length,unknownExamples:unknown.slice(0,5)},null,2));
