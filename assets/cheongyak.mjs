import {CATEGORIES,kstToday,noticeKey,noticeStatus,daysUntil,officialURL,filterNotices} from '../shared/cheongyak.mjs';
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let items=[],limit=20,today=kstToday(),favorites=[],loading=false,lastLoaded=0,lastPayload='',hasData=false;
try{const data=JSON.parse(localStorage.getItem('apc:cheongyak:favs:v1')||'[]');if(Array.isArray(data))favorites=data.filter(x=>typeof x==='string');}catch{}
const params=new URLSearchParams(location.search);
for(const [id,key] of [['status','s'],['category','c'],['region','r']])if([...$(id).options].some(o=>o.value===params.get(key)))$(id).value=params.get(key);
$('query').value=params.get('q')||'';
const filters=()=>({status:$('status').value,category:$('category').value,region:$('region').value,query:$('query').value,favoritesOnly:$('favoritesOnly').checked,favorites});
function money(value){return Number.isFinite(value)&&value>0?`${(value/10000).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}억`:'공고문 확인';}
function card(item){
 const state=noticeStatus(item,today),status={open:'접수 중',upcoming:'접수 예정',closed:'마감',unknown:'일정 확인'}[state];
 const remaining=daysUntil(state==='upcoming'?item.apply_start:item.apply_end,today);
 const dday=['open','upcoming'].includes(state)&&remaining!==null?(remaining===0?'오늘 마감':state==='open'?`마감 D-${remaining}`:`접수 D-${remaining}`):'';
 const key=noticeKey(item),saved=favorites.includes(key),detail=officialURL(item.detail_url),apply=officialURL(item.apply_url);
 const units=(item.units||[]).filter(x=>x?.type),schedule=(item.schedule||[]).filter(x=>x?.label&&Array.isArray(x.dates));
 const prices=item.price_min>0?(item.price_max>item.price_min?`${money(item.price_min)} ~ ${money(item.price_max)}`:money(item.price_min)):'공고문 확인';
 return `<article class="notice"><div class="notice-head"><div class="topline"><span>${esc(item.region)} · ${esc(CATEGORIES[item.category]||'청약')}</span><button class="favorite" data-key="${esc(key)}" aria-label="${esc(item.name)} 관심 공고 ${saved?'해제':'저장'}" aria-pressed="${saved}">${saved?'★':'☆'}</button></div><h2>${esc(item.name)}</h2>${item.address?`<p class="address">${esc(item.address)}</p>`:''}</div><div class="notice-body"><div class="statusline"><span class="badge ${state}">${status}</span><span>${dday}</span></div><dl><dt>접수 기간</dt><dd>${esc(item.apply_period||'공고문 확인')}</dd><dt>당첨 발표</dt><dd>${esc(item.announce_date||'공고문 확인')}</dd><dt>공급 세대</dt><dd>${Number.isFinite(item.total_units)?item.total_units.toLocaleString()+'세대':'공고문 확인'}</dd><dt>공급 금액</dt><dd>${esc(prices)}</dd>${item.move_in?`<dt>입주 예정</dt><dd>${esc(item.move_in)}</dd>`:''}</dl>${units.length||schedule.length?`<details><summary>주택형·청약 일정</summary>${units.length?`<table><thead><tr><th>주택형</th><th>공급</th><th>금액</th></tr></thead><tbody>${units.map(u=>`<tr><td>${esc(u.type)}</td><td>${Number.isFinite(u.total)?u.total+'세대':'—'}</td><td>${esc(money(u.price))}</td></tr>`).join('')}</tbody></table>`:''}${schedule.length?`<ul class="schedule">${schedule.map(s=>`<li>${esc(s.label)} · ${esc(s.dates.join(' / '))}</li>`).join('')}</ul>`:''}</details>`:''}<div class="actions">${detail?`<a class="action" href="${esc(detail)}" target="_blank" rel="noopener noreferrer">청약홈 공고문 ↗</a>`:''}${apply&&state!=='closed'?`<a class="action primary" href="${esc(apply)}" target="_blank" rel="noopener noreferrer">청약홈 신청 ↗</a>`:''}</div></div></article>`;
}
function render(){
 if(!hasData)return;
 const expanded=new Set([...document.querySelectorAll('.notice details[open]')].map(d=>d.closest('.notice').querySelector('.favorite').dataset.key));
 const f=filters(),all=filterNotices(items,{...f,status:'all'},today),open=all.filter(x=>noticeStatus(x,today)==='open').length,upcoming=all.filter(x=>noticeStatus(x,today)==='upcoming').length;
 $('countActive').textContent=open+upcoming;$('countOpen').textContent=open;$('countUpcoming').textContent=upcoming;
 document.querySelectorAll('.count').forEach(b=>{const on=b.dataset.status===f.status;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
 const filtered=filterNotices(items,f,today);$('resultCount').textContent=`공고 ${filtered.length.toLocaleString()}건`;
 $('results').innerHTML=filtered.length?filtered.slice(0,limit).map(card).join(''):'<div class="empty">조건에 맞는 공고가 없습니다.<br>접수 상태나 지역을 바꿔 보세요.</div>';
 for(const detail of document.querySelectorAll('.notice details'))if(expanded.has(detail.closest('.notice').querySelector('.favorite').dataset.key))detail.open=true;
 $('more').hidden=filtered.length<=limit;$('more').textContent=`더 보기 (${Math.min(limit,filtered.length)}/${filtered.length})`;
 const p=new URLSearchParams();if(f.status!=='active')p.set('s',f.status);if(f.category)p.set('c',f.category);if(f.region)p.set('r',f.region);if(f.query)p.set('q',f.query);
 history.replaceState(null,'',location.pathname+(p.size?'?'+p.toString():''));
}
for(const id of ['status','category','region','favoritesOnly'])$(id).addEventListener('change',()=>{limit=20;render();});
$('query').addEventListener('input',()=>{limit=20;render();});
document.querySelectorAll('.count').forEach(b=>b.addEventListener('click',()=>{$('status').value=b.dataset.status;limit=20;render();}));
$('reset').addEventListener('click',()=>{$('status').value='active';$('category').value='';$('region').value='';$('query').value='';$('favoritesOnly').checked=false;limit=20;render();});
$('more').addEventListener('click',()=>{limit+=20;render();});
$('results').addEventListener('click',event=>{const b=event.target.closest('[data-key]');if(!b)return;const key=b.dataset.key;favorites=favorites.includes(key)?favorites.filter(x=>x!==key):[...favorites,key];try{localStorage.setItem('apc:cheongyak:favs:v1',JSON.stringify(favorites));}catch{}render();[...document.querySelectorAll('.favorite')].find(x=>x.dataset.key===key)?.focus();});
async function load(){
 if(loading)return;loading=true;
 try{
  const response=await fetch('/api/cheongyak',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('network');const data=await response.json();if(!Array.isArray(data.items)||data.items.some(x=>!x||typeof x.name!=='string'||!x.pblancNo||x.units!=null&&!Array.isArray(x.units)||x.schedule!=null&&!Array.isArray(x.schedule)))throw Error('format');
  const payload=JSON.stringify(data),changed=payload!==lastPayload;
  const seen=new Set();items=data.items.filter(x=>['서울','경기','인천','부산'].includes(x.region)&&['apt','remainder'].includes(x.category)&&x.name&&x.pblancNo&&!seen.has(noticeKey(x))&&seen.add(noticeKey(x)));
  $('updated').textContent=`최근 갱신 ${data.updated_at||'확인 불가'} · 서울·경기·인천·부산`;
  const match=String(data.updated_at||'').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) KST$/),updated=match?Date.parse(`${match[1]}T${match[2]}:00+09:00`):NaN;
  $('warning').hidden=true;
  if(!Number.isFinite(updated)||Date.now()-updated>36*3600000){$('warning').hidden=false;$('warning').textContent='데이터 갱신이 지연되고 있습니다. 최근 공고는 청약홈에서 확인해 주세요.';}
  if(data.detail_failures?.length){$('warning').hidden=false;$('warning').textContent='일부 공고의 상세 정보 갱신이 지연돼 이전 자료를 사용했습니다. 해당 정보는 청약홈 공고문에서 확인해 주세요.';}
  lastLoaded=Date.now();lastPayload=payload;hasData=true;if(changed)render();
 }catch{if(hasData){$('warning').hidden=false;$('warning').textContent='최신 공고를 갱신하지 못해 이전 자료를 표시합니다. 청약홈에서 최신 공고를 확인해 주세요.';return;}$('resultCount').textContent='공고 조회 실패';$('results').innerHTML='<div class="empty">공고를 불러오지 못했습니다.<br><button class="reset" id="retry">다시 시도</button></div>';$('retry').addEventListener('click',load);}
 finally{loading=false;}
}
load();setInterval(()=>{const date=kstToday();if(date!==today){today=date;render();}if(!document.hidden&&Date.now()-lastLoaded>300000)load();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastLoaded>300000)load();});
