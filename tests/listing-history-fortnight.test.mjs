import test from 'node:test';import assert from 'node:assert/strict';
import {recentListingHistory} from '../netlify/functions/listings.mjs';
test('호가 이력은 한국시간 오늘 포함 14일이며 같은 기준일은 최종 업로드만 남긴다',()=>{
 const rows=[['old','2026.10.03'],['start','2026.10.04'],['before','2026.10.17'],['last','2026.10.17'],['future','2026.10.18']].map(([uploadId,asOf])=>({uploadId,asOf}));
 assert.deepEqual(recentListingHistory(rows,Date.parse('2026-10-16T15:00:00Z')).map(x=>x.uploadId),['start','last']);
});
