import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('short-term trend labels zero and negative zero as neutral flat while keeping rise and fall markers',()=>{
 const c=vm.createContext({selPy:-1,esc:String});vm.runInContext(html.slice(html.indexOf('function trendHTML('),html.indexOf('function chartTarget(')),c);
 const render=pct=>c.trendHTML({byPy:[{py:'28평',sizeKey:68,trend:{pct,prevAvg:11.5,recentAvg:11.5}}]});
 for(const pct of [0,-0]){assert.match(render(pct),/class="pct rng">보합<\/span>/);assert.doesNotMatch(render(pct),/0%|pct up|pct down/);}
 assert.match(render(5),/pct up">▲5%/);assert.match(render(-5),/pct down">▼5%/);
});
