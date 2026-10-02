import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { naverNameKey, matchNaverTradeNames, sameHouseholds } from '../shared/naver-name-match.mjs';
import { resolveComplexNames } from '../shared/name-match.mjs';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/naver-name-match.json',import.meta.url)));
test('matches the naver Python regression cases including collisions and numbered siblings',()=>{
  for(const c of fixtures){
    const got=matchNaverTradeNames(new Map(Object.entries(c.candidates)),c.name,c.dong,{...c,legacy:new Map(Object.entries(c.legacy)),reserved:c.reserved===null?null:new Set(c.reserved),ambiguous:new Set(c.ambiguous)});
    assert.deepEqual(got,c.expected,`${c.dong} ${c.name}`);
  }
});
test('keeps builder and apartment number distinctions while matching brand spellings',()=>{
  assert.notEqual(naverNameKey('은하수(벽산)'),naverNameKey('은하수(신성)'));
  assert.notEqual(naverNameKey('마곡엠벨리(14단지)'),naverNameKey('마곡엠벨리(15단지)'));
  assert.equal(naverNameKey('DMCSKVIEW'),naverNameKey('DMCSK뷰'));
  assert.equal(naverNameKey('현대14차(203,204,205,206동)'),naverNameKey('현대14차'));
});
test('requires known positive integer household counts to agree',()=>{
  assert.equal(sameHouseholds(100,100),true);
  for(const pair of [[100,101],[0,0],[null,null],[100,undefined],[100,100.5]])assert.equal(sameHouseholds(...pair),false);
});
test('complex joins reject household or dong mismatch and ambiguous claimants',()=>{
  const h={name:'DMCSK뷰',hhcnt:753,kaptCode:'A',kaptAddr:'서울 은평구 수색동 1 DMCSK뷰',bjdCode:'1138010100'};
  const meta=new Map([['DMCSKVIEW',{umds:new Set(['수색동']),hh:753}]]);
  assert.equal(resolveComplexNames([h],meta).get('DMCSKVIEW'),h);
  assert.equal(resolveComplexNames([{...h,hhcnt:754}],meta).size,0);
  assert.equal(resolveComplexNames([{...h,kaptAddr:'서울 은평구 증산동 1 DMCSK뷰'}],meta).size,0);
  assert.equal(resolveComplexNames([h,{...h,kaptCode:'B'}],meta).size,0);
});

test('reverse lookup requires household equality and does not choose same-size different complexes',async()=>{
  const {findNaverComplex,attachHouseholds}=await import('../shared/naver-name-match.mjs');
  const items={a:{name:'DMCSK뷰',hh:753,umd:'수색동'}};
  assert.equal(findNaverComplex(items,'DMCSKVIEW',{dong:'수색동',expectedHouseholds:753}),items.a);
  assert.equal(findNaverComplex(items,'DMCSKVIEW',{dong:'수색동',expectedHouseholds:754}),null);
  assert.equal(findNaverComplex(items,'DMCSKVIEW',{dong:'증산동',expectedHouseholds:753}),null);
  assert.equal(findNaverComplex({...items,b:{name:'에스케이북한산시티',hh:753,umd:'미아동'}},'SK북한산시티')?.name,'에스케이북한산시티');
  const dup={...items,b:{name:'DMCSKVIEW',hh:753,umd:'증산동'}};
  assert.equal(findNaverComplex(dup,'DMCSK뷰'),items.a);
  assert.equal(findNaverComplex(dup,'DMC에스케이뷰'),null);
  const meta=new Map([['DMCSKVIEW',{umds:new Set(['수색동'])}]]);
  assert.equal(attachHouseholds(meta,items).get('DMCSKVIEW').hh,753);
});
