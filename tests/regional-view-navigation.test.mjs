import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../regional-change.html',import.meta.url),'utf8');

test('기간 전환 버튼은 상단에 고정되고 선택한 화면으로 스크롤한다',()=>{
 assert.match(html,/id="viewControls" class="controls view-controls"/);
 assert.match(html,/\.view-controls\{position:sticky;top:0;/);
 assert.match(html,/target\.scrollIntoView\(\{behavior:/);
 assert.match(html,/ytdView'\)\.onclick=\(\)=>setRegionalView\('ytd',true\)/);
});
