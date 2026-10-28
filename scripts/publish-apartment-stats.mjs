import {execFileSync} from 'node:child_process';
import {readFileSync,copyFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const allowed=new Set(['data/reb-weekly-index.json','data/reb-apartment-prices.json','data/move-in.json']);
const files=process.argv.slice(2);
if(!files.length||files.some(file=>!allowed.has(file)))throw Error('Specify supported apartment statistics JSON files');
for(const file of files){const data=JSON.parse(readFileSync(file,'utf8'));if(!data||typeof data!=='object')throw Error(`Invalid data: ${file}`);}
const remote=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim();
let gitEnv=process.env;
try{const authorization=execFileSync('git',['config','--get','http.https://github.com/.extraheader'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(authorization)gitEnv={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:authorization};}catch{}
const folder=mkdtempSync(join(tmpdir(),'aptsum-stats-'));
const git=(args)=>execFileSync('git',args,{cwd:folder,env:gitEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try{
 execFileSync('git',['clone','--quiet','--depth','1','--single-branch','--branch','reb-weekly-data',remote,folder],{env:gitEnv,stdio:'pipe'});
 git(['config','user.name','github-actions[bot]']);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
 for(const file of files){mkdirSync(dirname(join(folder,file)),{recursive:true});copyFileSync(resolve(file),join(folder,file));}
 git(['add','--',...files]);
 if(!git(['diff','--cached','--name-only']).trim()){console.log('Statistics data unchanged');}
 else{git(['commit','-m','Refresh apartment statistics [skip netlify]']);for(let attempt=0;;attempt++){try{git(['push','origin','HEAD:reb-weekly-data']);break;}catch(error){if(attempt>=2)throw error;git(['pull','--rebase','origin','reb-weekly-data']);}}console.log(`Published ${files.join(', ')} without site deployment`);}
}finally{rmSync(folder,{recursive:true,force:true});}
