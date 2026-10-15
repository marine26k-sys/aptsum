const norm=x=>String(x||'').normalize('NFKC').replace(/\s/g,'');
export function matchCompletionFallback(rows,d,lawd){
 const hits=rows.filter(x=>x.lawd===String(lawd)&&norm(x.umd)===norm(d.umd)&&x.names.some(n=>norm(n)===norm(d.name))&&(!d.hh?.hhcnt||Number(d.hh.hhcnt)===x.hh));
 return hits.length===1?hits[0]:null;
}
export function completionFallbackLabel(entry,now=Date.now()){
 const value=entry?.completionMonth;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value||''))return '';
 const d=new Date(now+9*3600000),current=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`,year=Number(value.slice(0,4));
 return entry.planned||value>current?`${year}년 ${Number(value.slice(5))}월 준공 예정`:`${year}년 (${d.getUTCFullYear()-year+1}년차)`;
}
