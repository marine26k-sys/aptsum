import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('native region restoration keeps date choices, consecutive decline, new-only and budget band',()=>{
 const controls={listingTrendUpload:{replaceChildren(...options){this.options=options;}},listingTrendContinuous:{checked:false},listingBudgetNewOnly:{checked:false}};
 const ctx=vm.createContext({document:{getElementById:id=>controls[id]},Option:class{constructor(label,value){this.textContent=label;this.value=value;}}});
 const start=html.indexOf('function restoreListingSelectionInputs(');vm.runInContext(html.slice(start,html.indexOf('function restoreView(',start)),ctx);
 ctx.restoreListingSelectionInputs({trendUpload:'u1',trendChoices:[{label:'10/5',value:'u2'},{label:'10/4',value:'u1'}],trendContinuous:true,budgetNewOnly:true,budgetBand:'30+'});
 assert.equal(ctx.listingTrendUploadId,'u1');assert.equal(controls.listingTrendUpload.value,'u1');assert.equal(controls.listingTrendUpload.options.length,2);assert.equal(controls.listingTrendContinuous.checked,true);assert.equal(controls.listingBudgetNewOnly.checked,true);assert.equal(ctx.listingBudgetSel,'30+');
});
test('cached subscriber results require current authorization while public trial results can return',()=>{
 let verified=false,full=false;
 const ctx=vm.createContext({needsSubscriberSession:m=>m==='subway',isListingMode:m=>m==='listingbudget',aptsumSubscriberGate:{isVerified:()=>verified,hasFullAccess:()=>full}});
 const start=html.indexOf('function canRestoreNativeRegionData(');vm.runInContext(html.slice(start,html.indexOf('function applyNativeRegionReturn(',start)),ctx);
 const listing={data:{},inputs:{mode:'listingbudget'},verified:true};assert.equal(ctx.canRestoreNativeRegionData(listing),false);
 assert.equal(ctx.canRestoreNativeRegionData({...listing,verified:false}),true);
 verified=true;assert.equal(ctx.canRestoreNativeRegionData(listing),true);
 assert.equal(ctx.canRestoreNativeRegionData({data:{},inputs:{mode:'subway'}}),false);
 full=true;assert.equal(ctx.canRestoreNativeRegionData({data:{},inputs:{mode:'subway'}}),true);
});
