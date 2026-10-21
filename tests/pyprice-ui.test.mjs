import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('평당가 랭킹은 공통 슬라이더를 표시하지 않는다',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/style\.display = \['region','volume','gap','newhigh','newlow','longtermrise','jeonselongtermrise','pricebandrise'\]\.includes\(m\)/);
});
