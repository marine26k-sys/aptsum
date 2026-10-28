import {execFileSync} from 'node:child_process';
const dataFiles=new Set(['data/reb-weekly-index.json','data/reb-apartment-prices.json','data/move-in.json']);
try{
 const base=process.env.CACHED_COMMIT_REF||'HEAD^';
 const paths=execFileSync('git',['diff','--name-only',base,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 process.exit(paths.length&&paths.every(path=>dataFiles.has(path))?0:1);
}catch{process.exit(1);}
