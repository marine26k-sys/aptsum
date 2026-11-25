import { applyKBTypeSupplyPyeong } from './supply-area-loader.mjs';

const identity = value => String(value || '').normalize('NFKC').replace(/[\s·ㆍ()\[\]{}.,_-]/g, '').toLocaleLowerCase('ko-KR');

export function tierSupplyPyeong(trade, canonicalName, kbTypes, coarsePyeong) {
  const exact = applyKBTypeSupplyPyeong([{ ...trade, apt: canonicalName }], kbTypes)[0];
  if (exact.py !== trade.py) return exact.py;

  const areas = kbTypes?.items?.[`${identity(canonicalName)}|${identity(trade.umd)}`]?.[String(Math.floor(Number(trade.area)))];
  const known = new Set((areas || []).map(row => row.supplyPyeong).filter(py => Number.isInteger(py) && py > 0));
  if (known.size === 1) return [...known][0];
  if (!areas && Number.isInteger(coarsePyeong) && coarsePyeong > 0) return coarsePyeong;
  return trade.py;
}

export function tierPriceGroupKey(complexKey, trade) {
  return `${complexKey}|${Math.floor(Number(trade.area))}|${trade.py}`;
}
