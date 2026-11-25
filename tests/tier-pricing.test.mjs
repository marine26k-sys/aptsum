import test from 'node:test';
import assert from 'node:assert/strict';
import { tierPriceGroupKey, tierSupplyPyeong } from '../shared/tier-pricing.mjs';

const trade = { apt: '샘플', umd: '테스트동', area: 84.98, py: 33 };
const kbTypes = {
  items: { '샘플|테스트동': { '84': [
    { type: '84A', supplyPyeong: 32 },
    { type: '84B', supplyPyeong: 36 },
  ] } },
  exactExclusiveTypes: { '샘플|테스트동': { '84.98': ['84B'] } },
};

test('급지 평당가는 소수점까지 일치한 KB 전용면적의 공급평형을 우선한다', () => {
  assert.equal(tierSupplyPyeong(trade, '샘플', kbTypes, 32), 36);
  assert.equal(tierSupplyPyeong({ ...trade, py: 36 }, '샘플', kbTypes, 32), 36);
});

test('KB 공급평형이 여럿이고 정확한 타입을 모르면 다수 타입을 임의 배정하지 않는다', () => {
  const unknown = { ...trade, area: 84.99 };
  assert.equal(tierSupplyPyeong(unknown, '샘플', kbTypes, 32), 33);
});

test('최고가와 다른 공급평형 거래는 별도 표본으로 집계한다', () => {
  assert.notEqual(tierPriceGroupKey('단지', { ...trade, py: 32 }), tierPriceGroupKey('단지', { ...trade, py: 36 }));
});
