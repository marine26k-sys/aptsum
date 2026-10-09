// 코드 원문 대신 서버가 검증하는 복원 자격만 브라우저에 저장한다.
(() => {
  const KEY='aptsum:subscriber-recovery:v1';
  const read=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};
  const save=value=>{try{if(value)localStorage.setItem(KEY,value);else localStorage.removeItem(KEY);}catch{}};
  const remember=async response=>{
    if(response.ok){const data=await response.clone().json();if(data.subscribed)save(data.recovery || null);}
    return response;
  };
  const post=body=>fetch('/api/subscriber',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let pending, signingOut;
  const check=()=>{
    if(signingOut)return Promise.resolve(Response.json({subscribed:false}));
    if(pending)return pending.then(response=>response.clone());
    pending=(async()=>{
      const response=await remember(await fetch('/api/subscriber',{credentials:'same-origin',cache:'no-store'}));
      if(!response.ok || (await response.clone().json()).subscribed)return response;
      const recovery=read();if(!recovery)return response;
      const restored=await remember(await post({action:'restore',recovery}));
      if(restored.status===401 || restored.status===403){save(null);return response;}
      return restored;
    })().finally(()=>{pending=null;});
    return pending.then(response=>response.clone());
  };
  const logout=()=>signingOut ||= (async()=>{
    if(pending)await pending.catch(()=>{});
    const response=await post({action:'logout'});
    if(response.ok)save(null);
    return response;
  })().finally(()=>{signingOut=null;});
  window.aptsumSession=Object.freeze({check,login:async code=>remember(await post({code})),logout});
})();
