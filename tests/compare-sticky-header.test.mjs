import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('floating compare header sits below the pinned card header and disappears outside the table',()=>{
 let tableBottom=600,headTop=-20,visible=true;
 const copy={style:{},querySelectorAll:()=>[]},floating={hidden:true,style:{},firstElementChild:copy,scrollLeft:0};
 const wrapper={clientWidth:320,scrollLeft:120,getBoundingClientRect:()=>({left:15,bottom:tableBottom})};
 const table={style:{width:'600px'},parentElement:wrapper,getBoundingClientRect:()=>({width:600}),closest:()=>({querySelector:()=>({getBoundingClientRect:()=>({top:0,bottom:140})})}),querySelector:()=>({getBoundingClientRect:()=>({top:headTop,height:40})}),querySelectorAll:()=>[]};
 const c=vm.createContext({document:{querySelector:()=>visible?table:null,getElementById:()=>floating}});
 vm.runInContext(html.slice(html.indexOf('function syncCompareSummarySticky('),html.indexOf('function compareSummaryHTML(')),c);c.syncCompareSummarySticky.source=table;
 c.syncCompareSummarySticky();assert.equal(floating.hidden,false);assert.equal(floating.style.top,'140px');assert.equal(floating.scrollLeft,120);
 headTop=145;c.syncCompareSummarySticky();assert.equal(floating.hidden,true);
 headTop=-20;tableBottom=170;c.syncCompareSummarySticky();assert.equal(floating.hidden,true);
 tableBottom=600;visible=false;c.syncCompareSummarySticky();assert.equal(floating.hidden,true);
});
