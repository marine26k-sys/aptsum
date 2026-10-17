import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('초기 탭과 인증 복원이 끝나기 전에는 기본 화면 가림을 해제하지 않는다',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),removed=[];
 const c=vm.createContext({nativeRegionDocument:false,readNativeRegion:()=>null,NATIVE_REGION_RESULT:'test',initFromURL:()=>pending,document:{documentElement:{classList:{remove(...names){removed.push(...names)}}}}});
 vm.runInContext(html.slice(html.indexOf('async function initializeAptsumPage('),html.indexOf("window.addEventListener('pageshow'")),c);
 const task=c.initializeAptsumPage();await Promise.resolve();assert.equal(removed.length,0);
 release();await task;assert.ok(removed.includes('analysis-view-loading'));
});
test('초기 탭 복원 오류도 화면을 영구히 숨기지 않는다',async()=>{
 const removed=[];const c=vm.createContext({nativeRegionDocument:false,readNativeRegion:()=>null,NATIVE_REGION_RESULT:'test',initFromURL:async()=>{throw Error('synthetic')},document:{documentElement:{classList:{remove(...names){removed.push(...names)}}}}});
 vm.runInContext(html.slice(html.indexOf('async function initializeAptsumPage('),html.indexOf("window.addEventListener('pageshow'")),c);
 await assert.rejects(c.initializeAptsumPage());assert.ok(removed.includes('analysis-view-loading'));
});
