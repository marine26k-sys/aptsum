import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedCombinedKBTypes } from '../shared/kb-combined-complex.mjs';

const master = { 시: '경기', 구: '안양 동안구', 법정동: '비산동', 세대수: 30,
  면적별: [{ 상태: 'confirmed', 전용면적: 59.96, 공급면적: 84.1 }] };
const complexes = [
  { city: '경기', district: '안양 동안구', dong: '비산동', areas: [{ exclusiveM2: 59.96, supplyM2: 84.1, households: 10 }] },
  { city: '경기', district: '안양 동안구', dong: '비산동', areas: [{ exclusiveM2: 59.96, supplyM2: 84.1, households: 20 }] },
];

test('분리된 KB 관리단지의 면적과 세대수가 합산 단지와 같으면 연결한다', () => {
  assert.equal(verifiedCombinedKBTypes(master, complexes), true);
});

test('합산 세대수나 위치·면적이 다르면 연결하지 않는다', () => {
  assert.equal(verifiedCombinedKBTypes({ ...master, 세대수: 31 }, complexes), false);
  assert.equal(verifiedCombinedKBTypes(master, [{ ...complexes[0], dong: '호계동' }, complexes[1]]), false);
  assert.equal(verifiedCombinedKBTypes(master, [{ ...complexes[0], areas: [{ ...complexes[0].areas[0], supplyM2: 90 }] }, complexes[1]]), false);
});
