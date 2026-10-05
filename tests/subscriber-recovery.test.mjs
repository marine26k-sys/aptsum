import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecovery,readRecovery} from '../shared/subscriber-recovery.mjs';
import {createPersonalSession,restorePersonalSession} from '../shared/subscribers.mjs';
import {sign} from '../shared/sessions.mjs';
const secret='test-secret';
const sub={id:'sample',gen:1,revoked:false,expiresAt:Date.now()+86400000,scope:'listings'};
const first=createPersonalSession(secret,sub);
const data=JSON.parse(Buffer.from(first.token.split('.')[0],'base64url'));
const session={kind:'personal',sub,did:data.did,expiresAt:data.expiresAt};
const recovery=createRecovery(secret,session);
test('cookie recovery preserves device, scope, expiry and original cookie signing rules',async()=>{
 const restored=await readRecovery(recovery,secret,async()=>sub);
 assert.equal(restored.sub.scope,'listings');assert.equal(restored.did,session.did);assert.equal(restored.expiresAt,session.expiresAt);
 const cookie=restorePersonalSession(secret,restored);assert.equal(cookie.token,first.token);
 assert.ok(cookie.maxAge<=30*86400);
});
test('recovery rejects tampering, other keys and normal session tokens',async()=>{
 for(const t of [recovery+'x',first.token,'malformed'])assert.equal(await readRecovery(t,secret,async()=>sub),null);
 assert.equal(await readRecovery(recovery,'changed-key',async()=>sub),null);
});
test('recovery checks revocation, subscription expiry, code regeneration and missing subscribers',async()=>{
 for(const s of [null,{...sub,revoked:true},{...sub,expiresAt:Date.now()-1},{...sub,gen:2}])assert.equal(await readRecovery(recovery,secret,async()=>s),null);
 const old=createRecovery(secret,{...session,expiresAt:Date.now()-1});assert.equal(await readRecovery(old,secret,async()=>sub),null);
});
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function browser(fetch, initial){
 const storage=new Map(initial?[['aptsum:subscriber-recovery:v1',initial]]:[]);
 const context={window:{},fetch,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 vm.runInNewContext(readFileSync(new URL('../assets/subscriber-session.js',import.meta.url),'utf8'),context);
 return {client:context.window.aptsumSession,storage};
}
test('browser reopens without cookie and restores once for concurrent checks',async()=>{
 let cookie=false,restores=0;
 const {client,storage}=browser(async(_url,options)=>{
  if(options.method==='POST'){
   const body=JSON.parse(options.body);
   if(body.code){cookie=true;return Response.json({subscribed:true,recovery:'signed-recovery'});}
   assert.equal(body.recovery,'signed-recovery');restores++;cookie=true;
  }
  return Response.json({subscribed:cookie,recovery:cookie?'signed-recovery':null});
 });
 await client.login('PRIVATE-CODE');assert.equal([...storage.values()].includes('PRIVATE-CODE'),false);
 cookie=false;
 const rs=await Promise.all([client.check(),client.check()]);
 assert.equal(restores,1);assert.equal((await rs[0].clone().json()).subscribed,true);
});
test('browser keeps recovery during server errors and clears it when rejected',async()=>{
 let fail=true;
 const {client,storage}=browser(async(_url,options)=>options.method==='POST'?Response.json({error:'restore_expired'},{status:fail?503:401}):Response.json({subscribed:false}),'saved');
 await client.check();assert.equal(storage.size,1);fail=false;await client.check();assert.equal(storage.size,0);
});
test('valid existing cookie registers recovery without requiring code entry',async()=>{
 const {client,storage}=browser(async()=>Response.json({subscribed:true,recovery:'migrated'}));
 await client.check();assert.equal(storage.get('aptsum:subscriber-recovery:v1'),'migrated');
});
