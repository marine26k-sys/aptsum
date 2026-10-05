// 쿠키를 잃은 앱 내 브라우저용 복원 자격. 코드 원문은 저장하지 않는다.
// 개인 세션과 다른 서명 목적을 사용하고 서버의 해지·만료·재발급을 매번 확인한다.
import { sign, sameValue } from './sessions.mjs';
import { getSubscriber, isActive } from './subscribers.mjs';
const key = secret => sign('subscriber-recovery:v1', secret);
export function createRecovery(secret, session) {
  if (session?.kind !== 'personal') return null;
  const payload = Buffer.from(JSON.stringify({version:1,sid:session.sub.id,gen:session.sub.gen,did:session.did,expiresAt:session.expiresAt})).toString('base64url');
  return `${payload}.${sign(payload,key(secret))}`;
}
export async function readRecovery(token, secret, lookup = getSubscriber) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !sameValue(signature,sign(payload,key(secret)))) return null;
  let data;
  try { data=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { return null; }
  if (data.version !== 1 || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() || typeof data.did !== 'string') return null;
  const sub=await lookup(data.sid);
  if (!isActive(sub) || sub.gen !== data.gen) return null;
  return {kind:'personal',sub,did:data.did,expiresAt:data.expiresAt};
}
