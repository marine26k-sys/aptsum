import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateApplication, createClaim, readClaim, newApplication, requestPayment, handleFeedback, applyConfig, expiryDateAfter,
} from '../shared/applications.mjs';

function fakeStore() {
  const m = new Map();
  return {
    m,
    async get(key, opts) { const v = m.get(key); return v === undefined ? null : (opts?.type === 'json' ? structuredClone(v) : JSON.stringify(v)); },
    async setJSON(key, v) { m.set(key, structuredClone(v)); },
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

test('config defaults to 9,900 won for 30 days and needs all PayApp keys', () => {
  assert.deepEqual(applyConfig({}), { price: 9900, days: 30, paymentEnabled: false });
  assert.equal(applyConfig(ENV).paymentEnabled, true);
  assert.equal(applyConfig({ ...ENV, APPLY_PRICE: '12000' }).price, 12000);
});

test('payrequest sends the application id and return/feedback urls', async () => {
  const app = newApplication(validateApplication(FORM).data, 9900);
  let sent;
  const fetchImpl = async (url, init) => { sent = new URLSearchParams(init.body); return new Response('state=1&mul_no=777&payurl=https%3A%2F%2Fpayapp.kr%2Fp%2F1'); };
  const r = await requestPayment(app, { origin: 'https://aptsum.kr', claim: 'c.l', env: ENV, fetchImpl });
  assert.deepEqual(r, { payurl: 'https://payapp.kr/p/1', mulNo: '777' });
  assert.equal(sent.get('cmd'), 'payrequest');
  assert.equal(sent.get('price'), '9900');
  assert.equal(sent.get('recvphone'), '01012345678');
  assert.equal(sent.get('var1'), app.id);
  assert.equal(sent.get('feedbackurl'), 'https://aptsum.kr/api/payapp-feedback');
  assert.equal(sent.get('returnurl'), 'https://aptsum.kr/apply.html?claim=c.l');

  const bad = await requestPayment(app, { origin: 'x', claim: 'c', env: ENV, fetchImpl: async () => new Response('state=0&errorMessage=%EC%98%A4%EB%A5%98') });
  assert.equal(bad.error, 'payapp_error');
  assert.equal(bad.message, '오류');
});

async function setup() {
  const appStore = fakeStore(), subStore = fakeStore();
  const app = newApplication(validateApplication(FORM).data, 9900);
  app.mulNo = '777';
  await appStore.setJSON(`app:${app.id}`, app);
  const feed = (extra) => handleFeedback({ userid: 'aptsum', linkkey: 'KEY', linkval: 'VAL', var1: app.id, mul_no: '777', price: '9900', ...extra },
    { env: ENV, appStore, subStore, now: Date.parse('2026-09-24T10:00:00+09:00') });
  return { appStore, subStore, app, feed };
}

test('payment completion issues exactly one personal code', async () => {
  const { appStore, subStore, app, feed } = await setup();
  assert.equal((await feed({ pay_state: '1' })).result, 'ignored');
  const r = await feed({ pay_state: '4' });
  assert.equal(r.result, 'issued');
  const saved = await appStore.get(`app:${app.id}`, { type: 'json' });
  assert.equal(saved.status, 'paid');
  const sub = await subStore.get(`sub:${saved.subId}`, { type: 'json' });
  assert.match(sub.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(sub.orderId, app.id);
  assert.equal(sub.name, '신청 5678');
  assert.equal(sub.expiresAt, Date.parse('2026-10-24T23:59:59+09:00'));
  assert.ok(await subStore.get(`code:${sub.code.replace('-', '')}`, { type: 'json' }));
  // PayApp 재통보 — 코드를 또 만들지 않는다
  assert.equal((await feed({ pay_state: '4' })).result, 'already_issued');
  assert.equal([...subStore.m.keys()].filter(k => k.startsWith('sub:')).length, 1);
});

test('refund revokes the issued code', async () => {
  const { appStore, subStore, app, feed } = await setup();
  await feed({ pay_state: '4' });
  assert.equal((await feed({ pay_state: '9' })).result, 'refunded');
  const saved = await appStore.get(`app:${app.id}`, { type: 'json' });
  assert.equal(saved.status, 'refunded');
  assert.equal((await subStore.get(`sub:${saved.subId}`, { type: 'json' })).revoked, true);
});

test('rejects wrong credentials, wrong price and foreign mul_no', async () => {
  const { appStore, subStore, app, feed } = await setup();
  assert.deepEqual(await feed({ pay_state: '4', linkval: 'nope' }), { ok: false, reason: 'bad_credentials' });
  assert.equal((await feed({ pay_state: '4', mul_no: '999' })).result, 'mul_no_mismatch');
  assert.equal((await feed({ pay_state: '4', price: '100' })).result, 'price_mismatch');
  assert.equal((await appStore.get(`app:${app.id}`, { type: 'json' })).status, 'mismatch');
  assert.equal(subStore.m.size, 0);
  assert.equal((await feed({ pay_state: '4', var1: 'unknown' })).result, 'unknown_application');
});

test('request cancel marks a pending application canceled', async () => {
  const { appStore, app, feed } = await setup();
  assert.equal((await feed({ pay_state: '8' })).result, 'canceled');
  assert.equal((await appStore.get(`app:${app.id}`, { type: 'json' })).status, 'canceled');
});

test('expiry date is counted in KST', () => {
  assert.equal(expiryDateAfter(30, Date.parse('2026-09-24T23:30:00+09:00')), '2026-10-24');
});
