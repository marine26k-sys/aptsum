import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const LISTING_ASK_MAP_LAYOUT=');
const end=html.indexOf('function listingHeaderHTML(',start);
const regions=[['서울',[['강남구','11680'],['도봉구','11320']]],['경기',[['가평군','41820']]],['인천',[['연수구','28185']]],['부산',[['해운대구','26350']]]];
const lawdToProvince=Object.fromEntries(regions.flatMap(([province,items])=>items.map(([,lawd])=>[lawd,province])));
const ctx=vm.createContext({REGIONS:regions,LAWD_TO_PROVINCE:lawdToProvince,esc:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
vm.runInContext(html.slice(start,end),ctx);

test('호가 지도는 지역별 최저 호가 평균과 매물 수를 표시한다',()=>{
  const out=ctx.listingAskMapHTML({rows:[
    {lawd:'11680',gu:'강남구',ask:10},{lawd:'11680',gu:'강남구',ask:12},{lawd:'11320',gu:'도봉구',ask:4}
  ]});
  assert.match(out,/호가 통계 지도/);
  assert.match(out,/11\.0억/);
  assert.match(out,/2개 매물/);
  assert.match(out,/도봉구/);
  assert.match(out,/background:rgb\(/);
});

test('단지 단독 분석과 호가가 없는 결과에는 지도를 만들지 않는다',()=>{
  assert.equal(ctx.listingAskMapHTML({individual:true,rows:[{lawd:'11680',ask:10}]}),'');
  assert.equal(ctx.listingAskMapHTML({rows:[{lawd:'11680',gu:'강남구',ask:null}]}),'');
});

