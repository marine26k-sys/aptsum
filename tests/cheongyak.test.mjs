import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kstToday,noticeStatus,filterNotices,officialURL,daysUntil} from '../shared/cheongyak.mjs';
import handler,{validData,updatedTime} from '../netlify/functions/cheongyak.mjs';
const item={name:'검증 공고',category:'apt',pblancNo:'1',region:'서울',apply_start:'2026-10-13',apply_end:'2026-10-14'};
test('active notices sort by newest publication date across open and upcoming states',()=>{
 const old={...item,pblancNo:'old',notice_date:'2026-10-01'};
 const upcoming={...item,pblancNo:'new',notice_date:'2026-10-12',apply_start:'2026-10-15',apply_end:'2026-10-16'};
 const unknown={...item,pblancNo:'missing',notice_date:'invalid'};
 assert.deepEqual(filterNotices([old,unknown,upcoming],{},'2026-10-13').map(x=>x.pblancNo),['new','old','missing']);
 const latest={...item,pblancNo:'later-deadline',notice_date:'2026-10-13',apply_end:'2026-10-20'};
 assert.deepEqual(filterNotices([latest,old],{status:'open'},'2026-10-13').map(x=>x.pblancNo),['old','later-deadline']);
});
test('malformed dates and detail tables do not replace the valid deployed dataset',()=>{
 assert(Number.isNaN(updatedTime({updated_at:'2026-02-31 06:30 KST'})));
 assert(Number.isNaN(updatedTime({updated_at:'2026-10-13 29:30 KST'})));
 assert.equal(validData({updated_at:'2026-10-13 06:30 KST',items:[{...item,units:{}}]}),false);
 assert.equal(validData({updated_at:'2026-10-13 06:30 KST',items:[{...item,schedule:[null]}]}),false);
});
test('KST midnight and closing day retain correct application status',()=>{
 assert.equal(kstToday(new Date('2026-10-12T15:00:00Z')),'2026-10-13');
 assert.equal(noticeStatus(item,'2026-10-12'),'upcoming');
 assert.equal(noticeStatus(item,'2026-10-14'),'open');
 assert.equal(noticeStatus(item,'2026-10-15'),'closed');
 assert.equal(noticeStatus({...item,apply_start:null,apply_end:null},'2026-10-13'),'unknown');
 assert.equal(daysUntil('2026-10-14','2026-10-13'),1);
});
test('combined filters and favorites use category-scoped notice identifiers',()=>{
 const other={...item,category:'remainder',region:'경기'};
 assert.deepEqual(filterNotices([item,other],{region:'서울',query:'검증공고'},'2026-10-13'),[item]);
 assert.deepEqual(filterNotices([item,other],{favoritesOnly:true,favorites:['remainder:1']},'2026-10-13'),[other]);
 assert.equal(filterNotices([item],{},'2026-10-15').length,0);
 assert.equal(filterNotices([{...item,category:'other'}],{status:'all'},'2026-10-13').length,0);
 assert.equal(officialURL('javascript:alert(1)'),null);
 assert.equal(officialURL('https://www.applyhome.co.kr.evil.test/'),null);
 assert.equal(officialURL('https://www.applyhome.co.kr/ai/aia/notice'), 'https://www.applyhome.co.kr/ai/aia/notice');
});
test('API prefers newer main data without redeploy and falls back when remote fails',async()=>{
 const oldFetch=globalThis.fetch;
 const local={updated_at:'2026-10-12 06:30 KST',items:[item]};
 const newer={updated_at:'2026-10-13 06:30 KST',items:[{...item,name:'최신 공고'},{...item,name:'제외 지역',region:'대구'},{...item,name:'제외 유형',category:'other'}]};
 try{
  globalThis.fetch=async url=>Response.json(url.includes('githubusercontent')?newer:local);
  let data=await (await handler(new Request('https://fixture.test/api/cheongyak'))).json();
  assert.equal(data.updated_at,newer.updated_at);assert.equal(data.count,1);assert.equal(data.items[0].name,'최신 공고');
  globalThis.fetch=async url=>{if(url.includes('githubusercontent'))throw Error('offline');return Response.json(local);};
  data=await (await handler(new Request('https://fixture.test/api/cheongyak'))).json();assert.equal(data.updated_at,local.updated_at);
  globalThis.fetch=async()=>Response.json({updated_at:newer.updated_at,items:[]});
  assert.equal((await handler(new Request('https://fixture.test/api/cheongyak'))).status,503);
 }finally{globalThis.fetch=oldFetch;}
});
test('stored notices contain only requested regions and safe official links',()=>{
 const data=JSON.parse(readFileSync(new URL('../data/cheongyak.json',import.meta.url)));
 assert.equal(data.count,data.items.length);assert(data.items.length>0);
 for(const row of data.items){assert(['서울','경기','인천','부산'].includes(row.region));assert(officialURL(row.detail_url));assert(!('score' in row));assert(['apt','remainder'].includes(row.category));}
});
