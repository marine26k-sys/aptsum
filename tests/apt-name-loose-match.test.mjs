import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 단지 분석 이름 매칭(matchComplex) — K-apt·검색어 표기와 국토부 실거래 등록명이 다른 경우(2026.10)
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) + '\nthis.matchComplex = matchComplex;', ctx);
const names = m => JSON.parse(JSON.stringify((m.multi ? m.multi.slice() : [...new Set(m.hits.map(t => t.apt))]).sort()));
const T = (apt, umd, build) => ({ apt, umd, build });

test('관악드림타운: 짧은 단지명("관악") 대신 시공사별로 나뉜 관악드림(삼성)/(동아)를 합쳐서 찾는다', () => {
  const all = [T('관악','신림동','1982'), T('관악드림(삼성)','봉천동','2003'), T('관악드림(동아)','봉천동','2003'), T('봉천동아','봉천동','2000'), T('동아타운','봉천동','1999')];
  for (const q of ['관악드림타운', '관악드림타운제2', '관악 드림타운 아파트', '관악드림'])
    assert.deepEqual(names(ctx.matchComplex(all, q)), ['관악드림(동아)', '관악드림(삼성)'], q);
  assert.deepEqual(names(ctx.matchComplex(all, '관악')), ['관악']);
  // 괄호 안이 번지·단지 번호이거나 건축연도가 다르면 별개 단지 — 합치지 않고 선택지로
  const diff = [T('유승(126)','관악동','1998'), T('유승(137-1)','관악동','1998'), T('한빛마을(삼성)','A동','1995'), T('한빛마을(현대)','A동','2001')];
  assert.ok(ctx.matchComplex(diff, '유승').multi);
  assert.ok(ctx.matchComplex(diff, '한빛마을').multi);
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
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) + '\n' +
    html.slice(html.indexOf('function resolveAptName('), html.indexOf('async function searchSubway(')) + '\nthis.resolveAptName = resolveAptName;', c);
  const all = ['관악', '관악드림(삼성)', '관악드림(동아)', '성내동삼성아파트'];
  const umd = new Map(all.map(n => [n, n.startsWith('성내') ? '성내동' : '봉천동']));
  // 예전엔 엉뚱한 "관악" 가격이 붙었다 — 이제 시공사별로 나뉜 관악드림 중 하나로 해석
  assert.match(c.resolveAptName(all, '관악드림타운', umd), /^관악드림\((삼성|동아)\)$/);
  assert.equal(c.resolveAptName(all, '성내삼성', umd), '성내동삼성아파트');
  assert.equal(c.resolveAptName(all, '관악', umd), '관악');
});

test('시공사별로 합친 단지는 K-apt 공식 단지명(세대수 최다)으로 표시한다', async () => {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) + '\n' +
    html.slice(html.indexOf('async function kaptNameForSplit('), html.indexOf('async function loadSubwayData(')) +
    '\nthis.kaptNameForSplit = kaptNameForSplit; this.looseAptKey = looseAptKey;', c);
  c.loadSubwayData = async () => [{name:'관악드림타운제2', hhcnt:1843}, {name:'관악드림타운', hhcnt:3544}, {name:'관악', hhcnt:200}];
  const base = c.looseAptKey('관악드림', true);
  assert.equal(await c.kaptNameForSplit('11620', base), '관악드림타운');
  c.loadSubwayData = async () => { throw new Error('x'); };
  assert.equal(await c.kaptNameForSplit('11620', base), null);
});

test('자동완성: 시공사별로 나뉜 등록명은 K-apt 공식 단지명 한 줄로 묶는다', async () => {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) + '\n' +
    html.slice(html.indexOf('async function kaptNameForSplit('), html.indexOf('async function loadSubwayData(')) + '\n' +
    html.slice(html.indexOf('async function mergeSplitSuggestions('), html.indexOf('function acPick(')) +
    '\nthis.mergeSplitSuggestions = mergeSplitSuggestions;', c);
  c.loadSubwayData = async () => [{name:'관악드림타운', hhcnt:3544}];
  const got = JSON.parse(JSON.stringify(await c.mergeSplitSuggestions([
    {name:'관악드림(동아)', umd:'봉천동', n:90}, {name:'관악드림(삼성)', umd:'봉천동', n:67}, {name:'관악', umd:'신림동', n:11}, {name:'유승(126)', umd:'관악동', n:5},
  ], '11620', '관악드림')));
  assert.deepEqual(got.map(a => [a.name, a.n]), [['관악드림타운', 157], ['관악', 11], ['유승(126)', 5]]);
});

test('네이버 단지명 매핑: 네이버 이름으로 검색되고, 같은 네이버 단지의 실거래 등록명은 함께 묶는다', () => {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) + '\nthis.matchComplex = matchComplex; this.NAVER_NAMES = NAVER_NAMES;', c);
  c.NAVER_NAMES['11620'] = { 'LIG대학마을(건영아파트3차)|신림동': '건영3차', '관악드림(삼성)|봉천동': '관악드림타운', '관악드림(동아)|봉천동': '관악드림타운' };
  const all = [T('LIG대학마을(건영아파트3차)','신림동'), T('관악드림(삼성)','봉천동'), T('관악드림(동아)','봉천동'), T('건영4차','신림동')];
  assert.deepEqual(names(c.matchComplex(all, '건영3차', '11620')), ['LIG대학마을(건영아파트3차)']);
  assert.deepEqual(names(c.matchComplex(all, '건영3차 아파트', '11620')), ['LIG대학마을(건영아파트3차)']);
  assert.deepEqual(names(c.matchComplex(all, '관악드림(삼성)', '11620')), ['관악드림(동아)', '관악드림(삼성)']);
  // 지역(lawd)을 모르면 매핑표를 쓰지 않는다(다른 구의 같은 등록명과 섞이지 않게)
  assert.deepEqual(names(c.matchComplex(all, '관악드림(삼성)')), ['관악드림(삼성)']);
});

test('목록형 탭: 네이버 단지명으로 표시하고, 나뉘어 등록된 같은 네이버 단지는 한 줄로 합친다', () => {
  const c = vm.createContext({ sel: { value: '11620' } });
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('const APT_ALIASES')) + '\nthis.NAVER_NAMES = NAVER_NAMES; this.aptLabel = aptLabel; this.unifyNaverSplit = unifyNaverSplit;', c);
  c.NAVER_NAMES['11620'] = { 'LIG대학마을(건영아파트3차)|신림동': '건영3차', '관악드림(삼성)|봉천동': '관악드림타운', '관악드림(동아)|봉천동': '관악드림타운' };
  assert.equal(c.aptLabel({ apt: 'LIG대학마을(건영아파트3차)', umd:'신림동' }), '건영3차');
  assert.equal(c.aptLabel({ apt: '관악' }), '관악');
  assert.equal(c.aptLabel({ apt: 'LIG대학마을(건영아파트3차)', umd:'신림동', lawd: '11680' }), 'LIG대학마을(건영아파트3차)'); // 다른 구 표는 안 씀
  const got = c.unifyNaverSplit([{ apt: '관악드림(삼성)', umd:'봉천동' }, { apt: '관악드림(동아)', umd:'봉천동' }, { apt: 'LIG대학마을(건영아파트3차)', umd:'신림동' }], '11620');
  assert.deepEqual(JSON.parse(JSON.stringify(got.map(t => t.apt))), ['관악드림타운', '관악드림타운', 'LIG대학마을(건영아파트3차)']);
});

test('같은 네이버 이름이라도 법정동이 다르면 거래를 합치지 않고 선택지를 준다', () => {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) +
    '\nthis.matchComplex = matchComplex; this.unifyNaverSplit = unifyNaverSplit; this.NAVER_NAMES = NAVER_NAMES;', c);
  c.NAVER_NAMES['11680'] = { '현대3차(61~64동)|압구정동':'현대3차', '현대아파트3|개포동':'현대3차' };
  const all = [T('현대3차(61~64동)', '압구정동', '1976'), T('현대아파트3', '개포동', '1986')];
  assert.deepEqual(names(c.matchComplex(all, '현대3차(61~64동)', '11680')), ['현대3차(61~64동)']);
  assert.deepEqual(names(c.matchComplex(all, '현대3차', '11680')), ['현대3차(61~64동) [압구정동]', '현대아파트3 [개포동]']);
  assert.ok(c.matchComplex(all, '현대3차', '11680').multi);
  assert.deepEqual(names(c.matchComplex(all, '현대3차(61~64동) [압구정동]', '11680')), ['현대3차(61~64동)']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.unifyNaverSplit(all, '11680').map(t=>t.apt))), ['현대3차(61~64동)', '현대아파트3']);
  const sameDong = [T('관악드림(삼성)', '봉천동', '2003'), T('관악드림(동아)', '봉천동', '2003')];
  c.NAVER_NAMES['11620'] = { '관악드림(삼성)|봉천동':'관악드림타운', '관악드림(동아)|봉천동':'관악드림타운' };
  assert.deepEqual(JSON.parse(JSON.stringify(c.unifyNaverSplit(sameDong, '11620').map(t=>t.apt))), ['관악드림타운', '관악드림타운']);
  const sameRaw = [T('동양파라곤', '논현동', '2004'), T('동양파라곤', '청담동', '2004')];
  assert.deepEqual(names(c.matchComplex(sameRaw, '동양파라곤', '11680')), ['동양파라곤 [논현동]', '동양파라곤 [청담동]']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.matchComplex(sameRaw, '동양파라곤 [청담동]', '11680').hits.map(t=>t.umd))), ['청담동']);
});

test('같은 실거래명도 법정동별로 다른 네이버 이름을 표시한다', () => {
  const map = JSON.parse(readFileSync(new URL('../data/naver-names/11740.json', import.meta.url), 'utf8'));
  assert.equal(map['우성'], undefined);
  assert.equal(map['우성|천호동'], '천호우성');
  const c = vm.createContext({sel:{value:'11680'}});
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('const APT_ALIASES')) + '\nthis.NAVER_NAMES=NAVER_NAMES;this.aptLabel=aptLabel;', c);
  c.NAVER_NAMES['11680'] = JSON.parse(readFileSync(new URL('../data/naver-names/11680.json', import.meta.url), 'utf8'));
  assert.equal(c.aptLabel({apt:'동양파라곤', umd:'논현동'}), '논현동양파라곤');
  assert.equal(c.aptLabel({apt:'동양파라곤', umd:'청담동'}), '청담동양파라곤');
});

test('단계별로 확인한 실거래 별칭은 네이버 이름으로 표시하고 다른 동 번호는 합치지 않는다', () => {
  const cases = [
    ['41117', '신나무실휴먼시아5단지|영통동', '신나무실5단지주공'],
    ['28237', '삼산타운주공1단지|삼산동', '삼산타운1단지'],
    ['HS-동탄구', '동탄2하우스디더레이크|송동', '동탄2신도시하우스디더레이크'],
  ];
  for (const [lawd, key, expected] of cases) {
    const names = JSON.parse(readFileSync(new URL(`../data/naver-names/${lawd}.json`, import.meta.url), 'utf8'));
    assert.equal(names[key], expected);
  }
  const names = JSON.parse(readFileSync(new URL('../data/naver-names/28177.json', import.meta.url), 'utf8'));
  assert.equal(names['광해리드빌(101동)|주안동'], undefined); // 네이버의 102동과 다른 건물
});

test('급지·교통 호재가 공유하는 단지 목록에도 네이버 이름을 사용한다', () => {
  const tier = JSON.parse(readFileSync(new URL('../data/tier-map.json', import.meta.url), 'utf8'));
  for (const [gu, dong, expected] of [
    ['부평구', '삼산동', '삼산타운1단지'],
    ['수원 영통구', '영통동', '신나무실5단지주공'],
    ['화성 동탄구', '송동', '동탄2신도시하우스디더레이크'],
  ]) {
    assert.ok(tier.complexes.some(c => c.gu === gu && c.dong === dong && c.nm === expected), expected);
  }
  assert.ok(!tier.complexes.some(c => c.gu === '부평구' && c.dong === '삼산동' && c.nm === '삼산타운주공1단지'));
});

test('자동완성 원본도 같은 실거래명의 다른 법정동 단지를 분리한다', async () => {
  const c = vm.createContext({
    aptMem: {},
    canonNorm: s => s,
    ensureMonths: async () => [T('우성', '길동'), T('우성', '천호동'), T('우성', '천호동')],
    ensureMonthsP: async () => [],
  });
  vm.runInContext(html.slice(html.indexOf('async function getApts('), html.indexOf('function acHide(')) + '\nthis.getApts = getApts;', c);
  assert.deepEqual(JSON.parse(JSON.stringify((await c.getApts('11740')).map(a=>[a.umd, a.n]))), [['천호동', 2], ['길동', 1]]);
});

test('K-apt 별도 관리단지는 역세권 순위에서 중복 제거하고 임대 거래는 일반 단지명에 합치지 않는다', () => {
  const c = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('function collapseSubwayManagementUnits('), html.indexOf('function parseSubwayWalk(')) + '\nthis.collapseSubwayManagementUnits=collapseSubwayManagementUnits;', c);
  const hh = JSON.parse(readFileSync(new URL('../data/hhcnt/11620.json', import.meta.url), 'utf8')).items;
  const kept = c.collapseSubwayManagementUnits(hh);
  const codes = new Set(kept.map(x=>x.kaptCode));
  for (const code of ['A15105301', 'A15105503', 'A15192202', 'A15105602', 'A15178203']) assert.equal(codes.has(code), false, code);
  for (const code of ['A15105302', 'A15180705', 'A15176202', 'A15105603', 'A15106901']) assert.equal(codes.has(code), true, code);
  const unrelated = { ...hh.find(x=>x.kaptCode==='A15105301'), kaptCode:'unrelated', kaptAddr:'서울특별시 관악구 봉천동 9999-1 관악푸르지오제2단지' };
  assert.equal(c.collapseSubwayManagementUnits([...hh, unrelated]).includes(unrelated), true);
  const names = JSON.parse(readFileSync(new URL('../data/naver-names/11620.json', import.meta.url), 'utf8'));
  assert.equal(names['관악푸르지오(임대)|봉천동'], undefined);
  assert.equal(names['봉천동아|봉천동'], '성현동아');
  assert.equal(names['봉천우성|봉천동'], '관악우성');
  assert.equal(names['두산|봉천동'], '두산');
  const c2 = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const NAVER_NAMES = {}'), html.indexOf('function analyzeComplex(')) + '\n' +
    html.slice(html.indexOf('function resolveAptName('), html.indexOf('async function searchSubway(')) +
    '\nthis.NAVER_NAMES=NAVER_NAMES;this.resolveSubwayTradeName=resolveSubwayTradeName;', c2);
  c2.NAVER_NAMES['11620'] = names;
  assert.equal(c2.resolveSubwayTradeName('11620', ['봉천동아'], '성현동아', new Map([['봉천동아','봉천동']])), '봉천동아');
  assert.equal(c2.resolveSubwayTradeName('11620', ['봉천우성'], '관악우성아파트', new Map([['봉천우성','봉천동']])), '봉천우성');
  assert.equal(c2.resolveSubwayTradeName('11620', ['두산'], '봉천두산1,2단지', new Map([['두산','봉천동']])), '두산');
});
