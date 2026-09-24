import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateApplication, createClaim, readClaim, newApplication, saveApplication, handleFeedback, applyConfig, expiryDateAfter,
} from '../shared/applications.mjs';

function fakeStore() {
  const m = new Map();
  return {
    m,
    async get(key, opts) { const v = m.get(key); return v === undefined ? null : (opts?.type === 'json' ? structuredClone(v) : JSON.stringify(v)); },
    async setJSON(key, v, opts) {
      if (opts?.onlyIfNew && m.has(key)) return { modified: false };
      m.set(key, structuredClone(v)); return { modified: true };
    },
    async delete(key) { m.delete(key); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
}

const ENV = { PAYAPP_USERID: 'aptsum', PAYAPP_LINKKEY: 'KEY', PAYAPP_LINKVAL: 'VAL' };
const FORM = { region: '서울시 관악구', budget: '5~7억', size: '30평대', movein: '입주 예정', condition: '중층 이상 / 300세대 이상 / 30년차 이하', phone: '010-1234-5678', email: 'a@b.com', agree: true };

test('validates the application form', () => {
  const ok = validateApplication(FORM);
  assert.equal(ok.data.phone, '01012345678');
  assert.equal(validateApplication({ ...FORM, region: ' ' }).error, 'region_required');
  assert.equal(validateApplication({ ...FORM, phone: '02-123-4567' }).error, 'invalid_phone');
  assert.equal(validateApplication({ ...FORM, email: 'nope' }).error, 'invalid_email');
  assert.equal(validateApplication({ ...FORM, agree: 'true' }).error, 'agree_required');
});

test('claim tokens are bound to the secret and id', () => {
  const claim = createClaim('s3cret', 'abc');
  assert.equal(readClaim('s3cret', claim), 'abc');
  assert.equal(readClaim('other', claim), null);
  assert.equal(readClaim('s3cret', 'xyz.' + claim.split('.')[1]), null);
  assert.equal(readClaim('s3cret', ''), null);
});

test('config defaults to 9,900 won for 30 days, the PayApp payment link, and needs all PayApp keys', () => {
  assert.deepEqual(applyConfig({}), { price: 9900, days: 30, payUrl: 'https://www.payapp.kr/L/z4l7c4', paymentEnabled: false });
  assert.equal(applyConfig(ENV).paymentEnabled, true);
  assert.equal(applyConfig({ ...ENV, APPLY_PRICE: '12000' }).price, 12000);
  assert.equal(applyConfig({ ...ENV, PAYAPP_LINK_URL: 'https://www.payapp.kr/L/other' }).payUrl, 'https://www.payapp.kr/L/other');
});

const NOW = Date.parse('2026-09-24T10:00:00+09:00');
async function setup({ createdAt = NOW - 60000 } = {}) {
  const appStore = fakeStore(), subStore = fakeStore();
  const app = newApplication(validateApplication(FORM).data, 9900, createdAt);
  await saveApplication(app, appStore);
  const feed = (extra, now = NOW) => handleFeedback({ userid: 'aptsum', linkkey: 'KEY', linkval: 'VAL', recvphone: '01012345678', mul_no: '777', price: '9900', ...extra },
    { env: ENV, appStore, subStore, now });
  const subs = () => [...subStore.m.keys()].filter(k => k.startsWith('sub:'));
  return { appStore, subStore, app, feed, subs };
}

test('payment link completion is matched to the application by phone and issues exactly one code', async () => {
  const { appStore, subStore, app, feed, subs } = await setup();
  assert.equal((await feed({ pay_state: '1' })).result, 'ignored');
  const r = await feed({ pay_state: '4', recvphone: '010-1234-5678' });
  assert.equal(r.result, 'issued');
  assert.equal(r.appId, app.id);
  const saved = await appStore.get(`app:${app.id}`, { type: 'json' });
  assert.equal(saved.status, 'paid');
  assert.equal(saved.mulNo, '777');
  const sub = await subStore.get(`sub:${saved.subId}`, { type: 'json' });
  assert.match(sub.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(sub.orderId, app.id);
  assert.equal(sub.name, '신청 5678');
  assert.equal(sub.expiresAt, Date.parse('2026-10-24T23:59:59+09:00'));
  assert.ok(await subStore.get(`code:${sub.code.replace('-', '')}`, { type: 'json' }));
  // PayApp 재통보 — 코드를 또 만들지 않는다
  assert.equal((await feed({ pay_state: '4' })).result, 'already_issued');
  assert.equal(subs().length, 1);
});

test('payment without a matching application still issues a code for the operator', async () => {
  const { appStore, subStore, app, feed, subs } = await setup();
  const r = await feed({ pay_state: '4', recvphone: '01099998888', mul_no: '888' });
  assert.equal(r.result, 'issued_unmatched');
  const orphan = await appStore.get(`app:${r.appId}`, { type: 'json' });
  assert.equal(orphan.unmatched, true);
  assert.equal(orphan.phone, '01099998888');
  assert.equal((await subStore.get(`sub:${r.subId}`, { type: 'json' })).name, '결제 8888');
  // 원래 신청서는 그대로 결제 대기
  assert.equal((await appStore.get(`app:${app.id}`, { type: 'json' })).status, 'pending');
  assert.equal((await feed({ pay_state: '4', recvphone: '01099998888', mul_no: '888' })).result, 'already_issued');
  assert.equal(subs().length, 1);
});

test('an application older than 24 hours is not matched', async () => {
  const { app, appStore, feed } = await setup({ createdAt: NOW - 25 * 3600000 });
  assert.equal((await feed({ pay_state: '4' })).result, 'issued_unmatched');
  assert.equal((await appStore.get(`app:${app.id}`, { type: 'json' })).status, 'pending');
});

test('refund revokes the issued code', async () => {
  const { appStore, subStore, app, feed } = await setup();
  await feed({ pay_state: '4' });
  assert.equal((await feed({ pay_state: '9' })).result, 'refunded');
  const saved = await appStore.get(`app:${app.id}`, { type: 'json' });
  assert.equal(saved.status, 'refunded');
  assert.equal((await subStore.get(`sub:${saved.subId}`, { type: 'json' })).revoked, true);
  assert.equal((await feed({ pay_state: '64', mul_no: '12345' })).result, 'unknown_payment');
});

test('ignores other products and rejects wrong credentials', async () => {
  const { appStore, subStore, app, feed } = await setup();
  assert.deepEqual(await feed({ pay_state: '4', linkval: 'nope' }), { ok: false, reason: 'bad_credentials' });
  assert.deepEqual(await feed({ pay_state: '4', userid: 'someone' }), { ok: false, reason: 'bad_credentials' });
  assert.equal((await feed({ pay_state: '4', price: '30000' })).result, 'other_product');
  assert.equal((await appStore.get(`app:${app.id}`, { type: 'json' })).status, 'pending');
  assert.equal(subStore.m.size, 0);
});

test('a newer application by the same phone receives the payment', async () => {
  const { appStore, feed } = await setup();
  const newer = newApplication(validateApplication({ ...FORM, region: '수원시' }).data, 9900, NOW - 1000);
  await saveApplication(newer, appStore);
  assert.equal((await feed({ pay_state: '4' })).appId, newer.id);
});

test('concurrent duplicate notifications issue only one code', async () => {
  const { feed, subs } = await setup();
  const results = await Promise.all([feed({ pay_state: '4' }), feed({ pay_state: '4' })]);
  assert.deepEqual(results.map(r => r.result).sort(), ['already_issued', 'issued']);
  assert.equal(subs().length, 1);
});

test('expiry date is counted in KST', () => {
  assert.equal(expiryDateAfter(30, Date.parse('2026-09-24T23:30:00+09:00')), '2026-10-24');
});
