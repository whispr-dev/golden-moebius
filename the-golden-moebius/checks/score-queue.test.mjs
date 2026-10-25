import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readQueue, writeQueue, addRun, MAX_AGE } from '../dist/west-bank/score-queue.js';
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};};
const run=(n,mode='classic',score=n*100)=>({ticket:'ticket-'+n,key:'a'.repeat(64),mode,score,ticks:100,actions:[[100,'q',0]],savedAt:1000});
test('unposted replays survive leaving the result screen and reloading',()=>{
  const local=storage();const entries=[run(1),run(2,'hard')];assert.equal(writeQueue(local,entries),true);assert.deepEqual(readQueue(local,1500),entries);
  assert.deepEqual(readQueue(local,1000+MAX_AGE+1),[]);
});
test('storage failures and malformed values do not break play',()=>{
  const blocked={getItem(){throw Error();},setItem(){throw Error();}};assert.deepEqual(readQueue(blocked),[]);assert.equal(writeQueue(blocked,[run(1)]),false);
  const local=storage();local.setItem('westbank.ranked.pending.v1','{}');assert.deepEqual(readQueue(local),[]);
});
test('queue avoids duplicates and preserves the best per difficulty when full',()=>{
  let queue=[run(1,'easy',9999),run(2,'hard',9999),run(3),run(4),run(5),run(6)];
  queue=addRun(queue,run(7));assert.equal(queue.length,6);assert.ok(queue.some(r=>r.mode==='easy'));assert.ok(queue.some(r=>r.mode==='hard'));assert.ok(queue.some(r=>r.ticket==='ticket-7'));
  assert.equal(addRun(queue,run(7)).length,6);
});
test('score entry and Done are inside the native fullscreen element',async()=>{
  const html=await readFile(new URL('../dist/west-bank/play.html',import.meta.url),'utf8');
  const playfield=html.slice(html.indexOf('<div class="playfield"'),html.indexOf('<div class="controls-panel"'));
  for(const id of ['score-form','score-name','score-submit','done','finish-run','finish-notice'])assert.ok(playfield.includes(`id="${id}"`),id+' must be visible in fullscreen');
  assert.equal((html.match(/id="score-form"/g)||[]).length,1);
});
