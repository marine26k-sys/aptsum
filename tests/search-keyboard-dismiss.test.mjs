import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('검색 시 이름 입력 포커스를 해제하며 다른 필터 포커스는 건드리지 않는다',()=>{
 let blurred=0;const active={matches:()=>true,blur(){blurred++}};
 const c=vm.createContext({document:{activeElement:active}});
 vm.runInContext(html.slice(html.indexOf('function dismissSearchKeyboard('),html.indexOf('async function search(opts)')),c);
 c.dismissSearchKeyboard();assert.equal(blurred,1);active.matches=()=>false;c.dismissSearchKeyboard();assert.equal(blurred,1);
});
test('검색 후보 표시 경로는 입력창에 다시 포커스하지 않는다',()=>{
 let focused=0;const c=vm.createContext({document:{getElementById:()=>({style:{},focus(){focused++}})}});
 vm.runInContext(html.slice(html.indexOf('function openListingNameSearch('),html.indexOf('function clearListingNameSearch(')),c);
 c.openListingNameSearch(false);assert.equal(focused,0);c.openListingNameSearch();assert.equal(focused,1);
});
