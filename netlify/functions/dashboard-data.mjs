// Read batch-generated public data without requiring a new site deploy.
import { ALL_LAWDS } from '../../shared/regions.mjs';
const REPO='marine26k-sys/aptsum';
const revisionCache=new Map();
export const config={path:'/api/dashboard-data'};
export function dashboardPath(kind,lawd){
 if(kind==='complex-index')return 'data/complex-index.json';
 if(kind==='kb-sale-general'&&ALL_LAWDS.includes(lawd||''))return `data/kb-sale-general/${lawd}.json`;
 if(kind==='tier')return 'data/tier-map.json';
 if(kind==='regional')return 'data/regional-change.json';
 if(kind==='regional-detail'&&/^(?:\d{5}|(?:BC|HS|IC)-[가-힣]+)$/.test(lawd||''))return `data/regional-change-details/${lawd}.json`;
 return null;
}
async function latestRevision(hostname){
 const preview=/^deploy-preview-(\d+)--aptsum\.netlify\.app$/.exec(hostname),scope=preview?'pulls/'+preview[1]:'commits/main';
 const cached=revisionCache.get(scope);if(cached&&cached.expires>Date.now())return cached.sha;
 const res=await fetch(`https://api.github.com/repos/${REPO}/${scope}`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('revision unavailable');
 const info=await res.json(),sha=preview?info.head?.sha:info.sha;
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error('invalid revision');
 revisionCache.set(scope,{sha,expires:Date.now()+300000});return sha;
}
export default async request=>{
 const q=new URL(request.url).searchParams,kind=q.get('kind'),lawd=q.get('lawd'),path=dashboardPath(kind,lawd),requested=q.get('revision');
 if(!path||(requested&&!/^[a-f0-9]{40}$/.test(requested)))return new Response('Invalid request',{status:400});
 if(kind==='kb-sale-general'&&(!q.get('name')||q.get('name').length>120||!q.get('dong')||q.get('dong').length>40))return new Response('Invalid complex lookup',{status:400});
 // Popup details must use the revision returned by their regional summary.
 if(q.get('kind')==='regional-detail'&&!requested)return new Response('Revision required',{status:400});
 try{
  const revision=requested||await latestRevision(new URL(request.url).hostname);
  const res=await fetch(`https://raw.githubusercontent.com/${REPO}/${revision}/${path}`,{signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('data unavailable');
  const data=await res.json();
  if(kind==='kb-sale-general'){
   const normalize=value=>String(value||'').normalize('NFKC').replace(/[\s·ㆍ,.-]/g,'').toLocaleLowerCase('ko-KR');
   const name=normalize(q.get('name')),dong=normalize(q.get('dong'));
   const matches=(data.complexes||[]).filter(item=>normalize(item.name)===name&&normalize(item.dong)===dong);
   return Response.json({collectedAt:data.collectedAt||null,kbReferenceDate:data.kbReferenceDate||null,complex:matches.length===1?matches[0]:null,matchCount:matches.length,dataRevision:revision},{headers:{'Cache-Control':'public, max-age=60','Netlify-CDN-Cache-Control':'public, max-age=300'}});
  }
  return Response.json({...data,dataRevision:revision},{headers:{'Cache-Control':'public, max-age=60','Netlify-CDN-Cache-Control':requested?'public, max-age=86400':'public, max-age=60'}});
 }catch{return Response.json({error:'dashboard_data_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
};
