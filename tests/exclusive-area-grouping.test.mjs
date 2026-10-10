import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helpers = html.slice(html.indexOf('function exclusiveAreaKey('), html.indexOf('function analyzeComplex('));
const trade = (area, py, amt, ym='202609') => ({apt:'한빛마을4단지롯데캐슬Ⅱ',umd:'야당동',lawd:'41480',area,py,amt,ym,d:'15',floor:'10',build:'2014'});

test('단지 분석은 같은 25평이어도 전용 59와 60을 분리하고 같은 전용 84는 합친다', () => {
  const ctx = vm.createContext({
    matchComplex: all => ({hits:all}), naverNameOf:()=>null,
    dkey:t=>`${t.ym}${t.d}`, markOutliers:a=>a, floorBands:()=>null,
    avgA:a=>a.reduce((n,t)=>n+t.amt,0)/a.length,
    R1:n=>Math.round(n*10)/10, ymLabel:s=>s, yearsLabel:()=>'',
  });
  vm.runInContext(helpers + html.slice(html.indexOf('function analyzeComplex('), html.indexOf('function analyzeRegion(')), ctx);
  const trades=[trade(59.4702,25,7),trade(59.85,25,8),trade(60.1761,25,9),trade(84.20,34,10),trade(84.75,32,11)];
  const result=ctx.analyzeComplex(trades,'한빛마을4단지롯데캐슬Ⅱ',['202609'],undefined,'41480');
  assert.deepEqual(Array.from(result.byPy, p=>[p.sizeKey,p.n]),[[59,2],[60,1],[84,2]]);
  assert.equal(result.trades.filter(t=>t.sizeKey===59).length,2);
  assert.equal(result.trades.filter(t=>t.sizeKey===60).length,1);
});

test('매매 거래가 없는 전용면적도 전세 거래가 있으면 매매 평형에 가격 없이 표시한다', () => {
  const ctx = vm.createContext({
    matchComplex: all => ({hits:all}), naverNameOf:()=>null, naverKey:s=>s,
    dkey:t=>`${t.ym}${t.d}`, markOutliers:a=>a, floorBands:()=>null,
    avgA:a=>a.reduce((n,t)=>n+t.amt,0)/a.length,
    R1:n=>Math.round(n*10)/10, ymLabel:s=>s, yearsLabel:()=>'',
    esc:s=>String(s), selPy:-1,
  });
  vm.runInContext(helpers + html.slice(html.indexOf('function analyzeComplex('), html.indexOf('function analyzeRegion(')) +
    html.slice(html.indexOf('function avgCell('), html.indexOf('function tradesHTML(')), ctx);
  const months=['202610','202609','202608','202607','202606','202605','202604','202603','202602','202601','202512','202511'];
  const sale=ctx.analyzeComplex([trade(84.98,34,20)],'올림픽파크포레온',months,undefined,'11740');
  const jeonse=ctx.analyzeComplex([trade(113.97,44,8)],'올림픽파크포레온',months,undefined,'11740');
  const result=ctx.includeJeonseOnlySaleAreas(sale,jeonse);
  assert.deepEqual(Array.from(result.byPy,p=>[p.sizeKey,p.n]),[[84,1],[113,0]]);
  assert.equal(result.trades.length,1);
  assert.match(ctx.pyTableHTML(result),/44평[\s\S]*매매 거래 없음/);
  const rentOnly=ctx.includeJeonseOnlySaleAreas({found:false},jeonse);
  assert.equal(rentOnly.found,true);
  assert.deepEqual(Array.from(rentOnly.byPy,p=>[p.sizeKey,p.n]),[[113,0]]);
  assert.equal(rentOnly.trades.length,0);
});

test('전세가율은 같은 평형 라벨이어도 매매와 전세를 전용면적 정수로 짝짓는다', () => {
  const ctx=vm.createContext({markOutliers:a=>a,avgA:a=>a.reduce((n,t)=>n+t.amt,0)/a.length,R1:n=>Math.round(n*10)/10,ymLabel:s=>s,yearsLabel:()=>''});
  vm.runInContext(helpers + html.slice(html.indexOf('function avgGroupA('), html.indexOf('// ═══ 단기 저평가')),ctx);
  const sale=[trade(59.4702,25,7),trade(59.85,25,8),trade(60.1761,25,9),trade(60.1761,25,10)];
  const rent=[trade(59.4702,25,4),trade(59.85,25,5),trade(60.1761,25,6),trade(60.1761,25,7)];
  const rows=ctx.analyzeGapRanking(sale,rent,['202609']).rows;
  assert.deepEqual(Array.from(rows,r=>[r.area,r.saleN,r.rentN]).sort((a,b)=>a[0]-b[0]),[[59,2,2],[60,2,2]]);
});

test('단지 비교는 평형 라벨이 같아도 전용 59와 60을 각각 선택할 수 있다', () => {
  const ctx=vm.createContext({
    matchComplex:all=>({hits:all}),naverNameOf:()=>null,markOutliers:a=>a,
    avgA:a=>a.reduce((n,t)=>n+t.amt,0)/a.length,R1:n=>Math.round(n*10)/10,
    ymLabel:s=>s,yearsLabel:()=>'',
  });
  vm.runInContext(helpers + html.slice(html.indexOf('function analyzeCompare('),html.indexOf('function esc(')) +
    html.slice(html.indexOf('function cmpDefaultPyFor('),html.indexOf('let curMultiChart')),ctx);
  const trades=[trade(59.4702,25,7),trade(60.1761,25,9)];
  const result=ctx.analyzeCompare({'41480':trades},[{lawd:'41480',name:'한빛마을4단지롯데캐슬Ⅱ'}],['202609']);
  assert.deepEqual(Array.from(result.complexes[0].pys,p=>[p.area,p.py]),[[59,'25평'],[60,'25평']]);
  assert.equal(ctx.cmpDefaultPyFor(result.complexes[0]),59);
});
