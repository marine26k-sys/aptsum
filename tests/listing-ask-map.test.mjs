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

test('호가 통계는 금액대별 결과에 섞이지 않고 별도 탭으로 연결된다',()=>{
  assert.match(html,/id="tabLASK"[^>]*listing-ask-map\.html/);
  const standalone=readFileSync(new URL('../listing-ask-map.html',import.meta.url),'utf8');
  assert.match(standalone,/REGIONAL_LAYOUT/);
  assert.match(standalone,/중층 이상 최저매물 호가/);
  assert.match(html,/function renderListingAskMap\(/);
  const headerStart=html.indexOf('function listingHeaderHTML(');
  const headerEnd=html.indexOf('function listingTrendDate(',headerStart);
  assert.doesNotMatch(html.slice(headerStart,headerEnd),/listingAskMapHTML\(d\)/);
});

test('호가 통계 지도는 전주 대비 변동률을 표시한다',()=>{
  const out=ctx.listingAskMapHTML({rows:[
    {lawd:'11680',gu:'강남구',askRate:2},{lawd:'11680',gu:'강남구',askRate:4},
    {lawd:'11320',gu:'도봉구',askRate:-1}
  ]});
  assert.match(out,/호가 주간 평균 변동률/);
  assert.match(out,/\+3\.0%/);
  assert.match(out,/-1\.0%/);
});

test('호가 통계는 집계 자료가 준비될 때까지 지도를 숨긴다',()=>{
  const standalone=readFileSync(new URL('../listing-ask-map.html',import.meta.url),'utf8');
  assert.match(standalone,/\$\('#monthlyPanel'\)\.hidden=true/);
  assert.match(standalone,/자료를 불러오는 중/);
  assert.match(standalone,/\$\('#monthlyPanel'\)\.hidden=state\.view==='period'/);
});

