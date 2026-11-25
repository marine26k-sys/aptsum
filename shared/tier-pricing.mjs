const identity = value => String(value || '').normalize('NFKC').replace(/[\s·ㆍ()\[\]{}.,_-]/g, '').toLocaleLowerCase('ko-KR');

export function tierSupplyPyeong(trade, canonicalName, kbTypes, coarsePyeong) {
  const key = `${identity(canonicalName)}|${identity(trade.umd)}`;
  const area = Number(trade.area);
  const areas = kbTypes?.items?.[key]?.[String(Math.floor(area))];
  const exactArea = String(Math.floor(area * 100 + 1e-7) / 100);
  const types = kbTypes?.exactExclusiveTypes?.[key]?.[exactArea];
  if (Array.isArray(types) && types.length) {
    const exact = new Set((areas || []).filter(row => types.includes(row.type))
      .map(row => row.supplyPyeong).filter(py => Number.isInteger(py) && py > 0));
    if (exact.size === 1) return [...exact][0];
    if (exact.size > 1) return trade.py;
  }
  const known = new Set((areas || []).map(row => row.supplyPyeong).filter(py => Number.isInteger(py) && py > 0));
  if (known.size === 1) return [...known][0];
  if (!areas && Number.isInteger(coarsePyeong) && coarsePyeong > 0) return coarsePyeong;
  return trade.py;
}

export function tierPriceGroupKey(complexKey, trade) {
  return `${complexKey}|${Math.floor(Number(trade.area))}|${trade.py}`;
}
