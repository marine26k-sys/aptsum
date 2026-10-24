import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const complex=(lawd,name='가상단지',umd='가상동')=>({lawd,name,umd,pys:[{area:59,py:'25평',n:2},{area:84,py:'34평',n:10}]});
const data={mode:'compare',complexes:[complex('11111'),complex('22222')]};
function page(storage=new Map(),href='https://example.test/?m=compare'){
 const url=new URL(href),c=vm.createContext({URL,URLSearchParams,location:{href:url.href,search:url.search,pathname:url.pathname},lastData:data,document:{getElementById:()=>null},mode:'compare',viewStack:[{inputs:{mode:'compare'}}],draws:0,drawCompare(){c.draws++;},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 c.history={state:{vi:0},replaceState(state,_title,path){const u=new URL(path,c.location.href);c.location={href:u.href,search:u.search,pathname:u.pathname};}};
 vm.runInContext(html.slice(html.indexOf('let cmpPyMap ='),html.indexOf('let curMultiChart =')),c);
 vm.runInContext(html.slice(html.indexOf('function selectCmpPyFor('),html.indexOf('function renderCompare(')),c);
 vm.runInContext('cmpPyMap=restoreCmpAreas(lastData)',c);
 return c;
}
test('selection survives reload through storage and through share URL on another browser',()=>{
 const storage=new Map(),c=page(storage);c.selectCmpPyFor(0,'59');
 assert.equal(c.draws,1);assert.equal(c.viewStack[0].inputs.cmpAreas[c.cmpAreaKey(data.complexes[0])],59);
 const fresh=page(storage);assert.equal(fresh.restoreCmpAreas(data)[0],59);
 const shared=page(new Map(),c.location.href);assert.equal(shared.restoreCmpAreas(data)[0],59);
 assert.equal(shared.restoreCmpAreas(data)[1],84);
});
test('preferences follow complex identity when order changes and do not leak between identical names in different regions',()=>{
 const storage=new Map(),c=page(storage);c.selectCmpPyFor(0,59);
 const restored=page(storage),reordered={...data,complexes:[...data.complexes].reverse()};
 assert.equal(restored.restoreCmpAreas(reordered)[1],59);assert.equal(restored.restoreCmpAreas(reordered)[0],84);
});
test('URL and history selections override browser preferences, and unavailable areas safely fall back',()=>{
 const storage=new Map(),c=page(storage);c.selectCmpPyFor(0,59);const key=c.cmpAreaKey(data.complexes[0]);
 const url=new URL(c.location.href);url.searchParams.set('ca',JSON.stringify({[key]:84}));
 const linked=page(storage,url.href);assert.equal(linked.restoreCmpAreas(data)[0],84);
 assert.equal(linked.restoreCmpAreas(data,{[key]:59})[0],59);
 const changed={...data,complexes:[{...data.complexes[0],pys:[{area:84,py:'34평',n:5}]}]};assert.equal(page(storage).restoreCmpAreas(changed)[0],84);
 assert.doesNotThrow(()=>c.selectCmpPyFor(99,59));assert.equal(c.draws,1);
});
test('malformed preferences are ignored and share builder retains selected areas',()=>{
 const c=page();assert.deepEqual(Object.keys(c.parseCmpAreas('{invalid')),[]);assert.deepEqual(Object.keys(c.parseCmpAreas(JSON.stringify({bad:59}))),[]);
 vm.runInContext(html.slice(html.indexOf('function buildShareURL('),html.indexOf('function parseCmpShareItems(')),c);
 const areas={[c.cmpAreaKey(data.complexes[0])]:59};
 const url=c.buildShareURL({mode:'compare',mN:36,fM:0,cmp:[{lawd:'ALL:서울',name:'가상단지'}],cmpAreas:areas});
 assert.deepEqual(JSON.parse(new URL(url,'https://example.test').searchParams.get('ca')),areas);
});

test('recent comparison complexes persist up to five distinct entries with selected areas',()=>{
 const storage=new Map(),c=page(storage);c.selectCmpPyFor(0,59);
 assert.equal(c.getRecentCompareComplexes()[0].area,59);
 const more={mode:'compare',complexes:['33333','44444','55555','66666'].map(code=>complex(code))};
 c.rememberRecentCompareComplexes(more);assert.equal(c.getRecentCompareComplexes().length,5);
 const restored=page(storage);assert.equal(restored.getRecentCompareComplexes().length,5);
 restored.rememberRecentCompareComplexes({mode:'compare',complexes:[complex('11111')]});
 assert.equal(restored.getRecentCompareComplexes().filter(x=>x.lawd==='11111').length,1);
});
test('recent complex fills an empty compare row and restores area without overwriting four filled rows',()=>{
 const c=page(),rows=[];
 const makeRow=(name='')=>{const input={value:name,dataset:{},focus(){}},select={value:''};return{input,select,querySelector:q=>q==='input'?input:select};};
 rows.push(makeRow('다른 단지'),makeRow());
 c.document={getElementById:()=>null,querySelectorAll:()=>rows};c.setCmpRowLawd=(r,v)=>r.select.value=v;c.addCmpRow=()=>rows.push(makeRow());c.isAllScope=()=>false;c.showError=message=>{c.error=message;};
 const recent={...data.complexes[0],area:59};c.addRecentCompareComplex(recent);
 assert.equal(rows[0].input.value,'다른 단지');assert.equal(rows[1].input.value,'가상단지 [가상동]');assert.equal(rows[1].select.value,'11111');
 assert.equal(c.savedCmpAreas()[c.cmpAreaKey(recent)],59);c.addRecentCompareComplex(recent);assert.equal(rows.length,2);
 rows.push(makeRow('세번째'),makeRow('네번째'));c.addRecentCompareComplex({...recent,name:'새 단지'});
 assert.match(c.error,/최대 4개/);assert.equal(rows.length,4);assert.equal(rows[3].input.value,'네번째');
});
