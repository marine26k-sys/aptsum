import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadState,sameUploadState,verifiedRegionMetric} from '../scripts/listing-ask-snapshot-integrity.mjs';
test('업로드 중인 지역은 이전 버전의 지도와 혼합하지 않는다',()=>{
 const state=uploadState({uploadId:'finished',lawds:['11680','41173']});
 assert.throws(()=>verifiedRegionMetric({lawd:'11680'},{sourceUploadId:'in-progress'},state),/업로드가 완료되지/);
 assert.equal(verifiedRegionMetric({lawd:'11680'},{sourceUploadId:'finished',rate:1},state).rate,1);
});
test('이번 업로드에 없는 지역은 과거 이력이 남아 있어도 빈 통계로 처리한다',()=>{
 const state=uploadState({uploadId:'finished',lawds:['11680']});
 const result=verifiedRegionMetric({lawd:'41173'},{sourceUploadId:'previous',weekly:[1]},state);
 assert.deepEqual(result.weekly,[]);assert.equal(result.asOf,null);
});
test('집계 중 업로드 또는 대상 지역이 바뀌면 새 파일 저장을 중단한다',()=>{
 const state=uploadState({uploadId:'x',lawds:['2','1']});
 assert.equal(sameUploadState(state,uploadState({uploadId:'x',lawds:['1','2']})),true);
 assert.equal(sameUploadState(state,uploadState({uploadId:'y',lawds:['1','2']})),false);
 assert.equal(sameUploadState(state,uploadState({uploadId:'x',lawds:['1']})),false);
});
