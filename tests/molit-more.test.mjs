import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('더 보기는 전체 결과를 보존하고 100개씩 추가하며 마지막에는 사라진다',()=>{
 let button;const element={appendChild:b=>button=b};
 const c=vm.createContext({document:{createElement:()=>({style:{}}),getElementById:()=>element}});
 vm.runInContext(html.slice(html.indexOf('const molitPageCounts'),html.indexOf('function renderRegion(')),c);
 const source={rows:Array.from({length:225},(_,i)=>i)};
 let view;const render=d=>{button=null;view=c.molitPageData(d,'rows',render);c.appendMolitMore(view);};
 render(source);assert.equal(view.rows.length,100);assert.equal(source.rows.length,225);
 button.onclick();assert.equal(view.rows.length,200);
 button.onclick();assert.equal(view.rows.length,225);assert.equal(button,null);
 render(source);assert.equal(view.rows.length,225);
 render({rows:[1,2]});assert.equal(view.rows.length,2);assert.equal(button,null);
});
