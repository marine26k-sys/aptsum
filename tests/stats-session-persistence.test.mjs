import test from 'node:test';import assert from 'node:assert/strict';
import auth from '../netlify/functions/stats-auth.mjs';
import {sign,hasValidStatsSession,STATS_COOKIE_NAME}from'../shared/sessions.mjs';
const secret='synthetic-session-test-secret';
const request=data=>{const payload=Buffer.from(JSON.stringify(data)).toString('base64url');return new Request('https://example.test/api/stats-auth',{headers:{cookie:`${STATS_COOKIE_NAME}=${payload}.${sign(payload,secret)}`}});};
test('관리자 무기한 세션은 구독자 세션이나 변조 세션을 허용하지 않는다',()=>{
 assert.equal(hasValidStatsSession(request({kind:'stats',version:1}),secret),true);
 assert.equal(hasValidStatsSession(request({kind:'subscriber',version:1}),secret),false);
 assert.equal(hasValidStatsSession(request({kind:'stats',version:1}),'other-secret'),false);
 assert.equal(hasValidStatsSession(request({exp:1}),secret),false);
});
test('유효한 기존 세션 확인 시 만료 없는 관리자 세션과 보관 쿠키로 갱신한다',async()=>{
 const saved={code:process.env.STATS_ACCESS_CODE,secret:process.env.SUBSCRIBER_SESSION_SECRET};
 process.env.STATS_ACCESS_CODE='synthetic-test-code';process.env.SUBSCRIBER_SESSION_SECRET=secret;
 try{
  const result=await auth(request({exp:Math.floor(Date.now()/1000)+60}),{});
  assert.equal((await result.json()).authenticated,true);
  const cookie=result.headers.get('set-cookie');assert.match(cookie,/Max-Age=34560000/);assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  const payload=JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0],'base64url').toString());
  assert.deepEqual(payload,{kind:'stats',version:1});
 }finally{for(const[key,value]of[['STATS_ACCESS_CODE',saved.code],['SUBSCRIBER_SESSION_SECRET',saved.secret]])value===undefined?delete process.env[key]:process.env[key]=value;}
});
