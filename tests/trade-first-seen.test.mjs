import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveTradeFirstSeen} from '../shared/trade-first-seen.mjs';

const deal=(overrides={})=>({apt:'테스트',umd:'테스트동',area:84.9,amt:10,ym:'202610',d:'01',floor:'10',build:'2020',direct:0,...overrides});

test('기존 거래에는 신규 시각을 소급해서 붙이지 않는다',()=>{
  const result=preserveTradeFirstSeen([deal()],[deal()],'2026-10-21T03:00:00.000Z');
  assert.equal(result[0].firstSeenAt,undefined);
});

test('새로 수집된 거래에 최초 확인 시각을 붙이고 이후에도 유지한다',()=>{
  const seenAt='2026-10-21T03:00:00.000Z';
  const first=preserveTradeFirstSeen([deal()],[deal(),deal({d:'02'})],seenAt);
  assert.equal(first[0].firstSeenAt,undefined);
  assert.equal(first[1].firstSeenAt,seenAt);
  const second=preserveTradeFirstSeen(first,[deal(),deal({d:'02'})],'2026-10-22T03:00:00.000Z');
  assert.equal(second[1].firstSeenAt,seenAt);
});

test('동일 조건 거래도 건수를 기준으로 새 거래를 구분한다',()=>{
  const seenAt='2026-10-21T03:00:00.000Z';
  const result=preserveTradeFirstSeen([deal()],[deal(),deal()],seenAt);
  assert.equal(result[0].firstSeenAt,undefined);
  assert.equal(result[1].firstSeenAt,seenAt);
});

test('금액 등 거래 내용이 수정되면 새 갱신으로 기록한다',()=>{
  const seenAt='2026-10-21T03:00:00.000Z';
  const result=preserveTradeFirstSeen([deal()],[deal({amt:10.2})],seenAt);
  assert.equal(result[0].firstSeenAt,seenAt);
});
