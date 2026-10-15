import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {excludeConfirmedPublicRental,isConfirmedPublicRental} from '../shared/public-rental-exclusions.mjs';
import {applySupplyAreaOverrides} from '../shared/supply-area-loader.mjs';
const item={apt:'마포래미안푸르지오2단지',umd:'아현동',area:36.9796,amt:.7};
test('확인된 공공임대의 단지·동·지역·면적이 모두 일치할 때만 제외한다',()=>{
 assert.equal(isConfirmedPublicRental(item,'11440'),true);
 for(const x of [{...item,area:59.9796},{...item,apt:'다른단지'},{...item,umd:'다른동'},{...item,area:36.5}])assert.equal(isConfirmedPublicRental(x,'11440'),false);
 assert.equal(isConfirmedPublicRental(item,'11680'),false);
});
test('마포 원본 전월세의 일반 평형과 거래를 모두 보존한다',()=>{
 const files=readdirSync(new URL('../data/rent/11440/',import.meta.url)).filter(n=>n.endsWith('.json'));
 const rows=files.flatMap(n=>JSON.parse(readFileSync(new URL('../data/rent/11440/'+n,import.meta.url),'utf8')).items||[]);
 const expected=rows.filter(x=>!isConfirmedPublicRental(x,'11440'));
 assert.deepEqual(excludeConfirmedPublicRental(rows,'11440'),expected);
 const complex=expected.filter(x=>x.apt.includes('마포래미안푸르지오'));
 assert.ok(complex.length);assert.ok(complex.every(x=>x.area>=59));
 assert.ok(rows.length>expected.length);
});
test('공급면적 보정의 자료 조회 실패 여부와 무관하게 일반 분석에서 공공임대를 제외한다',async()=>{
 const normal={...item,area:84.59};const result=await applySupplyAreaOverrides([item,normal],'11440',null);
 assert.deepEqual(result,[normal]);
});
