import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const init=html.slice(html.indexOf('async function initFromURL('),html.indexOf('// 공유 링크는 접속한 주소'));
function entry(search,trial){
  const elements=new Map();
  const ctx=vm.createContext({
    URLSearchParams,location:{search},URL_MODES:['listingbudget'],
    needsSubscriberSession:()=>false,isListingMode:()=>true,isListingTrial:()=>trial,
    aptsumSubscriberGate:{ready:Promise.resolve()},setMode:()=>true,
    listingBudgetSel:'30-',listingNameSelected:null,listingNameRestoreKey:'',
    listingTrendUploadId:'',listingFloorScope:'mid',newHighWeekOnly:false,regionSel:[],pyBandMultiSel:[],
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',checked:false,dataset:{}});return elements.get(id);}},
    sel:{value:''},LISTING_TRIAL_LAWD:'11680',addRegion(){},
    resetQueriedSliderDefaults(){ctx.cleaned=true;},renderPyBandMultiBtn(){},
    analysisMonthsForMode:(_,v)=>v,normalizeListingOccupancy:()=> 'available',syncListingFloor(){},setBuildYearValue(){},lsSet(){},
    search(opts){ctx.searched=true;ctx.skipSave=opts?.skipSavedListingFilters;}
  });
  vm.runInContext(init,ctx);
  return ctx;
}
test('only a bare public budget tab starts at all prices without overwriting saved filters',async()=>{
  const guest=entry('?m=listingbudget',true);
  await guest.initFromURL();
  assert.equal(guest.cleaned,true);
  assert.equal(guest.listingBudgetSel,'all');
  assert.equal(guest.sel.value,'11680');
  assert.equal(guest.skipSave,true);
  const subscriber=entry('?m=listingbudget',false);
  await subscriber.initFromURL();
  assert.equal(subscriber.cleaned,undefined);
  assert.equal(subscriber.listingBudgetSel,'30-');
  assert.equal(subscriber.searched,undefined);
  for(const band of ['20-30','all']){
    const share=entry('?m=listingbudget&r=11680&lb='+band,true);
    await share.initFromURL();
    assert.equal(share.listingBudgetSel,band);
    assert.equal(share.searched,true);
    assert.equal(share.skipSave,undefined);
  }
  assert.ok(html.includes('if(isListingMode(mode)&&!opts?.skipSavedListingFilters)saveQueriedSliders();'));
});
