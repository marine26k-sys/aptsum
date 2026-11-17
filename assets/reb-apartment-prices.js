(()=>{
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const eok=value=>(Number(value)/100000).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1});
 const stateKey='aptsum-reb-apartment-prices-state';
 const rawBase='https://raw.githubusercontent.com/marine26k-sys/aptsum/reb-weekly-data/data/';
 const sizeOptions=[
  {id:'50001',label:'초소형'},
  {id:'50002',label:'소형'},
  {id:'50003',label:'중소형'},
  {id:'50004',label:'중대형'},
  {id:'50005',label:'대형'},
  {id:'area59',label:'전용 59㎡',sourceId:'50002',area:59},
  {id:'area84',label:'전용 84㎡',sourceId:'50003',area:84},
 ];
 let data=null,sizeData=null,region='서울',mapRegion='all',metric='median',regions=[],view='map';
 let sizeRegion='전국',sizeClass='area59';
 function saveState(){try{sessionStorage.setItem(stateKey,JSON.stringify({region,mapRegion,metric,view,sizeRegion,sizeClass}))}catch{}}
 function formatReleaseDate(){const value=data.publishedAt||(data.asOf==='2026-10'?'2026-11-16':'');const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?`${match[1]}.${match[2]}.${match[3]}`:'확인 중'}
 function renderPriceMap(){
  const rows=data.districtMonthly||[],select=$('priceMapPeriod'),periods=[...new Set(rows.map(row=>row.period))].sort().reverse(),selected=periods.includes(select.value)?select.value:periods[0]||'';
  select.innerHTML=periods.map(period=>`<option value="${period}"${period===selected?' selected':''}>${period.replace('-','년 ')}월</option>`).join('');select.onchange=renderPriceMap;
  const current=rows.filter(row=>row.period===selected&&Number.isFinite(row[metric]));
  const placements=window.APTSUM_METRO_TILE_MAP.flatMap((row,y)=>row.map(([x,province,name])=>({x,y,province,name}))).filter(tile=>mapRegion==='all'||(tile.province===mapRegion&&tile.name!==mapRegion));
  const available=placements.filter(tile=>current.some(row=>row.province===tile.province&&row.name===tile.name));
  const grid=$('priceMap'),title=$('priceMapTitle');title.replaceChildren(document.createTextNode(selected?`${Number(selected.slice(5,7))}월 `:'기준 월 없음 '));if(mapRegion!=='all')title.append(document.createTextNode(`${mapRegion} `));title.append(document.createTextNode('아파트 매매 '));const metricWord=document.createElement('span');metricWord.className=`price-map-metric-word ${metric}`;metricWord.textContent=metric==='median'?'중위':'평균';title.append(metricWord,document.createTextNode('가격'));
  if(!available.length){grid.classList.remove('region-map');grid.innerHTML='<div class="empty">선택한 지역의 가격 자료가 없습니다.</div>';return;}
  const max=Math.max(1,...available.map(tile=>current.find(row=>row.province===tile.province&&row.name===tile.name)[metric]));
  const minColumn=mapRegion==='all'?0:Math.min(...available.map(tile=>tile.x)),minRow=mapRegion==='all'?0:Math.min(...available.map(tile=>tile.y));
  const columns=mapRegion==='all'?11:Math.max(...available.map(tile=>tile.x))-minColumn+1;
  grid.classList.toggle('region-map',mapRegion!=='all');grid.style.setProperty('--map-columns',columns);
  grid.innerHTML=available.map(tile=>{const row=current.find(item=>item.province===tile.province&&item.name===tile.name),outline=tile.name===tile.province?null:{서울:'#00484c',인천:'#477dd5',부산:'#d38a2d'}[tile.province];let edges=tile.name===tile.province?'border:1px solid #9aabba;':'';if(outline)for(const[side,dx,dy]of[['top',0,-1],['right',1,0],['bottom',0,1],['left',-1,0]])if(!available.some(neighbor=>neighbor.x===tile.x+dx&&neighbor.y===tile.y+dy&&neighbor.province===tile.province))edges+=`border-${side}:2px solid ${outline};`;return`<div class="price-map-tile" style="grid-column:${tile.x-minColumn+1};grid-row:${tile.y-minRow+1};background:rgba(0,139,145,${.08+.72*Math.pow(row[metric]/max,.65)});${edges}" title="${esc(tile.province+' '+tile.name)} ${eok(row[metric])}억원"><span>${esc(window.APTSUM_METRO_TILE_NAME(tile.name))}</span><strong>${eok(row[metric])}</strong></div>`}).join('');
 }
 function renderSizePrice(){
  const controls=$('sizePriceControls'),panel=$('sizePricePanel');
  controls.hidden=view!=='size';panel.hidden=view!=='size';
  if(view!=='size')return;
  if(!sizeData){$('sizePriceTitle').textContent='규모별 매매 실거래 평균가격';$('sizePriceSubtitle').textContent='통계 자료를 불러오지 못했습니다.';$('sizePriceChart').innerHTML='<div class="empty">자료를 준비 중입니다. 잠시 후 다시 열어 주세요.</div>';return;}
  const groupNames=sizeData.groups.map(group=>group.name);if(!groupNames.includes(sizeRegion))sizeRegion=groupNames[0]||'전국';
  $('sizePriceRegions').innerHTML=sizeData.groups.map(group=>`<button type="button" data-size-region="${esc(group.name)}" aria-pressed="${group.name===sizeRegion}">${esc(group.name)}</button>`).join('');
  $('sizePriceRegions').querySelectorAll('[data-size-region]').forEach(button=>button.onclick=()=>{sizeRegion=button.dataset.sizeRegion;saveState();renderSizePrice()});
  $('sizePriceGroups').innerHTML=sizeOptions.map(option=>`<button type="button" class="chip${option.id===sizeClass?' on':''}" data-size-class="${option.id}" aria-pressed="${option.id===sizeClass}">${option.label}</button>`).join('');
  $('sizePriceGroups').querySelectorAll('[data-size-class]').forEach(button=>button.onclick=()=>{sizeClass=button.dataset.sizeClass;saveState();renderSizePrice()});
  const group=sizeData.groups.find(item=>item.name===sizeRegion),option=sizeOptions.find(item=>item.id===sizeClass)||sizeOptions[5],sourceSize=group?.sizes.find(item=>item.id===(option.sourceId||option.id));
  const values=(sourceSize?.values||[]).slice(-24).reverse().map(item=>({period:item.period,value:option.area?item.value*option.area:item.value}));
  const max=Math.max(1,...values.map(item=>item.value));
  const calculated=Boolean(option.area),unit=calculated?'억원':'만원/㎡';
  const display=value=>calculated?`${(value/10000).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}억`:`${value.toLocaleString('ko-KR',{maximumFractionDigits:1})}`;
  $('sizePriceTitle').textContent=calculated?`전용 ${option.area}㎡ 환산 평균 매매가격 · ${sizeRegion}`:`${option.label} 매매 실거래 평균 단위면적 가격 · ${sizeRegion}`;
  $('sizePriceSubtitle').textContent=calculated?`${sizeData.asOf.replace('-','년 ')}월 기준 · ${option.label} 환산 · 단위: ${unit}`:`${sizeData.asOf.replace('-','년 ')}월 기준 · 단위: ${unit}`;
  $('sizePriceChart').innerHTML=values.length?values.map(item=>`<div class="size-price-row" role="listitem" aria-label="${item.period} ${display(item.value)}${unit}"><span class="size-price-period">${item.period.replace('-','.')}</span><span class="size-price-track"><span class="size-price-bar" style="display:block;width:${Math.max(1,item.value/max*100)}%"></span></span><strong class="size-price-value">${display(item.value)}${unit}</strong></div>`).join(''):'<div class="empty">선택한 규모의 가격 자료가 없습니다.</div>';
  $('sizePricePanel').querySelector('.size-price-note').textContent=calculated?`R-ONE ${option.area}㎡ 환산값: ${option.area===59?'소형':'중소형'} 평균 단위면적 가격 × ${option.area}㎡. 해당 면적의 직접 집계값이 아니라 환산 추정값입니다.`:'최근 24개월 자료를 표시합니다. 면적 규모는 한국부동산원 분류를 따릅니다.';
 }
 function render(){
  $('annualSubtitle').textContent=`한국부동산원 발표일 ${formatReleaseDate()}`;$('priceMapSubtitle').textContent=`한국부동산원 발표일 ${formatReleaseDate()} · 단위: 억원`;
  $('mapRegionControls').hidden=view!=='map';$('metricToggle').hidden=view==='size';
  document.querySelectorAll('#mapRegionControls [data-region]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.region===mapRegion));button.onclick=()=>{mapRegion=button.dataset.region;saveState();render()}});
  document.querySelectorAll('[data-view]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.view===view));button.onclick=()=>{view=button.dataset.view;saveState();render()}});
  $('annualRegions').hidden=view!=='annual';$('annualPanel').hidden=view!=='annual';$('mapPanel').hidden=view!=='map';$('mapPeriodControls').hidden=view!=='map';renderPriceMap();renderSizePrice();
  const values=[...(data.regions[region]||[])].sort((a,b)=>b.year-a.year),byYear=new Map(values.map(item=>[Number(item.year),item]));$('regionHint').textContent=region;
  const chartTitle=$('chartTitle');chartTitle.replaceChildren(document.createTextNode('연도별 아파트 매매'));const chartMetric=document.createElement('span');chartMetric.className=`price-map-metric-word ${metric}`;chartMetric.textContent=metric==='median'?'중위':'평균';chartTitle.append(chartMetric,document.createTextNode(`가격 · ${region}`));
  $('regionChips').innerHTML=regions.map(item=>`<button type="button" class="chip${item===region?' on':''}" aria-pressed="${item===region}" data-region="${esc(item)}">${esc(item)}</button>`).join('');$('regionChips').querySelectorAll('[data-region]').forEach(button=>button.onclick=()=>{region=button.dataset.region;saveState();render()});
  $('metricToggle').querySelectorAll('[data-metric]').forEach(button=>{const selected=button.dataset.metric===metric;button.classList.toggle('on',selected);button.setAttribute('aria-pressed',String(selected));button.onclick=()=>{metric=button.dataset.metric;saveState();render()}});
  if(!values.length){$('chart').innerHTML='<div class="empty">선택한 지역의 가격 자료가 없습니다.</div>';return;}
  const max=Math.max(...values.map(item=>item[metric]));
  $('chart').innerHTML=values.map(item=>{const value=eok(item[metric]),previous=byYear.get(Number(item.year)-1),change=previous&&Number(previous[metric])?((Number(item[metric])-Number(previous[metric]))/Number(previous[metric]))*100:null,changeText=change===null?'<small class="year-change empty" aria-hidden="true"></small>':`<small class="year-change ${change>0?'up':change<0?'down':'flat'}">${change>0?'+':''}${change.toFixed(0)}%</small>`,changeAria=change===null?'':`, 전년 대비 ${change.toFixed(1)}퍼센트`;return`<div class="price-year" role="listitem" aria-label="${item.year}년 아파트 ${metric==='median'?'중위':'평균'}가격 ${value}억원${changeAria}"><div class="compare-row"><span class="compare-label">${item.year}년</span><span class="compare-track"><span class="compare-bar${metric==='median'?' median':''}" style="width:${Math.max(1,item[metric]/max*100)}%"></span></span>${changeText}<strong class="compare-value${metric==='median'?' median':''}">${value}억</strong></div></div>`}).join('');
 }
 async function loadOptionalSizeData(){try{const response=await fetch(`${rawBase}reb-apartment-size-prices.json?v=${Date.now()}`,{cache:'no-store'});if(response.ok)sizeData=await response.json();}catch{}}
 async function init(){
  try{
   const response=await fetch(`${rawBase}reb-apartment-prices.json?v=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw Error('data');data=await response.json();
   regions=['서울','경기','인천','부산'].filter(item=>Object.hasOwn(data.regions,item));if(!regions.length)throw Error('data');
   try{const saved=JSON.parse(sessionStorage.getItem(stateKey)||'null');if(regions.includes(saved?.region))region=saved.region;if(['all',...regions].includes(saved?.mapRegion))mapRegion=saved.mapRegion;if(['map','annual','size'].includes(saved?.view))view=saved.view;if(typeof saved?.sizeRegion==='string')sizeRegion=saved.sizeRegion;if(sizeOptions.some(option=>option.id===saved?.sizeClass))sizeClass=saved.sizeClass;}catch{}
   await loadOptionalSizeData();
   const sizeSource=sizeData?`<br>출처: <a href="${esc(sizeData.sourceUrl)}" target="_blank" rel="noopener">${esc(sizeData.source)}</a> · 기준 ${esc(sizeData.asOf)} · ${esc(sizeData.aggregation)} · 단위 ${esc(sizeData.unit)}`:'';
   $('source').innerHTML=`출처: <a href="${esc(data.sourceUrl)}" target="_blank" rel="noopener">${esc(data.source)}</a> · 발표일 ${esc(formatReleaseDate())} · ${esc(data.aggregation)}${sizeSource}`;
   $('loading').hidden=true;$('content').hidden=false;$('sharePage').onclick=async()=>{try{if(navigator.share)await navigator.share({title:document.title,url:location.href});else await navigator.clipboard.writeText(location.href)}catch{}};render();
  }catch(error){$('loading').hidden=false;$('loading').textContent='통계 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
 }
 init();
})();
