import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('최근 갱신 문구는 접수 상태 박스 바로 아래에 표시한다',()=>{
 const html=readFileSync(new URL('../cheongyak.html',import.meta.url),'utf8');
 assert.match(html,/<\/section>\s*<div class="updated" id="updated"><\/div>\s*<section class="panel"/);
});


test('공급 유형과 지역은 알약 선택 버튼으로 제공한다',()=>{
 const html=readFileSync(new URL('../cheongyak.html',import.meta.url),'utf8');
 assert.match(html,/data-filter-id="category" data-value="apt"/);
 assert.match(html,/data-filter-id="category" data-value="remainder"/);
 assert.match(html,/data-filter-id="region" data-value="인천"/);
 assert.match(html,/class="filter-pill on" data-filter-id="category" data-value=""/);
});
