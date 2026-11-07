export function uploadState(value) {
  if (!value || !Array.isArray(value.lawds)) throw new Error('업로드 지역 정보를 확인할 수 없습니다.');
  return { uploadId: value.uploadId || null, lawds: [...new Set(value.lawds.map(String))].sort() };
}
export function sameUploadState(a, b) {
  return a.uploadId === b.uploadId && JSON.stringify(a.lawds) === JSON.stringify(b.lawds);
}
export function verifiedRegionMetric(entry, metric, state) {
  if (!state.lawds.includes(String(entry.lawd))) {
    return {...entry, rate:null, count:0, asOf:null, previousAsOf:null, weekly:[], sourceUploadId:null, priceBandVersion:5};
  }
  if (!state.uploadId || metric.sourceUploadId !== state.uploadId) {
    throw new Error(`지역 ${entry.lawd}의 업로드가 완료되지 않아 집계를 다시 시도해야 합니다.`);
  }
  return {...entry, ...metric};
}
