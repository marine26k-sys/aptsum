// KST month boundaries must not retain a day such as March 31.
export function currentAndPrevYm(now = Date.now()) {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const ym = () => `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
  const cur = ym();
  kst.setUTCDate(1);
  kst.setUTCMonth(kst.getUTCMonth() - 1);
  return { cur, prev: ym() };
}

// Isolate months, including split-region subrequests, so incomplete data cannot
// be mistaken for an empty but successfully fetched month.
export async function collectMonths(yms, fetchMonth) {
  const months = [...new Set(yms)];
  const results = await Promise.all(months.map(async (ym) => {
    try { return await fetchMonth(ym); }
    catch { return { anyFailed: true }; }
  }));
  const failedMonths = months.filter((ym, i) => results[i].error || results[i].anyFailed);
  const items = results.flatMap((r, i) => failedMonths.includes(months[i]) ? [] : (r.items || []));
  return { items, failedMonths, anyFailed: failedMonths.length > 0 };
}

