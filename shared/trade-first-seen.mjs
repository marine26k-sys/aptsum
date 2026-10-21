const ID_FIELDS = ['apt','umd','area','amt','ym','d','floor','build','direct','ownership'];

export function tradeIdentity(item){
  return JSON.stringify(ID_FIELDS.map(key=>item?.[key]??null));
}

// 이전 수집본과 동일한 거래는 최초 확인 시각을 그대로 유지한다. 같은 조건의 거래가 여러 건일 수
// 있으므로 Set이 아니라 키별 배열로 소비해, 새로 추가된 중복 거래도 신규로 구분한다.
export function preserveTradeFirstSeen(previousItems,currentItems,seenAt=new Date().toISOString()){
  const previousByIdentity=new Map();
  for(const item of previousItems||[]){
    const key=tradeIdentity(item),queue=previousByIdentity.get(key)||[];
    queue.push(item.firstSeenAt||null);
    previousByIdentity.set(key,queue);
  }
  return (currentItems||[]).map(item=>{
    const queue=previousByIdentity.get(tradeIdentity(item));
    if(queue?.length){
      const firstSeenAt=queue.shift();
      return firstSeenAt?{...item,firstSeenAt}:{...item};
    }
    return {...item,firstSeenAt:seenAt};
  });
}
