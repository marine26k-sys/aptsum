import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function handleAnalysisBack('),html.indexOf("window.addEventListener('popstate'"));
function run(mode,individual=false,vi=0){
 const calls=[];
 const context=vm.createContext({mode,isIndividualListing:()=>individual,location:{href:''},history:{state:{vi},back:()=>calls.push('back')}});
 vm.runInContext(source,context);
 const prevented=[];
 context.handleAnalysisBack({preventDefault:()=>prevented.push(true)});
 return {context,calls,prevented};
}

test('일반 금액대별 실매물의 뒤로가기는 탭 선택 화면으로 나간다',()=>{
 const {context,calls,prevented}=run('listingbudget',false,3);
 assert.equal(context.location.href,'./index.html');
 assert.deepEqual(calls,[]);
 assert.deepEqual(prevented,[true]);
});

test('단지 상세 화면은 이전 조회 위치를 복원한다',()=>{
 const {context,calls}=run('listingbudget',true,3);
 assert.equal(context.location.href,'');
 assert.deepEqual(calls,['back']);
});
