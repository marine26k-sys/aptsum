import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup({lastData=null,regionSel=[{lawd:'11680',name:'강남구'}],value='ALL:서울',individual=false}={}){
 const elements={},calls=[];const get=id=>elements[id] ||= {value:'old',min:1,max:10,disabled:true,classList:{remove(){}},replaceChildren(){}};
 const c=vm.createContext({mode:'listingbudget',lastData,regionSel,sel:{value},LS_FACETS:{ask:{ids:['min','max']}},localStorage:{removeItem(){}},queriedSliderKey:m=>m,document:{getElementById:get},listingNameSelected:{lawd:'41173'},listingNameRestoreKey:'41173',listingNameChoices:[{}],listingFloorScope:'all',syncListingFloor(){},listingGapSet(){},syncAnalysisSelectSliders(){},lsSync(){},isIndividualListing:()=>individual,search:opts=>calls.push({regions:regionSel.map(x=>x.lawd),value,opts})});
 vm.runInContext(html.slice(html.indexOf('function resetListingFilters(){'),html.indexOf('function lsSavedLimits(')),c);return {c,calls,elements};
}
test('reset requeries the currently selected region even when native region return has no restored result',()=>{
 const {c,calls,elements}=setup();c.resetListingFilters();assert.equal(calls.length,1);assert.equal(calls[0].value,'ALL:서울');assert.deepEqual(calls[0].regions,['11680']);assert.equal(elements.listingNameQuery.value,'');assert.equal(c.listingNameSelected,null);
});
test('old Anyang result never determines reset search scope after Seoul is selected',()=>{
 const {c,calls}=setup({lastData:{mode:'listingbudget',scopeLabel:'안양시'}});c.resetListingFilters();assert.equal(calls.length,1);assert.equal(calls[0].value,'ALL:서울');
});
test('reset without a region or in individual listing analysis does not launch an incomplete search',()=>{
 for(const options of [{regionSel:[],value:''},{individual:true}]){const {c,calls}=setup(options);c.resetListingFilters();assert.equal(calls.length,0);}
});

test('all listing analysis tabs refresh the selected region when filters reset',()=>{
 for(const mode of ['listingbudget','listingurgent','listingtrend','listingrise','longpeaklisting','listinggap']){
  const {c,calls}=setup();c.mode=mode;c.resetListingFilters();assert.equal(calls.length,1,mode);assert.equal(calls[0].value,'ALL:서울');
 }
});
test('MOLIT ranking tabs refresh current region while incomplete complex forms clear stale results',()=>{
 for(const mode of ['region','volume','gap','newhigh','newlow','pyprice','longtermrise','jeonselongtermrise','shortval','peak','longpeak','longpeakdong','inversion','subway']){
  const {c,calls}=setup();c.mode=mode;c.refreshAfterFilterReset();assert.equal(calls.length,1,mode);
 }
 const {c,calls,elements}=setup();c.mode='complex';c.document.getElementById('q').value='';c.document.getElementById('result').innerHTML='old Anyang results';c.refreshAfterFilterReset();assert.equal(calls.length,0);assert.equal(elements.result.innerHTML,'');
 c.document.getElementById('q').value='가상단지';c.refreshAfterFilterReset();assert.equal(calls.length,1);
});
test('comparison and price-band resets require their own complete inputs',()=>{
 const {c,calls}=setup();c.mode='compare';c.document.querySelectorAll=()=>[];c.refreshAfterFilterReset();assert.equal(calls.length,0);
 c.document.querySelectorAll=()=>['A단지','B단지'].map(value=>({querySelector:selector=>({value:selector==='input'?value:'11680'})}));c.refreshAfterFilterReset();assert.equal(calls.length,1);
 c.mode='pricebandrise';c.document.getElementById('priceBandPeriodN').value='12';c.document.getElementById('priceBandN').value='';c.refreshAfterFilterReset();assert.equal(calls.length,1);
 c.document.getElementById('priceBandN').value='0';c.refreshAfterFilterReset();assert.equal(calls.length,2);
});
