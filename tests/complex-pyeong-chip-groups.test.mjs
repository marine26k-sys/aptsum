import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({selPy:-1,complexPyLabel:row=>row.py});
vm.runInContext(html.slice(html.indexOf('function complexPyeongGroups('),html.indexOf('function pyTableHTML(')),context);

test('same displayed pyeong uses one chip and selects every underlying supply group',()=>{
  const data={byPy:[
    {py:'24평',sizeKey:61,groupKey:'61|79'},
    {py:'24평',sizeKey:61,groupKey:'61|82'},
    {py:'29평',sizeKey:75,groupKey:'75|96'},
  ]};
  assert.deepEqual([...context.complexPyeongGroups(data)].map(group=>[group.label,[...group.indexes]]),[
    ['24평',[0,1]],['29평',[2]],
  ]);
  context.selPy=0;
  assert.equal(context.selectedComplexRows(data).length,2);
  context.selPy=1;
  assert.equal(context.selectedComplexRows(data).length,2);
  context.selPy=2;
  assert.equal(context.selectedComplexRows(data).length,1);
});
