import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 최근 한국시간 06:30/18:30 회차. 예약 누락/실패는 다음 확인에서 복구한다.
export function latestTradeSlot(now = Date.now()) {
  const kst = new Date(now + 9 * 3600000);
  const midnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600000;
  const morning = midnight + 6.5 * 3600000;
  const evening = midnight + 18.5 * 3600000;
  return now >= evening ? evening : now >= morning ? morning : morning - 12 * 3600000;
}
export function shouldCollectTrades(report, now = Date.now()) {
  const started = Date.parse(report?.startedAt);
  const finished = Date.parse(report?.finishedAt);
  return !(report?.status === 'success' && report.fullScope === true
    && started >= latestTradeSlot(now) && started <= finished && finished <= now
    && Array.isArray(report.failedMonths) && report.failedMonths.length === 0
    && Array.isArray(report.failedSteps) && report.failedSteps.length === 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let report;
  try { report = JSON.parse(readFileSync('data/trade-batch-status.json', 'utf8')); } catch {}
  // 지정한 하루만 실제 수집을 강제하여 예약 이벤트부터 수집 완료까지 검증한다.
  const scheduledTest = process.env.TRADE_BATCH_SCHEDULE === '10 0 15 10 *'
    && new Date().toISOString().slice(0, 10) === '2026-10-15';
  const run = process.env.GITHUB_EVENT_NAME !== 'schedule' || scheduledTest || shouldCollectTrades(report);
  console.log(`run=${run}`);
  console.error(run ? '전체 수집 미완료: 수집을 실행합니다.' : '현재 회차 전체 수집 완료: 중복 수집을 건너뜁니다.');
}
