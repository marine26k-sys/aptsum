import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function buildPriceBands(');
const end = html.indexOf('function analyzeLongTermRise(', start);
const ctx = vm.createContext({ R1: n => Math.round(n * 10) / 10 });
vm.runInContext(html.slice(start, end), ctx);

test('groups by starting price in one-hundred-million-won bands', () => {
  const rows = [
    { pastAvg: 5.0, recentAvg: 5.5, changeAmt: 0.5 },
    { pastAvg: 5.9, recentAvg: 6.2, changeAmt: 0.3 },
    { pastAvg: 6.0, recentAvg: 5.8, changeAmt: -0.2 },
    { pastAvg: 0.8, recentAvg: 0.8, changeAmt: 0 },
  ];
  const bands = JSON.parse(JSON.stringify(ctx.buildPriceBands(rows)));
  assert.deepEqual(bands.map(b => [b.label, b.count]), [['1억 미만',1],['5억대',2],['6억대',1]]);
  assert.deepEqual(bands[1], { band:5, label:'5억대', count:2, pastAvg:5.5, recentAvg:5.9, changeAmt:0.4, changePct:7, up:2, down:0, flat:0 });
  assert.equal(bands[2].down, 1);
});

test('empty input produces no misleading band', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.buildPriceBands([]))), []);
});
