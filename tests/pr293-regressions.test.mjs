import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterNotices,mergeCrossSourceNotices} from '../shared/cheongyak.mjs';

test('병점 cross-source card keeps both notices, correct LH schedule and legacy favorites',()=>{
  const h={category:'apt',pblancNo:'2026000611',region:'경기',name:'병점복합타운 주복1블록 공공분양',total_units:726,apply_start:'2026-12-07',apply_end:'2026-12-10',detail_url:'https://www.applyhome.co.kr/notice',apply_url:'https://www.applyhome.co.kr/apply',schedule:[{label:'1순위',dates:['2026-12-07']}]};
  const l={category:'lh-sale',pblancNo:'LH-0000061217',region:'경기',name:'병점복합타운 주복1블록 공공분양주택 입주자모집공고',detail_url:'https://apply.lh.or.kr/notice'};
  const unrelated={...l,pblancNo:'unrelated'};
  const result=mergeCrossSourceNotices([l,h,unrelated]);
  assert.deepEqual(result.map(x=>x.pblancNo),['2026000611','unrelated']);
  const card=result[0];
  assert.equal(card.total_units,726);
  assert.equal(card.detail_url,h.detail_url);
  assert.equal(card.lh_detail_url,l.detail_url);
  assert.equal(card.apply_url,'');
  assert.deepEqual(card.schedule.map(x=>x.label),['특별공급','일반공급·신생아 우선공급']);
  assert.ok(card.schedule[0].dates[0].endsWith('2026-12-08 17:00'));
  assert.deepEqual(filterNotices(result,{status:'upcoming',category:'lh-sale',favoritesOnly:true,favorites:['lh-sale:LH-0000061217']},'2026-11-28'),[card]);
  assert.deepEqual(mergeCrossSourceNotices([h,unrelated]),[h,unrelated]);
});

test('individual and bulk graph toggles keep visible and accessible state in sync',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const source=html.slice(html.indexOf('function syncListingTrendHistoryControl('),html.indexOf('function listingTrendHistoryHTML('));
  const controls=[];
  for(let i=0;i<2;i++){
    const history={hidden:true},chevron={textContent:'▾'};
    const attrs={'aria-label':'단지 최근 가격 20.0억, 가격 이력 펼치기','aria-expanded':'false'};
    const button={setAttribute:(key,v)=>{attrs[key]=v;},getAttribute:key=>attrs[key],querySelector:()=>chevron,closest:()=>({querySelector:()=>history})};
    history.closest=()=>({querySelector:()=>button});
    controls.push({button,history,attrs,chevron});
  }
  const bulk={textContent:'그래프 전체 펼치기',setAttribute(){}};
  const doc={getElementById:()=>bulk,querySelectorAll:()=>controls.map(c=>c.history)};
  const {one,all}=new Function('document',source+';return {one:toggleListingTrendHistory,all:toggleAllListingTrendHistory};')(doc);
  all();
  assert.ok(controls.every(c=>!c.history.hidden&&c.attrs['aria-expanded']==='true'&&c.attrs['aria-label'].endsWith('접기')&&c.chevron.textContent==='▴'));
  one(controls[0].button);
  assert.equal(bulk.textContent,'그래프 전체 펼치기');
  assert.ok(controls[0].attrs['aria-label'].endsWith('펼치기'));
  all();all();
  assert.ok(controls.every(c=>c.history.hidden&&c.attrs['aria-expanded']==='false'&&c.attrs['aria-label'].endsWith('펼치기')));
});

test('listing gap and both map states label the metric and links correctly',()=>{
  const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const map=readFileSync(new URL('../listing-ask-map.html',import.meta.url),'utf8');
  assert.match(index,/평형·가격을 누르면 네이버 실매물 바로 보기/);
  assert.match(index,/d\.rows\.some\(x=>x\.small\.url\|\|x\.large\.url\)\?listingLinkLegend\(true\)/);
  assert.equal(map.split('단위: 호가 변동률 (%)').length-1,2);
  assert.ok(!map.includes('매매 가격 변동률 (%)'));
});
