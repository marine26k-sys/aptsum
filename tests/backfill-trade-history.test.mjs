import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {missingHistory,successfulMonths} from '../scripts/backfill-missing-trade-history.mjs';
import {TRADE_HISTORY_MONTHS,recentTradeMonths} from '../shared/trade-batch-policy.mjs';
test('history window includes the exact five-year month and twelve prior seed months',()=>{
 const months=recentTradeMonths(TRADE_HISTORY_MONTHS,Date.parse('2026-10-20T00:00:00Z'));
 assert.equal(months.length,73);assert.equal(months[60],'202110');assert.equal(months.at(-1),'202010');
});
test('resumable backfill preserves valid empty months and identifies corrupt or missing files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'aptsum-history-'));
 try{
  await mkdir(join(root,'analyze','11111'),{recursive:true});
  await writeFile(join(root,'analyze','11111','202610.json'),JSON.stringify({ym:'202610',items:[]}));
  await writeFile(join(root,'analyze','11111','202609.json'),'invalid');
  const jobs=await missingHistory({root,lawds:['11111'],kinds:['analyze'],months:['202610','202609','202608']});
  assert.deepEqual(jobs,[{kind:'analyze',lawd:'11111',months:['202609','202608']}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('failed months are not stored as empty successful months',()=>{
 const job={months:['202609','202608']};
 assert.deepEqual(successfulMonths(job,{items:[],failedMonths:['202608']}),[{ym:'202609',items:[]}]);
 assert.throws(()=>successfulMonths(job,{items:[]}),/Invalid/);
});
