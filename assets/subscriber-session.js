// 코드 원문 대신 서버가 검증하는 복원 자격만 브라우저에 저장한다.
(() => {
  const KEY='aptsum:subscriber-recovery:v1';
  const read=()=>{try{return localStorage.getItem(KEY);}catch{return null;}};
  const save=value=>{try{if(value)localStorage.setItem(KEY,value);else localStorage.removeItem(KEY);}catch{}};
  const remember=async response=>{
    if(response.ok){const data=await response.clone().json();if(data.subscribed && data.recovery)save(data.recovery);}
    return response;
  };
  const post=body=>fetch('/api/subscriber',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let pending;
  const check=()=>{
    if(pending)return pending;
    pending=(async()=>{
      const response=await remember(await fetch('/api/subscriber',{credentials:'same-origin',cache:'no-store'}));
      if(!response.ok || (await response.clone().json()).subscribed)return response;
      const recovery=read();if(!recovery)return response;
      const restored=await remember(await post({action:'restore',recovery}));
      if(restored.status===401 || restored.status===403)save(null);
      return restored;
    })().finally(()=>{pending=null;});
    return pending;
  };
  window.aptsumSession=Object.freeze({check,login:async code=>remember(await post({code}))});
})();
