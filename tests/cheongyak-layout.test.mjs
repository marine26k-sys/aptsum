import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('최근 갱신 문구는 접수 상태 박스 바로 아래에 표시한다',()=>{
 const html=readFileSync(new URL('../cheongyak.html',import.meta.url),'utf8');
 assert.match(html,/<\/section>\s*<div class="updated" id="updated"><\/div>\s*<section class="panel"/);
});
