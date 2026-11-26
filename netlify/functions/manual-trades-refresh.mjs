import { hasValidStatsSession } from "../../shared/sessions.mjs";

const REPO='marine26k-sys/aptsum';
const WORKFLOW='collect-trades.yml';
const PREVIEW_ORIGIN=/^https:\/\/deploy-preview-\d+--aptsum\.netlify\.app$/;
const ALLOWED_ORIGINS=/^https:\/\/(?:www\.)?aptsum\.kr$/;
let lastDispatchAt=0;
export const config={path:'/api/manual-trades-refresh'};

function json(data,status=200){
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','Vary':'Cookie'}});
}

export default async request=>{
  if(request.method!=='POST')return json({message:'POST 요청만 허용됩니다.'},405);
  const origin=request.headers.get('origin')||'';
  if(PREVIEW_ORIGIN.test(origin))return json({message:'실거래 수동 수집은 운영 사이트에서만 실행할 수 있습니다.'},403);
  if(!ALLOWED_ORIGINS.test(origin))return json({message:'허용되지 않은 요청입니다.'},403);
  const sessionSecret=process.env.SUBSCRIBER_SESSION_SECRET;
  if(!sessionSecret||!process.env.STATS_ACCESS_CODE)return json({message:'관리자 인증 설정이 필요합니다.'},503);
  if(!hasValidStatsSession(request,sessionSecret))return json({message:'관리자 로그인이 필요합니다. 국토부 실거래 분석 제목을 3회 눌러 로그인한 뒤 다시 시도해주세요.'},401);
  const token=process.env.GITHUB_ACTIONS_TOKEN;
  if(!token)return json({message:'수동 수집 연동 설정이 필요합니다.'},503);
  if(Date.now()-lastDispatchAt<60_000)return json({message:'이미 실거래 수집을 요청했습니다. 잠시 후 다시 시도해주세요.'},429);
  lastDispatchAt=Date.now();
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  try{
    const response=await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,{
      method:'POST',headers,
      // 예약 배치와 같은 범위·옵션: 기존 과거 파일은 재사용하고 최근 4개월만 재조회한다.
      body:JSON.stringify({ref:'main',inputs:{months:'73',refresh:'4',kinds:'analyze,presale,rent',force:'false',only:''}}),
      signal:AbortSignal.timeout(15000),
    });
    if(response.status!==204)throw new Error('GitHub workflow dispatch failed');
    return json({ok:true,message:'자동 배치와 같은 범위로 실거래 수집을 요청했습니다. 최근 4개월을 다시 확인하고 기존 과거 자료는 재사용합니다.'});
  }catch{
    // GitHub가 요청을 수락한 뒤 응답이 끊겼을 수 있으므로 실패 시에도 쿨다운을 유지한다.
    return json({message:'GitHub 실거래 수집 요청에 실패했습니다. 1분 후 다시 확인해주세요.'},502);
  }
};
