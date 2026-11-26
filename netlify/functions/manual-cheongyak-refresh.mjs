const REPO='marine26k-sys/aptsum';
const WORKFLOWS=['collect-cheongyak.yml','collect-lh-sale.yml'];
const ALLOWED_ORIGINS=/^https:\/\/(?:www\.)?aptsum\.kr$|^https:\/\/deploy-preview-\d+--aptsum\.netlify\.app$/;
let lastDispatchAt=0;
export const config={path:'/api/manual-cheongyak-refresh'};

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'POST 요청만 허용됩니다.'},{status:405});
  const origin=request.headers.get('origin')||'';
  if(!ALLOWED_ORIGINS.test(origin))return Response.json({message:'허용되지 않은 요청입니다.'},{status:403});
  const token=process.env.GITHUB_ACTIONS_TOKEN;
  if(!token)return Response.json({message:'수동 수집 연동 설정이 필요합니다.'},{status:503});
  if(Date.now()-lastDispatchAt<60_000)return Response.json({message:'이미 수집 요청을 보냈습니다. 잠시 후 다시 시도해주세요.'},{status:429});
  lastDispatchAt=Date.now();
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  try{
    for(const workflow of WORKFLOWS){
      const response=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,{
        method:'POST',headers,body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(15000),
      });
      if(response.status!==204)throw new Error(`GitHub workflow dispatch failed: ${workflow}`);
    }
    return Response.json({ok:true,message:'청약홈 및 LH 분양 공고 수집을 실행했습니다.'},{headers:{'Cache-Control':'no-store'}});
  }catch{
    lastDispatchAt=0;
    return Response.json({message:'GitHub 수집 실행 요청에 실패했습니다.'},{status:502,headers:{'Cache-Control':'no-store'}});
  }
};
