const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const script = html.match(/<!-- MAIN GAME SCRIPT -->\s*<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
function element(id = '') {
  const node = { id, value: '', children: [], disabled: false, classList: {add(){},remove(){}},
    appendChild(child){this.children.push(child);}, addEventListener(){},
    getContext(){return new Proxy({}, {get: (o,k)=>o[k]||(()=>{}),set: (o,k,v)=>(o[k]=v,true)});},
    getBoundingClientRect(){return {left:0,top:0,width:480,height:240};}
  };
  let content='';
  Object.defineProperty(node,'innerHTML',{get:()=>content,set(text){content=text;this.children=[];for(const match of text.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const n=element(match[1]);n.value=match[0].match(/\bvalue="([^"]*)"/)?.[1]||'';nodes.set(n.id,n);}}});
  return node;
}
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);},createElement:()=>element()};
const context=vm.createContext({document,console,setTimeout:()=>0,requestAnimationFrame:()=>0,localStorage:{getItem:()=>null,setItem(){}},window:{}});
vm.runInContext(script,context,{filename:file});
const run=code=>vm.runInContext(code,context);
run('audio.enabled=false;');
assert.match(document.getElementById('gameView').innerHTML,/STEP 1: CHOOSE YOUR ARCHETYPE/);
run("document.getElementById('btnConfirmParty').onclick()");
assert.equal(run('gameState.party.length'),5);
assert.match(document.getElementById('gameView').innerHTML,/GENERAL STORE/);
run("document.getElementById('btnCheckout').onclick()");
assert.equal(run('gameState.supplies.oxen'),6);
assert.match(document.getElementById('gameView').innerHTML,/TRAIL STATUS/);
let cases=1;
const setup=`gameState=createInitialGameState(); gameState.party=[{name:'Alive A',health:100,status:'Good'},{name:'Alive B',health:100,status:'Good'},{name:'Dead',health:0,status:'DEAD'}]; gameState.supplies.oxen=6; gameState.supplies.food=5000;`;
const count=run('RANDOM_EVENTS.length');assert.equal(count,11);
for(let index=0;index<count;index++)for(const stocked of [false,true]){
  run(setup+`gameState.supplies.medicine=${stocked?2:0};gameState.supplies.parts=${stocked?2:0};Math.random=()=>${(index+.1)/count};triggerRandomEvent();`);
  assert.equal(run('gameState.gameOver'),false);
  assert.ok(run('gameState.party.every(p=>p.health>=0&&p.health<=100)'));
  assert.equal(run('gameState.party[2].health'),0);
  assert.equal(run('gameState.party[2].status'),'DEAD');
  if(index<4)assert.ok(run('gameState.party[0].health<100||gameState.party[1].health<100'));
  if([9,10].includes(index)){
    assert.equal(run('gameState.party[0].health'),stocked?100:75);
    assert.equal(run('gameState.supplies.medicine'),stocked?1:0);
  }
  if([4,8].includes(index))assert.equal(run('gameState.wagonHealth'),stocked?100:70);
  cases++;
}
// Each lethal event clamps HP, marks the death once and ends the run immediately.
for(const index of [0,1,2,3,7,8,9,10]){
  run(setup+`gameState.party=[{name:'Last survivor',health:1,status:'Poor'}];Math.random=()=>${(index+.1)/count};triggerRandomEvent();`);
  assert.equal(run('gameState.gameOver'),true);
  assert.equal(run('gameState.party[0].health'),0);
  assert.equal(run('gameState.party[0].status'),'DEAD');
  assert.match(document.getElementById('gameView').innerHTML,/GAME OVER/);
  const before=document.getElementById('eventLog').children.length;
  run('triggerRandomEvent();');assert.equal(document.getElementById('eventLog').children.length,before);
  cases++;
}
// A party wipe during advanceTrail must retain the game-over screen.
run(setup+`gameState.party=[{name:'Last survivor',health:1,status:'Poor'}];let rolls=[.5,0,10.1/11,0];Math.random=()=>rolls.shift()??.5;advanceTrail();`);
assert.equal(run('gameState.gameOver'),true);
assert.match(document.getElementById('gameView').innerHTML,/GAME OVER/);cases++;
// Both retry routes must clear all expedition state, not merely redraw setup.
for(const victory of [false,true]){
  run(setup+`gameState.distance=1900;gameState.date=new Date(1849,10,10);gameState.gameOver=${!victory};gameState.victorious=${victory};showCharacterSelect();`);
  assert.equal(run('gameState.distance'),0);assert.equal(run('gameState.party.length'),0);
  assert.equal(run('gameState.gameOver'),false);assert.equal(run('gameState.victorious'),false);
  assert.equal(run('gameState.date.getMonth()'),3);assert.equal(run('gameState.date.getDate()'),1);
  run("document.getElementById('btnConfirmParty').onclick();document.getElementById('btnCheckout').onclick();Math.random=()=>.5;advanceTrail();");
  assert.ok(run('gameState.distance>0'));cases++;
}
run(setup+'gameState.party=[];triggerRandomEvent();');assert.equal(run('gameState.gameOver'),true);cases++;
console.log(`PASS: ${cases} scenarios; startup, checkout, all ${count} events with/without supplies, lethal events, travel screen preservation and fresh retries.`);
