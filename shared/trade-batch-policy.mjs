// 서버 시간대에 관계없이 한국시간의 최신 월부터 수집한다.
export function recentTradeMonths(n, now = Date.now()) {
  const d = new Date(now + 9 * 3600000);
  const year = d.getUTCFullYear(), month = d.getUTCMonth();
  return Array.from({length:n}, (_,i)=>{
    const value = new Date(Date.UTC(year,month-i,1));
    return `${value.getUTCFullYear()}${String(value.getUTCMonth()+1).padStart(2,'0')}`;
  });
}
export function coversFullTradeBatch(opt) {
  return !opt.only && opt.months>=4 && opt.refresh>=4
    && ['analyze','presale','rent'].every(kind=>opt.kinds.includes(kind));
}
