import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../map.html',import.meta.url),'utf8');

test('지도 탐색은 기존 단지 분석으로 연결되는 가격 마커 화면을 제공한다',()=>{
  assert.match(html,/id="map"[^>]*aria-label="단지 가격 지도"/);
  assert.match(html,/regional-change-details/);
  assert.match(html,/nearby-schools/);
  assert.match(html,/index\.html\?m=complex&r=/);
  assert.match(html,/단지분석 상세 보기/);
});

test('지도 탐색은 가격·평형·연식 검색과 분석 레이어를 제공한다',()=>{
  for(const id of ['query','priceMin','priceMax','py','age','apply','reset']) assert.match(html,new RegExp(`id="${id}"`));
  for(const layer of ['price','high','low','traffic']) assert.match(html,new RegExp(`data-layer="${layer}"`));
  assert.match(html,/MapTypeId\.TRAFFIC/);
  assert.match(html,/rate>0/);
  assert.match(html,/rate>-5/);
});

test('메인 탭에서 지도 탐색으로 이동할 수 있고 기존 단지 분석 탭은 유지된다',()=>{
  const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/id="tabMap" href="\.\/map\.html"/);
  assert.match(index,/id="tabC" href="\.\/index\.html\?m=complex"/);
});
