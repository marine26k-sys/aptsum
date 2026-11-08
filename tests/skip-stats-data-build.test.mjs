import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/skip-stats-data-build.mjs',import.meta.url));
test('호가 통계 자료만 바뀌면 배포를 건너뛰고 화면 변경이 포함되면 배포한다',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aptsum-deploy-test-'));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:['ignore','pipe','ignore'],encoding:'utf8'}).trim();
 const commit=()=>git('-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','test');
 try{
  git('init','-q');writeFileSync(join(dir,'index.html'),'old');git('add','.');commit();const base=git('rev-parse','HEAD');
  mkdirSync(join(dir,'data'));writeFileSync(join(dir,'data','listing-ask-map.json'),'{}');writeFileSync(join(dir,'data','listing-ask-price-bands.json'),'{}');git('add','.');commit();
  const run=()=>spawnSync(process.execPath,[script],{cwd:dir,env:{...process.env,CACHED_COMMIT_REF:base}}).status;
  assert.equal(run(),0);
  writeFileSync(join(dir,'index.html'),'new');git('add','.');commit();assert.equal(run(),1);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
