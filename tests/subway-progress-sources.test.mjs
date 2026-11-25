import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const data=JSON.parse(readFileSync(new URL('../data/subway-lines.json',import.meta.url),'utf8'));

test('every displayed rail line has a dated official progress source',()=>{
  assert.equal(data.lines.length,14);
  for(const line of data.lines){
    assert.equal(line.checkedAt,data.meta.updated,`${line.id}: review date`);
    assert.ok(line.stage&&line.target&&line.summary,`${line.id}: progress text`);
    assert.match(line.sourceUrl,/^https:\/\//,`${line.id}: source URL`);
    assert.ok(line.sourceLabel,`${line.id}: source label`);
    if(line.sourceExtraUrl){
      assert.match(line.sourceExtraUrl,/^https:\/\//,`${line.id}: second source URL`);
      assert.ok(line.sourceExtraLabel,`${line.id}: second source label`);
    }
    if(line.sourceStationUrl){
      assert.match(line.sourceStationUrl,/^https:\/\//,`${line.id}: station source URL`);
      assert.ok(line.sourceStationLabel,`${line.id}: station source label`);
    }
  }
});

test('Cheongna extension includes the separately approved eighth station',()=>{
  const line=data.lines.find(line=>line.id==='line7-cheongna');
  assert.equal(line.stations.length,8);
  const added=line.stations.find(station=>station.name.includes('005-1'));
  assert.ok(added);
  assert.equal(added.status,'미개통');
  assert.equal(line.stations.at(-2),added);
});
