import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function handleAnalysisBack('),html.indexOf("window.addEventListener('popstate'"));
function run(mode,individual=false,vi=0){
 const calls=[];
 const timers=[];
 const context=vm.createContext({mode,isIndividualListing:()=>individual,analysisPopstateSequence:0,setTimeout:fn=>timers.push(fn),location:{href:'https://example.test/?m='+mode},history:{state:{vi},back:()=>calls.push('back')}});
 vm.runInContext(source,context);
 const prevented=[];
 context.handleAnalysisBack({preventDefault:()=>prevented.push(true)});
 return {context,calls,prevented,timers};
}

test('일반 금액대별 실매물의 뒤로가기는 탭 선택 화면으로 나간다',()=>{
 const {context,calls,prevented}=run('listingbudget',false,3);
 assert.equal(context.location.href,'./index.html');
 assert.deepEqual(calls,[]);
 assert.deepEqual(prevented,[true]);
});

test('개별 단지 호가 화면의 뒤로가기는 검색 기록을 건너뛰고 탭 선택 화면으로 나간다',()=>{
 const {context,calls}=run('listingbudget',true,3);
 assert.equal(context.location.href,'./index.html');
 assert.deepEqual(calls,[]);
});

test('지역 선택창을 닫는 popstate는 뒤로가기 실패로 오인하지 않는다',()=>{
 const {context,timers}=run('region',false,3);
 context.history.state={vi:3,modal:'region'};
 context.handleAnalysisBack({preventDefault(){}});
 context.history.state={vi:3};
 context.analysisPopstateSequence++;
 timers[0]();
 assert.equal(context.location.href,'https://example.test/?m=region');
});

test('뒤로가기 요청을 무시한 브라우저는 탭 선택 화면으로 복귀시킨다',()=>{
 const {context,timers}=run('region',false,3);
 context.handleAnalysisBack({preventDefault(){}});
 timers[0]();
 assert.equal(context.location.href,'./index.html');
});
