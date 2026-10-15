import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';
import{matchCompletionFallback,completionFallbackLabel}from'../shared/complex-completion-fallback.mjs';
const now=Date.parse('2026-10-15T15:00:00+09:00');
const row={lawd:'28200',umd:'간석동',names:['인천시청역한신더휴'],hh:469,completionMonth:'2025-12',planned:false};
test('지역 동 단지 이름과 세대수가 일치하는 유일한 매핑만 사용한다',()=>{
 const d={name:'인천시청역 한신더휴',umd:'간석동',hh:{hhcnt:469}};
 assert.equal(matchCompletionFallback([row],d,'28200'),row);
 for(const [value,lawd]of[[{...d,umd:'다른동'},'28200'],[{...d,hh:{hhcnt:470}},'28200'],[d,'11710']])assert.equal(matchCompletionFallback([row],value,lawd),null);
 assert.equal(matchCompletionFallback([row,row],d,'28200'),null);
});
test('엑셀 연차를 복사하지 않고 현재 기준으로 계산하며 예정 상태를 보존한다',()=>{
 assert.equal(completionFallbackLabel(row,now),'2025년 (2년차)');
 const planned={completionMonth:'2026-11',planned:true};
 assert.equal(completionFallbackLabel(planned,now),'2026년 11월 준공 예정');
 assert.equal(completionFallbackLabel(planned,Date.parse('2027-01-01T00:00:00+09:00')),'2026년 11월 준공 예정');
 assert.equal(completionFallbackLabel(null,now),'');
});
test('내보낸 보완표에 중복 식별키나 잘못된 월이 없다',()=>{
 const data=JSON.parse(readFileSync(new URL('../data/complex-completion-fallback.json',import.meta.url),'utf8'));const seen=new Set();
 for(const row of data.entries){assert.match(row.completionMonth,/^\d{4}-(0[1-9]|1[0-2])$/);assert.ok(row.hh>0);for(const name of new Set(row.names.map(n=>n.replace(/\s/g,'')))){const k=[row.lawd,row.umd,name].join('|');assert.ok(!seen.has(k),k);seen.add(k);}}
});
