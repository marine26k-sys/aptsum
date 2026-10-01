import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSnapshot } from '../netlify/functions/listings.mjs';

function fakeStore(){
  const blobs = new Map();
  return {
    blobs,
    async get(key){ return blobs.get(key) ?? null; },
    async setJSON(key, value){ blobs.set(key, structuredClone(value)); },
  };
}

test('listing snapshots retain each upload and ignore repeated writes', async () => {
  const store = fakeStore();
  const first = { uploadId:'first', asOf:'2026.09.30', items:[{ nid:'10', ex:84, ask:12.5 }] };
  const second = { uploadId:'second', asOf:'2026.10.01', items:[{ nid:'10', ex:84, ask:11.9 }] };
  await saveSnapshot(store, '11680', first);
  await saveSnapshot(store, '11680', second);
  await saveSnapshot(store, '11680', second);
  assert.deepEqual(store.blobs.get('history-index:11680'), [
    { uploadId:'first', asOf:first.asOf },
    { uploadId:'second', asOf:second.asOf },
  ]);
  assert.equal(store.blobs.get('history:11680:first').items[0].ask, 12.5);
  assert.equal(store.blobs.get('history:11680:second').items[0].ask, 11.9);
});
