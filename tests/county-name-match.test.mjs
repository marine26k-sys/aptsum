import test from 'node:test';
import assert from 'node:assert/strict';
import {dongOfAddr,resolveComplexNames} from '../shared/name-match.mjs';

test('county address matching preserves township and ri to avoid cross-town matches',()=>{
  assert.equal(dongOfAddr('경기도 가평군 가평읍 읍내리 766-3 가평블루핀아파트'),'가평읍 읍내리');
  assert.equal(dongOfAddr('경기도 양평군 강상면 병산리 24-1 아파트'),'강상면 병산리');
  assert.equal(dongOfAddr('서울특별시 송파구 가락동 479 헬리오시티아파트'),'가락동');
  const hh=[{name:'블루핀아파트',kaptAddr:'경기도 가평군 가평읍 읍내리 766-3 블루핀아파트',bjdCode:'4182025021',kaptCode:'A1',hhcnt:119}];
  const meta=new Map([['블루핀',{umds:new Set(['가평읍 읍내리']),hh:119}],['다른블루핀',{umds:new Set(['청평면 읍내리']),hh:119}]]);
  const hit=resolveComplexNames(hh,meta);
  assert.equal(hit.get('블루핀'),hh[0]);
  assert.equal(hit.has('다른블루핀'),false);
});
