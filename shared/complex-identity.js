// 검색 목록과 브라우저 분석이 공유하는 단지 식별 규칙.
// 다른 동·지역 또는 부분 문자열만 같은 단지는 합치지 않는다.
(function(root){
  const key=value=>String(value||'').replace(/\s/g,'').toLowerCase();
  const caches=new WeakMap();
  // 실거래명 이스트폴과 네이버 확인명 롯데캐슬이스트폴의 대응.
  const verified={'11215|자양동|이스트폴':'롯데캐슬이스트폴'};
  function canonical(name,umd,names={},lawd=''){
    const override=verified[`${lawd}|${umd}|${key(name)}`];if(override)return override;
    let map=caches.get(names);
    if(!map){map=new Map(Object.entries(names).map(([k,v])=>[key(k),v]));caches.set(names,map);}
    return map.get(key(`${name}|${umd}`))||name;
  }
  function mergeSources(sales,presales,names={},lawd=''){
    const representatives=new Map();
    const normalize=item=>{
      const display=canonical(item.apt,item.umd,names,lawd),id=JSON.stringify([key(display),item.umd]);
      if(!representatives.has(id))representatives.set(id,display);
      return {...item,apt:representatives.get(id),sourceApt:item.sourceApt||item.apt};
    };
    return [...sales.map(normalize),...presales.map(t=>normalize({...t,build:t.build||'',kind:t.kind||t.ownership||'분양권'}))];
  }
  function indexEntries(items,meta,names={}){
    const groups=new Map();
    for(const item of items){
      if(!item.apt||!item.umd)continue;
      // 국토부 원자료에 단지명이 법정동명만으로 기록된 일부 거래가 있어
      // 자동완성에서 '봉천동' 같은 행정동이 단지 후보로 노출되지 않게 한다.
      if(key(item.apt)===key(item.umd))continue;
      const display=canonical(item.apt,item.umd,names,meta.lawd),id=JSON.stringify([key(display),item.umd]);
      const row=groups.get(id)||{...meta,umd:item.umd,name:display,names:new Set()};
      row.names.add(item.apt);row.names.add(display);groups.set(id,row);
    }
    return [...groups.values()].map(row=>({...row,names:[...row.names]}));
  }
  root.aptsumComplexIdentity={key,canonical,mergeSources,indexEntries};
})(globalThis);
