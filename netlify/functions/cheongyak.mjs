export const config={path:'/api/cheongyak'};
const regions=new Set(['서울','경기','인천','부산']);
export function updatedTime(data){
  const match=String(data?.updated_at||'').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) KST$/);
  return match?Date.parse(`${match[1]}T${match[2]}:00+09:00`):NaN;
}
export function validData(data){return Array.isArray(data?.items)&&data.items.length>0&&Number.isFinite(updatedTime(data))&&data.items.every(x=>x.name&&x.pblancNo&&['apt','remainder','other'].includes(x.category));}
export default async function handler(request){
  const origin=new URL(request.url).origin;
  const urls=[`${origin}/data/cheongyak.json`,'https://raw.githubusercontent.com/marine26k-sys/aptsum/main/data/cheongyak.json'];
  const results=await Promise.all(urls.map(async url=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(8000),cache:'no-store'});const data=response.ok?await response.json():null;return validData(data)?data:null;}catch{return null;}}));
  const latest=results.filter(Boolean).sort((a,b)=>updatedTime(b)-updatedTime(a))[0];
  if(!latest)return Response.json({error:'청약 공고를 불러오지 못했습니다.'},{status:503,headers:{'Cache-Control':'no-store'}});
  const items=latest.items.filter(x=>regions.has(x.region)&&['apt','remainder'].includes(x.category));
  return Response.json({...latest,items,count:items.length},{headers:{'Cache-Control':'public, max-age=60','Netlify-CDN-Cache-Control':'public, max-age=300'}});
}
