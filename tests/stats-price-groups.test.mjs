import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../stats.html',import.meta.url),'utf8');
test('금액별 탭은 선택한 금액의 신청만 표시한다',async()=>{
 const box={innerHTML:'',querySelectorAll:()=>[]},panel={innerHTML:''};
 const applications=[{id:'sample-mail',createdAt:0,price:9900,includesMail:true,delivered:true,status:'paid',email:'',phone:''},{id:'sample-listing',createdAt:0,price:4900,includesMail:false,status:'paid',email:'',phone:''}];
 let calls=0;
 const c=vm.createContext({esc:s=>String(s||''),appWhen:()=>'',appPhone:()=>'',fmtDay:()=>'',APP_STATE:{paid:['결제 완료','teal']},setCardBadge:()=>{},$:s=>s==='#appPricePanel'?panel:box,fetch:async()=>{calls++;return {ok:true,json:async()=>({applications,paymentEnabled:true})}}});
 vm.runInContext(html.slice(html.indexOf('const appHasMail ='),html.indexOf('function initApplications(')),c);
 await c.loadApplications();assert.match(box.innerHTML,/data-app-price="9900"/);assert.match(box.innerHTML,/data-app-price="4900"/);
 assert.match(panel.innerHTML,/sample-mail/);assert.doesNotMatch(panel.innerHTML,/sample-listing/);
 vm.runInContext('appPriceTab=4900;renderApplications(appCachedData)',c);
 assert.match(panel.innerHTML,/4,900원/);assert.doesNotMatch(panel.innerHTML,/9,900원/);assert.equal(calls,1);
 assert.equal((panel.innerHTML.match(/data-deliver=/g)||[]).length,0);
});
