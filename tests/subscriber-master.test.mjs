import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/subscriber.mjs';
import {createSession} from '../shared/sessions.mjs';
test('master permission is derived from a verified shared-code session, never request parameters',async()=>{
 const oldSecret=process.env.SUBSCRIBER_SESSION_SECRET,oldCode=process.env.SUBSCRIBER_CODE;
 try{
  process.env.SUBSCRIBER_SESSION_SECRET='test-session-secret';process.env.SUBSCRIBER_CODE='test-master-code';
  const anonymous=await (await handler(new Request('https://fixture.test/api/subscriber?master=true'))).json();
  assert.equal(anonymous.master,false);assert.equal(anonymous.subscribed,false);
  const token=createSession('test-session-secret','test-master-code');
  const master=await (await handler(new Request('https://fixture.test/api/subscriber',{headers:{cookie:`__Host-aptsum_subscriber=${token}`}}))).json();
  assert.equal(master.master,true);assert.equal(master.subscribed,true);
 }finally{
  if(oldSecret===undefined)delete process.env.SUBSCRIBER_SESSION_SECRET;else process.env.SUBSCRIBER_SESSION_SECRET=oldSecret;
  if(oldCode===undefined)delete process.env.SUBSCRIBER_CODE;else process.env.SUBSCRIBER_CODE=oldCode;
 }
});
