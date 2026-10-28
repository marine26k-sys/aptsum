// Standalone statistics pages share the same daily tab-click ledger as index.html.
(function(){
  const clicked=new Set(),sent=new Set();
  const flush=()=>{
    const tabs=[...clicked].filter(tab=>!sent.has(tab));
    if(!tabs.length||!navigator.sendBeacon)return;
    try{if(navigator.sendBeacon('/api/tab-clicks',JSON.stringify({tabs})))tabs.forEach(tab=>sent.add(tab));}catch{}
  };
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('[data-track-tab]');
    if(link)clicked.add(link.dataset.trackTab);
  },true);
  addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
})();
