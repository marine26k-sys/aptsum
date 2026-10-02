import { naverNameOverrides } from "./naver-name-overrides.mjs";
// naver/tools/add_historical_high.py의 _norm_name/match_trade_names와 같은 비교 규칙.
// 원문 이름을 저장 키로 유지하고 정규화는 비교에만 사용한다.
const ALIASES = [['VIEW','뷰'],['IPARK','아이파크'],['XI','자이'],['CASTLE','캐슬'],['PALACE','팰리스'],['TOWER','타워'],['PARK','파크'],['HILL','힐'],['TOWN','타운'],['VILLE','빌']];
const LETTERS = '에이 비 씨 디 이 에프 지 에이치 아이 제이 케이 엘 엠 엔 오 피 큐 알 에스 티 유 브이 더블유 엑스 와이 제트'.split(' ');
const generic = new Set(['맨션','빌라','타운','하이츠','주택','연립','빌딩','빌라트']);
const translit = s => /[A-Z]/.test(s) ? s.replace(/[A-Z]+/g, v => [...v].map(c => LETTERS[c.charCodeAt(0)-65]).join('')) : null;
const digitsRemoved = s => s.replace(/\d+/g,'');
function paren(inner, keepChasu) {
  const chasu = inner.match(/^\s*(\d+)\s*(?:단지|차)\s*$/);
  if (chasu) return keepChasu ? chasu[1] : '';
  if (/^[0-9-]+$/.test(inner) || /,|[0-9]|블럭|블록|주상복합|주거복합|복합/.test(inner)) return '';
  return inner;
}
export function naverNameKey(name, dong = '', { keepChasu = true } = {}) {
  let s = String(name || '').replace(/&amp;|&AMP;/g,'&');
  s = s.replace(/마을[(（]([^)）]*)[)）]/g, (_,v)=>paren(v,keepChasu));
  s = s.replace(/[(（]([^)）]*)[)）]/g, (_,v)=>paren(v,keepChasu));
  s = s.replace(/[\s\-_·,.'"]+/g,'').replace(/[&＆]/g,'앤').replace(/벨리/g,'밸리');
  const stripped = s.replace(/토지임대부/g,'').replace(/아파트(?!\d+(?:~\d+)?동)/g,'');
  if (stripped) s = stripped;
  s = s.toUpperCase();
  for (const [from,to] of ALIASES) s = s.split(from).join(to);
  s = s.replace(/E/g,'이');
  for (const [from,to] of [['Ⅰ','1'],['Ⅱ','2'],['Ⅲ','3'],['Ⅳ','4'],['Ⅴ','5']]) s = s.split(from).join(to);
  s = s.replace(/(I{1,3})$/, v=>String(v.length)).replace(/(?<=\d)(차|단지)/g,'');
  if (dong) {
    const prefix = naverNameKey(String(dong).replace(/\d*가$/,'').replace(/동$/,''));
    if (prefix.length >= 2 && s.startsWith(prefix) && s.length > prefix.length) s = s.slice(prefix.length);
  }
  for (;;) {
    const next = s.replace(/(제?\d+(~\d+)?동|상가동|아파트|\d{3,})$/,'');
    if (!next || next === s) break;
    s = next;
  }
  return s;
}
const siblingsOf = (q,reserved) => new Set([...(reserved||[])].filter(o=>o!==q && digitsRemoved(o)===digitsRemoved(q) && digitsRemoved(q)));
const transforms = [s=>s.includes('마을')?s.replace(/마을/g,''):null, s=>{const m=s.match(/\d+$/);return m?m[0]+s.slice(0,-m[0].length):null;}, s=>{const m=s.match(/^\d+/);return m?s.slice(m[0].length)+m[0]:null;}, s=>/\d/.test(s)?s.replace(/\d+/g,'마을'):null, s=>{const x=digitsRemoved(s);return x&&x!==s?x:null;}];
const sorted = s => [...s].sort().join('');
// candidates: Map(정규화명 -> 원문 객체 배열). direction: 네이버 이름 -> 실거래 후보.
export function matchNaverTradeNames(candidates, name, dong = '', options = {}) {
  const { reserved = null, ambiguous = new Set(), legacy = new Map(), prefixes = [], strict = false, overrides = naverNameOverrides[`${dong}|${name}`] || [] } = options;
  const q = naverNameKey(name,dong);
  if (!q) return [];
  const exact = candidates.get(q);
  let old = legacy.get(q);
  if (old && reserved && [...reserved].some(o=>o!==q&&o.startsWith(q)&&/^\d+$/.test(o.slice(q.length)))) old=null;
  if (exact?.length || old?.length) return [...new Set([...(exact||[]),...(old||[])])];
  if (overrides.length) {
    const hits=overrides.map(n=>candidates.get(naverNameKey(n,dong)));
    if (hits.every(h=>h?.length)) return [...new Set(hits.flat())];
  }
  if (ambiguous.has(q)) return [];
  const alt=translit(q);
  if (alt&&alt!==q&&!reserved?.has(alt)&&candidates.get(alt)?.length) return candidates.get(alt);
  const transHits=[...candidates].filter(([cn])=>cn!==q&&translit(cn)===q&&!reserved?.has(cn));
  if(transHits.length===1)return transHits[0][1];
  let siblings=[];let reservedSibling=false;
  for(const [cn,items] of candidates){if(!cn.startsWith(q))continue;const rest=cn.slice(q.length);if(!rest.length||rest.length>4||!/[0-9]/.test(rest))continue;if(reserved?.has(cn)){reservedSibling=true;continue;}siblings.push(items);}
  if(strict&&reservedSibling)siblings=[];
  if(siblings.length>1)return siblings.flat();
  let near=[];
  for(const [cn,items] of candidates){if(!cn.includes(q)||(q.length<=2&&!cn.startsWith(q))||reserved?.has(cn))continue;const extra=cn.length-q.length;if(extra<=3)near.push([extra,cn,items]);}
  near.sort((a,b)=>a[0]-b[0]||(a[1]<b[1]?-1:a[1]>b[1]?1:0));
  if(strict&&near.length>1&&near[0][0]===near[1][0])near=[];
  if(near.length)return near[0][2];
  if(String(name||'').replace(/[(（][^)）]*[)）]/g,'').includes(','))return [];
  if(reserved!==null){
    const chasu=siblingsOf(q,reserved);const digit=q.match(/\d+$/);
    if(digit){const base=q.slice(0,-digit[0].length);if(base.length>=2&&!reserved.has(base)&&!chasu.size){const hit=candidates.get(base);const ordered=[...candidates].filter(([cn])=>cn!==q&&!reserved.has(cn)&&sorted(cn)===sorted(q));if(hit?.length&&ordered.length===1)return ordered[0][1];if(hit?.length)return hit;}}
    const others=strict?new Set([...reserved].filter(o=>o!==q)):chasu;
    const noDigit=digitsRemoved(q);
    if(noDigit!==q&&noDigit.length>=4&&!reserved.has(noDigit)&&![...reserved].some(o=>o!==q&&digitsRemoved(o)===noDigit)&&candidates.get(noDigit)?.length)return candidates.get(noDigit);
    for(const method of ['endsWith','startsWith']){
      let hit=null;
      for(const [cn,items] of candidates){if(cn.length<2||reserved.has(cn)||generic.has(cn))continue;if([...others].some(o=>o[method](cn)&&o.length>cn.length))continue;if(q[method](cn)&&q.length>cn.length&&(!hit||cn.length>hit[0].length))hit=[cn,items];}
      if(hit)return hit[1];
    }
    for(const transform of transforms){
      const aq=transform(q);
      if((strict||chasu.size)&&aq&&[...reserved].some(o=>o!==q&&transform(o)===aq))continue;
      if(aq&&aq.length>=2&&!reserved.has(aq)&&candidates.get(aq)?.length)return candidates.get(aq);
      const matches=[...candidates].filter(([cn])=>!reserved.has(cn)&&transform(cn)===q);
      if(matches.length===1)return matches[0][1];
    }
    const letters=sorted(translit(q)||q);
    const anagrams=[...candidates].filter(([cn])=>cn!==q&&!reserved.has(cn)&&sorted(translit(cn)||cn)===letters);
    if(anagrams.length===1)return anagrams[0][1];
  }
  for(const raw of prefixes){const prefix=typeof raw==='string'?raw:raw.name;const strictPrefix=typeof raw==='object'&&raw.strict;if(!prefix||!String(name).startsWith(prefix)||name.length<=prefix.length)continue;
    let nextReserved=reserved;
    if(strict||strictPrefix){nextReserved=reserved?new Set(reserved):reserved;const np=naverNameKey(prefix);const dp=dong?naverNameKey(String(dong).replace(/\d*가$/,'').replace(/동$/,'')):'';for(const o of reserved||[]){if(np&&o.startsWith(np)&&o.length>np.length){const rest=o.slice(np.length);nextReserved.add(rest);if(dp.length>=2&&rest.startsWith(dp)&&rest.length>dp.length)nextReserved.add(rest.slice(dp.length));}}}
    const hits=matchNaverTradeNames(candidates,name.slice(prefix.length),dong,{...options,reserved:nextReserved,prefixes:(strict||strictPrefix)?prefixes.filter(p=>p!==raw):[],strict:strict||strictPrefix});
    if(hits.length)return hits;
  }
  return [];
}
export function sameHouseholds(a,b){return Number.isInteger(+a)&&+a>0&&Number.isInteger(+b)&&+b>0&&+a===+b;}
// 역방향 조회: 실거래 원문 -> 네이버 단지. 여러 후보면 세대수가 같아도 보류한다.
export function findNaverComplex(items, tradeName, { dong = null, expectedHouseholds = null } = {}) {
  const entries = Object.values(items || {}).filter(e => e?.name && (dong == null || e.umd === dong));
  const allowed = e => e.hh > 0 && (expectedHouseholds == null || sameHouseholds(e.hh, expectedHouseholds));
  const raw = String(tradeName || '').replace(/\s/g,'');
  const direct = entries.filter(e => String(e.name).replace(/\s/g,'') === raw);
  if (direct.length) return direct.length === 1 && allowed(direct[0]) ? direct[0] : null;
  const reservedByDong = new Map();
  for (const entry of entries) {
    const d = entry.umd || '';
    if (!reservedByDong.has(d)) reservedByDong.set(d,new Set());
    reservedByDong.get(d).add(naverNameKey(entry.name,d));
  }
  const hits = [];
  for (const entry of entries) {
    const d = entry.umd || '';
    const candidates = new Map([[naverNameKey(raw,d),[{name:raw}]]]);
    if(matchNaverTradeNames(candidates,entry.name,d,{reserved:reservedByDong.get(d)}).length)hits.push(entry);
  }
  return hits.length === 1 && allowed(hits[0]) ? hits[0] : null;
}
export function attachHouseholds(dealMeta, naverItems) {
  for(const [name,meta] of dealMeta){
    if(meta.umds?.size!==1)continue;
    const dong=[...meta.umds][0];
    const hit=findNaverComplex(naverItems,name,{dong});
    if(hit)meta.hh=hit.hh;
  }
  return dealMeta;
}
