// Read batch-generated public data without requiring a new site deploy.
const REPO='marine26k-sys/aptsum';
let cachedRevision=null,expires=0;
export const config={path:'/api/dashboard-data'};
export function dashboardPath(kind,lawd){
 if(kind==='tier')return 'data/tier-map.json';
 if(kind==='regional')return 'data/regional-change.json';
 if(kind==='regional-detail'&&/^(?:\d{5}|(?:BC|HS|IC)-[가-힣]+)$/.test(lawd||''))return `data/regional-change-details/${lawd}.json`;
 return null;
}
async function latestRevision(){
 // Preview must keep its proposed calculation/data instead of replacing it with main.
 if(process.env.CONTEXT==='deploy-preview'&&/^[a-f0-9]{40}$/.test(process.env.COMMIT_REF||''))return process.env.COMMIT_REF;
 if(cachedRevision&&expires>Date.now())return cachedRevision;
 const res=await fetch(`https://api.github.com/repos/${REPO}/commits/main`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
 if(!res.ok)throw Error('revision unavailable');
 const {sha}=await res.json();if(!/^[a-f0-9]{40}$/.test(sha))throw Error('invalid revision');
 cachedRevision=sha;expires=Date.now()+300000;return sha;
}
export default async request=>{
 const q=new URL(request.url).searchParams,path=dashboardPath(q.get('kind'),q.get('lawd')),requested=q.get('revision');
 if(!path||(requested&&!/^[a-f0-9]{40}$/.test(requested)))return new Response('Invalid request',{status:400});
 // Popup details must use the revision returned by their regional summary.
 if(q.get('kind')==='regional-detail'&&!requested)return new Response('Revision required',{status:400});
 try{
  const revision=requested||await latestRevision();
  const res=await fetch(`https://raw.githubusercontent.com/${REPO}/${revision}/${path}`,{signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('data unavailable');
  const data=await res.json();return Response.json({...data,dataRevision:revision},{headers:{'Cache-Control':'public, max-age=60','Netlify-CDN-Cache-Control':requested?'public, max-age=86400':'public, max-age=60'}});
 }catch{return Response.json({error:'dashboard_data_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
};
