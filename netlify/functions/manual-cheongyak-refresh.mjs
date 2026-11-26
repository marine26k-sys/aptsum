import { hasValidStatsSession } from "../../shared/sessions.mjs";

const REPO='marine26k-sys/aptsum';
const WORKFLOWS=['collect-cheongyak.yml','collect-lh-sale.yml'];
const ALLOWED_ORIGINS=/^https:\/\/(?:www\.)?aptsum\.kr$|^https:\/\/deploy-preview-\d+--aptsum\.netlify\.app$/;
let lastDispatchAt=0;
export const config={path:'/api/manual-cheongyak-refresh'};

function json(data,status=200){
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','Vary':'Cookie'}});
}

export default async request=>{
  if(request.method!=='POST')return json({message:'POST 요청만 허용됩니다.'},405);
  const origin=request.headers.get('origin')||'';
  if(!ALLOWED_ORIGINS.test(origin))return json({message:'허용되지 않은 요청입니다.'},403);
  const sessionSecret=process.env.SUBSCRIBER_SESSION_SECRET;
  if(!sessionSecret||!process.env.STATS_ACCESS_CODE)return json({message:'관리자 인증 설정이 필요합니다.'},503);
  if(!hasValidStatsSession(request,sessionSecret))return json({message:'관리자 로그인 후 다시 시도해주세요.'},401);
  const token=process.env.GITHUB_ACTIONS_TOKEN;
  if(!token)return json({message:'수동 수집 연동 설정이 필요합니다.'},503);
  if(Date.now()-lastDispatchAt<60_000)return json({message:'이미 수집 요청을 보냈습니다. 잠시 후 다시 시도해주세요.'},429);
  lastDispatchAt=Date.now();
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  try{
    for(const workflow of WORKFLOWS){
      const response=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,{
        method:'POST',headers,body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(15000),
      });
      if(response.status!==204)throw new Error(`GitHub workflow dispatch failed: ${workflow}`);
    }
    return json({ok:true,message:'청약홈 및 LH 분양 공고 수집을 실행했습니다.'});
  }catch{
    // GitHub가 요청을 수락한 뒤 응답이 끊겼을 수 있으므로 실패 시에도
    // 쿨다운을 유지해 재시도 연타로 중복 워크플로를 만들지 않는다.
    return json({message:'GitHub 수집 실행 요청에 실패했습니다. 1분 후 다시 확인해주세요.'},502);
  }
};
