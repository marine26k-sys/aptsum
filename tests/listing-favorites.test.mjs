import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const c=vm.createContext({NAVER_NAMES:{'11680':{'옛이름|동':'새이름'}}});
vm.runInContext(html.slice(html.indexOf('function listingFavoriteRows('),html.indexOf('async function searchListingFavorites(')),c);
test('favorites match exact normalized or verified names within region, never partial names',()=>{
 const f={lawd:'11680',name:'옛 이름'};
 const rows=[{apt:'새이름',nid:'1',ex:84,ask:10},{apt:'새이름',nid:'1',ex:59,ask:8},{apt:'옛이름2차',nid:'2',ex:84,ask:11}];
 const out=c.listingFavoriteRows(f,rows);
 assert.equal(out.ambiguous,false);assert.deepEqual(Array.from(out.rows,x=>x.ex),[59,84]);
 assert.equal(c.listingFavoriteRows({...f,lawd:'11110'},rows).rows.length,0);
});
test('same names with multiple complex ids are ambiguous and missing prices stay empty',()=>{
 const f={lawd:'11680',name:'단지'};
 assert.equal(c.listingFavoriteRows(f,[{apt:'단지',nid:1,ask:10},{apt:'단지',nid:2,ask:11}]).ambiguous,true);
 assert.equal(c.listingFavoriteRows(f,[{apt:'단지아파트',nid:1,ask:0}]).rows.length,0);
});
