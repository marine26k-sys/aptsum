// Snapshot each data revision for five minutes; concurrent month reads share it.
const REPO='marine26k-sys/aptsum';const revisions=new Map();
async function latestRevision(origin){
 const preview=String(origin||'').match(/^https?:\/\/deploy-preview-(\d+)--/i)?.[1]||'';
 const key=preview?`pr-${preview}`:'main';
 const cached=revisions.get(key);
 if(cached?.sha&&cached.expires>Date.now())return cached.sha;
 if(cached?.pending)return cached.pending;
 const pending=(async()=>{
  const url=preview?`https://api.github.com/repos/${REPO}/pulls/${preview}`:`https://api.github.com/repos/${REPO}/commits/main`;
  const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('revision');const d=await r.json();
  const sha=preview?d?.head?.sha:d?.sha;
  if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('revision');
  revisions.set(key,{sha,expires:Date.now()+300000});return sha;
 })();
 revisions.set(key,{pending});
 try{return await pending;}finally{if(revisions.get(key)?.pending===pending)revisions.delete(key);}
}
export async function latestTradeMonth(origin,kind,lawd,ym){
 if(!['analyze','presale','rent'].includes(kind)||!/^(?:\d{5}|(?:BC|HS|IC)-[가-힣]+)$/.test(lawd)||!/^\d{6}$/.test(ym))return null;
 const path=`data/${kind}/${encodeURIComponent(lawd)}/${ym}.json`;
 try{const sha=await latestRevision(origin);const r=await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`,{signal:AbortSignal.timeout(15000)});if(r.ok){const d=await r.json();if(Array.isArray(d?.items))return d;}}catch{}
 // Keep the already deployed snapshot available during a temporary upstream outage.
 try{const r=await fetch(`${origin}/${path}`,{signal:AbortSignal.timeout(10000)});const d=r.ok?await r.json():null;return Array.isArray(d?.items)?d:null;}catch{return null;}
}
