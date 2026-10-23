import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('메인 화면은 APTSUM 스타일의 검색 우선 탐색 영역을 제공한다',()=>{
  assert.match(html,/id="homeExplorer"/);
  assert.match(html,/id="homeSearchForm"/);
  assert.match(html,/우리 단지 보기/);
  assert.match(html,/저평가 찾기/);
  assert.match(html,/예산별 실매물/);
  assert.match(html,/전체 분석 도구 보기/);
});

test('분석 화면에서는 홈 탐색 영역을 숨기고 기존 분석 화면을 유지한다',()=>{
  assert.match(html,/html\.analysis-page #homeExplorer\{display:none!important\}/);
  assert.match(html,/html\.analysis-menu:not\(\.home-tools-open\) \.tabs\{display:none\}/);
});

test('홈 검색은 기능어와 단지명 검색을 구분한다',()=>{
  assert.match(html,/words:\['급매','급매물'\],url:'\.\/index\.html\?m=listingurgent'/);
  assert.match(html,/words:\['신고가'\],url:'\.\/index\.html\?m=newhigh'/);
  assert.match(html,/fetch\('\.\/data\/complex-index\.json'/);
  assert.match(html,/m=complex&r=\$\{encodeURIComponent\(hit\.lawd\)\}&q=/);
});
