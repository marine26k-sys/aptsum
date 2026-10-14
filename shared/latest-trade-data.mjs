// Snapshot the latest stored batch revision for five minutes; concurrent month reads share it.
const REPO='marine26k-sys/aptsum';let revision=null,expires=0,pending=null;
async function latestRevision(){
 if(revision&&expires>Date.now())return revision;
 if(pending)return pending;
 pending=(async()=>{const r=await fetch(`https://api.github.com/repos/${REPO}/commits/main`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('revision');const d=await r.json();if(!/^[a-f0-9]{40}$/.test(d.sha))throw Error('revision');revision=d.sha;expires=Date.now()+300000;return revision;})();
 try{return await pending;}finally{pending=null;}
}
export async function latestTradeMonth(origin,kind,lawd,ym){
 if(!['analyze','presale','rent'].includes(kind)||!/^(?:\d{5}|(?:BC|HS|IC)-[가-힣]+)$/.test(lawd)||!/^\d{6}$/.test(ym))return null;
 const path=`data/${kind}/${encodeURIComponent(lawd)}/${ym}.json`;
 try{const sha=await latestRevision();const r=await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`,{signal:AbortSignal.timeout(15000)});if(r.ok){const d=await r.json();if(Array.isArray(d?.items))return d;}}catch{}
 // Keep the already deployed snapshot available during a temporary upstream outage.
 try{const r=await fetch(`${origin}/${path}`,{signal:AbortSignal.timeout(10000)});const d=r.ok?await r.json():null;return Array.isArray(d?.items)?d:null;}catch{return null;}
}
