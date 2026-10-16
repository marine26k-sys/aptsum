export const CATEGORIES = {apt:'아파트',remainder:'무순위·잔여세대'};
export const noticeKey = item => `${item.category}:${item.pblancNo}`;
export function kstToday(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?value:null;
}
export function noticeStatus(item,today=kstToday()){
  const start=validDate(item.apply_start),end=validDate(item.apply_end);
  if(end&&end<today)return 'closed';
  if(start&&start>today)return 'upcoming';
  if(start&&end&&start<=today&&today<=end)return 'open';
  return 'unknown';
}
export function daysUntil(date,today=kstToday()){
  return validDate(date)?Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
}
export function officialURL(value){
  try{const u=new URL(value);return u.protocol==='https:'&&['www.applyhome.co.kr','applyhome.co.kr'].includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function filterNotices(items,{status='active',category='',region='',query='',favoritesOnly=false,favorites=[]}={},today=kstToday()){
  const saved=new Set(favorites),q=query.replace(/\s/g,'').toLowerCase();
  return items.filter(item=>{
    const state=noticeStatus(item,today);
    return ['apt','remainder'].includes(item.category)&&(status==='all'||(status==='active'?['open','upcoming'].includes(state):state===status))&&
      (!category||item.category===category)&&(!region||item.region===region)&&
      (!q||`${item.name||''}${item.address||''}`.replace(/\s/g,'').toLowerCase().includes(q))&&
      (!favoritesOnly||saved.has(noticeKey(item)));
  }).sort((a,b)=>{
    if(['active','open','upcoming'].includes(status)){
      const order=(validDate(b.notice_date)||'').localeCompare(validDate(a.notice_date)||'');
      if(order)return order;
    }
    const rank={open:0,upcoming:1,unknown:2,closed:3},sa=noticeStatus(a,today),sb=noticeStatus(b,today);
    if(rank[sa]!==rank[sb])return rank[sa]-rank[sb];
    if(sa==='closed')return (b.apply_end||'').localeCompare(a.apply_end||'')||String(a.name).localeCompare(String(b.name),'ko');
    const key=sa==='open'?'apply_end':'apply_start';
    return (a[key]||'9999').localeCompare(b[key]||'9999')||String(a.name).localeCompare(String(b.name),'ko');
  });
}

export function uniqueScheduleDates(dates){
  return [...new Set((Array.isArray(dates)?dates:[]).filter(x=>typeof x==='string').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean))];
}
