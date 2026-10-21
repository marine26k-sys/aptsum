import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup({lastData=null,regionSel=[{lawd:'11680',name:'강남구'}],value='ALL:서울',individual=false}={}){
 const elements={},calls=[];const get=id=>elements[id] ||= {value:'old',min:1,max:10,disabled:true,replaceChildren(){}};
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
