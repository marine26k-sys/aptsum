import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function handleAnalysisBack('),html.indexOf("window.addEventListener('popstate'"));
function run(mode,individual=false,vi=0){
 const calls=[];
 const context=vm.createContext({mode,isIndividualListing:()=>individual,
  document:{getElementById:()=>({classList:{contains:()=>false}})},
  location:{href:'https://example.test/?m='+mode},history:{state:{vi},back:()=>calls.push('back')}});
 vm.runInContext(source,context);
 const prevented=[];
 context.handleAnalysisBack({preventDefault:()=>prevented.push(true)});
 return {context,calls,prevented};
}

test('상단 화살표는 모든 탭에서 조회 이력과 무관하게 탭 선택 화면으로 나간다',()=>{
 for(const mode of ['complex','compare','region','volume','listingbudget','listingurgent','listingtrend','listinggap','peak']){
  const {context,calls,prevented}=run(mode,mode==='listingbudget',7);
  assert.equal(context.location.href,'./index.html',mode);
  assert.deepEqual(calls,[],mode);
  assert.deepEqual(prevented,[true],mode);
 }
});
