import test from 'node:test';
import assert from 'node:assert/strict';
class Element{
  constructor(){this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.listeners=new Map();this.children=[];}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  replaceChildren(...children){this.children=children;}
  setAttribute(){} append(child){this.children.push(child);} focus(){}
  async trigger(type){await this.listeners.get(type)?.({preventDefault(){}});}
}
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
globalThis.document={getElementById:el,querySelectorAll:()=>[],createElement:()=>new Element()};
const values=new Map();globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
globalThis.window={};window.parent=window;
let postFails=false,offline=false;
globalThis.fetch=async(url,options)=>{
  if(offline)throw Error('Connection refused');
  const data=url.endsWith('/run')?{ticket:'signed-ticket',seed:123}:url.endsWith('/score')?postFails?{error:'Scorekeeper temporarily unavailable. Please retry.'}:{ok:true,improved:true,score:500,best:500,mode:'classic',rank:1}:{mode:'classic',entries:[]};
  return {ok:!url.endsWith('/score')||!postFails,json:async()=>data};
};
const ui=await import('../dist/west-bank/leaderboard.js');
test('unavailable scorekeeper explicitly refuses a ranked start instead of pretending it is ranked',async()=>{
  offline=true;const run=await ui.beginRankedRun('classic');assert.equal(run.valid,false);assert.match(run.reason,/Connection refused/);assert.match(el('run-badge').textContent,/has not started/);offline=false;
});
test('practice and zero-score finishes give a visible reason on the result screen',()=>{
  ui.finishRankedRun({valid:false,reason:'Practice game.'},{score:500});assert.equal(el('finish-notice').hidden,false);assert.match(el('finish-notice').textContent,/cannot be posted/);
  ui.finishRankedRun(null,{score:0});assert.match(el('finish-notice').textContent,/scored \$0/);
});
test('finished ranked game opens name entry immediately, saves replay, survives retry, and clears only after successful posting',async()=>{
  const run=await ui.beginRankedRun('classic');assert.equal(run.valid,true);
  ui.finishRankedRun({...run,actions:[[300,'q',0]]},{score:500,tickCount:300});
  assert.equal(el('score-form').hidden,false);assert.match(el('score-result').textContent,/Enter your name/);assert.equal(ui.savedCount(),1);assert.ok(values.get('westbank.ranked.pending.v1').includes('signed-ticket'));
  ui.hideScoreEntry();assert.equal(el('score-form').hidden,true);assert.equal(ui.showScoreEntry(),true);
  el('score-name').value='Test sheriff';postFails=true;await el('score-form').trigger('submit');assert.match(el('score-feedback').textContent,/temporarily unavailable/);assert.equal(ui.savedCount(),1);assert.equal(el('score-submit').disabled,false);
  postFails=false;await el('score-form').trigger('submit');assert.match(el('score-feedback').textContent,/Posted!/);assert.equal(ui.savedCount(),0);assert.equal(el('score-submit').disabled,true);assert.equal(values.get('westbank.ranked.pending.v1'),'[]');
});
