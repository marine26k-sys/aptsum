import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 단지 분석 이름 매칭(matchComplex) — K-apt·검색어 표기와 국토부 실거래 등록명이 다른 경우(2026.10)
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('const APT_ALIASES'), html.indexOf('function analyzeComplex(')) + '\nthis.matchComplex = matchComplex;', ctx);
const names = m => JSON.parse(JSON.stringify(m.multi ? m.multi.slice().sort() : [...new Set(m.hits.map(t => t.apt))]));
const T = (apt, umd) => ({ apt, umd });

test('관악드림타운: 짧은 단지명("관악") 대신 실거래 등록명 관악드림(삼성)/(동아)를 찾는다', () => {
  const all = [T('관악','봉천동'), T('관악드림(삼성)','봉천동'), T('관악드림(동아)','봉천동'), T('봉천동아','봉천동'), T('동아타운','봉천동')];
  for (const q of ['관악드림타운', '관악드림타운제2', '관악 드림타운 아파트'])
    assert.deepEqual(names(ctx.matchComplex(all, q)), ['관악드림(동아)', '관악드림(삼성)'], q);
  assert.deepEqual(names(ctx.matchComplex(all, '관악')), ['관악']);
  // "타운" 접미사 제거는 마지막 단계 — 더 정확히 일치하는 단지가 있으면 그쪽만
  assert.deepEqual(names(ctx.matchComplex(all, '봉천동아제2')), ['봉천동아']);
});

test('브랜드 표기·아파트 접미사·괄호·법정동 접두어 차이를 흡수한다', () => {
  const cases = [
    [[T('e편한세상수택센트럴파크','수택동'), T('수택주공','수택동')], 'e-편한세상 수택 센트럴파크 아파트', 'e편한세상수택센트럴파크'],
    [[T('이편한세상화랑대','공릉동')], 'e편한세상화랑대아파트', '이편한세상화랑대'],
    [[T('성내동삼성아파트','성내동'), T('삼성광나루','광장동')], '성내삼성', '성내동삼성아파트'],
    [[T('종암에스케이','종암동')], '종암SK', '종암에스케이'],
    [[T('길음뉴타운9단지(래미안)','길음동'), T('길음뉴타운8단지(래미안)','길음동')], '래미안길음뉴타운9단지', '길음뉴타운9단지(래미안)'],
    [[T('양평현대성우(1단지)','양평동'), T('양평현대성우(2단지)','양평동'), T('양평현대','양평동')], '양평현대성우1단지', '양평현대성우(1단지)'],
    [[T('쌍용','성수동1가')], '성수쌍용', '쌍용'],
  ];
  for (const [all, q, want] of cases) assert.deepEqual(names(ctx.matchComplex(all, q)), [want], q);
});

test('번호가 다른 단지는 부분 일치로 섞지 않는다', () => {
  const all = [T('마곡엠밸리1단지','마곡동'), T('마곡엠밸리15단지','마곡동')];
  assert.deepEqual(names(ctx.matchComplex(all, '마곡엠밸리14단지')), []);
});

test('역세권 탭 이름 해석(resolveAptName)도 같은 표기 차이 폴백을 쓰고, 여러 단지면 null', () => {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const APT_ALIASES'), html.indexOf('function analyzeComplex(')) + '\n' +
    html.slice(html.indexOf('function resolveAptName('), html.indexOf('async function searchSubway(')) + '\nthis.resolveAptName = resolveAptName;', c);
  const all = ['관악', '관악드림(삼성)', '관악드림(동아)', '성내동삼성아파트'];
  const umd = new Map(all.map(n => [n, n.startsWith('성내') ? '성내동' : '봉천동']));
  assert.equal(c.resolveAptName(all, '관악드림타운', umd), null); // 예전엔 "관악" 가격이 붙었다
  assert.equal(c.resolveAptName(all, '성내삼성', umd), '성내동삼성아파트');
  assert.equal(c.resolveAptName(all, '관악', umd), '관악');
});
