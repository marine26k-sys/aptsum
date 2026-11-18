const RELEASE_LIST_URL = 'https://www.reb.or.kr/reb/na/ntt/selectNttList.do?bbsId=1154&mi=9565';

export async function findMonthlyReleaseDate(period) {
  const match = String(period || '').match(/^(\d{4})[-년 ]?(\d{1,2})월?$/);
  if (!match) throw new Error(`Invalid R-ONE monthly period: ${period}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const title = new RegExp(`${String(year).slice(-2)}\\s*\\.\\s*0?${month}월\\s*전국주택가격동향`);
  const response = await fetch(RELEASE_LIST_URL, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`REB release list request failed: HTTP ${response.status}`);
  const html = await response.text();
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const text = row.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ');
    if (!title.test(text)) continue;
    const date = text.match(/\b(20\d{2})\.(\d{1,2})\.(\d{1,2})\.?/);
    if (date) return `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
  }
  throw new Error(`REB monthly publication date not found for ${year}-${String(month).padStart(2, '0')}`);
}
