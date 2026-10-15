import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import '../shared/complex-identity.js';
const identity=globalThis.aptsumComplexIdentity;
const names={'롯데캐슬 이스트폴|자양동':'롯데캐슬이스트폴','옛이름|동':'새이름'};
const t=(apt,umd='자양동')=>({apt,umd,area:84,amt:10,ym:'202609',d:'01'});
test('검색 목록·매매·분양권이 같은 정규화를 사용하고 원래 이름은 보존한다',()=>{
 const sales=[t('이스트폴')],presales=[t('롯데캐슬 이스트폴'),t('이스트폴')];
 const index=identity.indexEntries([...sales,...presales],{lawd:'11215',region:'광진구'},names);
 assert.equal(index.length,1);assert.equal(index[0].name,'롯데캐슬이스트폴');assert.ok(index[0].names.includes('이스트폴'));
 const merged=identity.mergeSources(sales,presales,names,'11215');assert.equal(merged.length,3);assert.ok(merged.every(x=>x.apt===index[0].name));assert.equal(merged[1].sourceApt,'롯데캐슬 이스트폴');
 for(const row of merged)assert.ok(index[0].names.includes(row.apt)||index[0].names.includes(row.sourceApt));
});
test('브랜드가 짧게 겹치거나 동·단지 번호가 다르면 합치지 않는다',()=>{
 const merged=identity.mergeSources([t('삼성','길동'),t('우성1차','천호동')],[t('삼성래미안','길동'),t('삼성','천호동'),t('우성2차','천호동')],{},'11740');
 assert.deepEqual(merged.map(x=>[x.apt,x.umd]),[['삼성','길동'],['우성1차','천호동'],['삼성래미안','길동'],['삼성','천호동'],['우성2차','천호동']]);
});
test('명시적 이름 대응표와 공백 차이를 모든 단지에 적용한다',()=>{
 const source=[t('옛 이름','동'),t('새이름','동'),t('새이름','다른동')];
 const index=identity.indexEntries(source,{lawd:'11620'},names);assert.equal(index.length,2);
 assert.equal(identity.mergeSources(source,[],names,'11620')[0].apt,'새이름');
});
test('전체 검색 목록은 모든 별칭으로 자기 단지를 찾으며 동일 지역·동의 중복 표시가 없다',()=>{
 const entries=JSON.parse(readFileSync(new URL('../data/complex-index.json',import.meta.url),'utf8')).entries;
 const ids=new Set();
 for(const row of entries){const id=JSON.stringify([row.lawd,row.umd,identity.key(row.name)]);assert.ok(!ids.has(id));ids.add(id);assert.ok(row.names.includes(row.name));}
});
test('선택 후보의 실제 거래 매칭은 매매·분양권 합산 후에도 정상이다',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),c=vm.createContext({aptsumComplexIdentity:identity});
 vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'),html.indexOf('function analyzeComplex(')),c);
 const merged=identity.mergeSources([t('이스트폴')],[t('롯데캐슬 이스트폴')],names,'11215');
 for(const query of ['이스트폴','롯데캐슬이스트폴','롯데캐슬 이스트폴 [자양동]'])assert.equal(c.matchComplex(merged,query,'11215').hits.length,2);
});
