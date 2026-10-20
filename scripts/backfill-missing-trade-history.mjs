#!/usr/bin/env node
// 공개 실거래 API로 누락된 월 파일만 보완한다. 브랜치에서 실행하며 커밋·푸시는 하지 않는다.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ALL_LAWDS} from '../shared/regions.mjs';
import {recentTradeMonths,TRADE_HISTORY_MONTHS} from '../shared/trade-batch-policy.mjs';

export async function missingHistory({root='data',lawds=ALL_LAWDS,kinds=['analyze','presale','rent'],months=recentTradeMonths(TRADE_HISTORY_MONTHS)}={}){
 const jobs=[];
 for(const kind of kinds)for(const lawd of lawds){
  const missing=[];
  for(const ym of months){
   try{const j=JSON.parse(await readFile(`${root}/${kind}/${lawd}/${ym}.json`,'utf8'));if(j.ym!==ym||!Array.isArray(j.items))missing.push(ym);}catch{missing.push(ym);}
  }
  for(let i=0;i<missing.length;i+=4)jobs.push({kind,lawd,months:missing.slice(i,i+4)});
 }
 return jobs;
}
export function successfulMonths(job,result){
 if(!Array.isArray(result?.items)||!Array.isArray(result?.failedMonths)||result.error)throw Error('Invalid month response');
 const failed=new Set(result.failedMonths);
 return job.months.filter(ym=>!failed.has(ym)).map(ym=>({ym,items:result.items.filter(t=>t.ym===ym)}));
}
async function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split('=')));
 const jobs=await missingHistory({months:recentTradeMonths(Number(args.months)||TRADE_HISTORY_MONTHS)});
 const count=jobs.reduce((n,j)=>n+j.months.length,0);
 console.log(JSON.stringify({regions:ALL_LAWDS.length,jobs:jobs.length,missingMonths:count}));
 if('check' in args){process.exitCode=count?1:0;return;}
 const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
 if(branch==='main'||branch==='master'||!branch)throw Error('Run on a review branch');
 const origin=args.origin||'https://aptsum.kr';
 let next=0,done=0,written=0,failures=0;
 const worker=async()=>{while(next<jobs.length){const job=jobs[next++];let remaining=job.months.slice();
  for(let attempt=0;attempt<3&&remaining.length;attempt++){
   try{
    const query=new URLSearchParams({lawd:job.lawd,yms:remaining.join(','),live:'1'});
    const response=await fetch(`${origin}/api/${job.kind}?${query}`,{signal:AbortSignal.timeout(90000)});
    if(!response.ok)throw Error('HTTP '+response.status);
    const result=await response.json();
    const months=successfulMonths({...job,months:remaining},result);
    for(const month of months){
     const dir=`data/${job.kind}/${job.lawd}`;await mkdir(dir,{recursive:true});
     const file=`${dir}/${month.ym}.json`,tmp=file+'.tmp';
     await writeFile(tmp,JSON.stringify({...month,updatedAt:new Date().toISOString()}));await rename(tmp,file);written++;
    }
    const success=new Set(months.map(m=>m.ym));remaining=remaining.filter(ym=>!success.has(ym));
   }catch(error){if(attempt===2)console.log(JSON.stringify({failed:job.kind,lawd:job.lawd,months:remaining,message:error.message}));}
   if(remaining.length&&attempt<2)await new Promise(r=>setTimeout(r,2000*(attempt+1)));
  }
  failures+=remaining.length;done++;
  if(done%10===0||done===jobs.length)console.log(JSON.stringify({done,total:jobs.length,written,failures}));
 }};
 await Promise.all(Array.from({length:Math.min(3,Number(args.concurrency)||2)},worker));
 console.log(JSON.stringify({complete:failures===0,written,failures}));if(failures)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
