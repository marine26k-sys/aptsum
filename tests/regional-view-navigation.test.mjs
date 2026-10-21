import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../regional-change.html',import.meta.url),'utf8');

test('기간 선택 상자는 결과 헤더 위에 있고 선택 후 결과로 스크롤한다',()=>{
 const range=html.indexOf("panel.append(range)");
 const heading=html.indexOf("panel.append(toolbar,heading)");
 assert(range>0&&heading>range);
 assert.match(html,/heading\.scrollIntoView\(\{behavior:/);
 assert.match(html,/endSelect\.onchange=\(\)=>updateRange\('end',true\)/);
});
