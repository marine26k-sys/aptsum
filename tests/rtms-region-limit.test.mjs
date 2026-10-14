import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function context(mode){const ctx=vm.createContext({mode,REGION_MAX:47,REGION_MAX_RANK:47});const a=html.indexOf('function isListingMode(');vm.runInContext(html.slice(a,html.indexOf('\n',a)),ctx);const b=html.indexOf('function regionSelMax(');vm.runInContext(html.slice(b,html.indexOf('function saveRegionSel(',b)),ctx);return ctx;}
test('every real-trade tab including weekly new highs caps selections at the 47-district Gyeonggi size',()=>{
 for(const mode of ['complex','compare','region','volume','updown','newhigh','newlow','pyprice','shortval','peak','longpeak','longpeakdong','pricebandrise','longtermrise','jeonselongtermrise','inversion','subway'])assert.equal(context(mode).regionSelMax(),47,mode);
 for(const mode of ['longpeaklisting','listingbudget','listingurgent','listingtrend','listinggap'])assert.equal(context(mode).regionSelMax(),47,mode);
});
test('an over-limit full-scope selection cannot start a real-trade query',()=>{
 const ctx=context('region');ctx.multiTargets=Array.from({length:48});ctx.showError=m=>ctx.message=m;ctx.started=false;
 const a=html.indexOf('  if(multiTargets.length > regionSelMax())');const b=html.indexOf('  let complexLookup=',a);
 vm.runInContext('(function(){'+html.slice(a,b)+'globalThis.started=true;})()',ctx);
 assert.equal(ctx.started,false);assert.match(ctx.message,/최대 47개/);
 ctx.multiTargets=Array.from({length:47});vm.runInContext('(function(){'+html.slice(a,b)+'globalThis.started=true;})()',ctx);assert.equal(ctx.started,true);
});
