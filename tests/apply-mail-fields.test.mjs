import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../apply.html',import.meta.url),'utf8');

test('맞춤 선별 메일 제공 항목을 구분 문구 없이 나열한다',()=>{
 const section=html.slice(html.indexOf('<li id="mailBenefit"'),html.indexOf('</li>',html.indexOf('<li id="mailBenefit"')));
 for(const field of ['지역','연차','세대수','지하철 거리','단지명','평형','매매가','전고점','변동률','평당가','동','층','방향','용적률','건폐율','매물 URL'])assert.match(section,new RegExp(`<span>${field}</span>`));
 assert.doesNotMatch(section,/mail-field-label|>단지<|>가격<|>매물</);
 assert.equal((section.match(/<span>/g)||[]).length,16);
});
