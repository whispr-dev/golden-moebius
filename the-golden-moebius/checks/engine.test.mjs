import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, HZ, MODES, LAST_STAGE } from '../dist/west-bank/engine.js';

function fresh(mode='classic',seed=42){const g=new Game({mode,seed});g.start();g.nextSpawn=10000;return g;}
function ticks(g,n){for(let i=0;i<n;i++)g.tick();}
function reveal(g,lane,kind,overrides={}){const d=g.spawn(lane,kind,overrides);ticks(g,12);return d;}

test('fixed tick timing and reproducible random sequence',()=>{
  assert.equal(HZ,50);
  const a=fresh(),b=fresh();
  assert.deepEqual(Array.from({length:100},()=>a.random()),Array.from({length:100},()=>b.random()));
  assert.notEqual(fresh('classic',11).random(),fresh('classic',12).random());
  const g=fresh();const before=g.time;ticks(g,50);assert.equal(g.time,before-50);
});
test('pause freezes encounters, lives, clock and cooldown',()=>{
  const g=fresh();reveal(g,0,'outlaw');g.paused=true;
  const state=JSON.stringify(g);ticks(g,500);g.shoot(0);g.move(1);assert.equal(JSON.stringify(g),state);
});
test('customer deposits automatically and shooting an innocent costs exactly one life',()=>{
  const g=fresh();reveal(g,0,'farmer');ticks(g,85);assert.equal(g.score,100);assert.equal(g.deposits[0],true);
  const h=fresh();reveal(h,0,'lady');h.shoot(0);assert.equal(h.lives,2);assert.equal(h.score,0);
  h.shoot(1);h.shoot(2);assert.equal(h.lives,2,'recovery prevents multiple losses from simultaneous shots');
});
test('unarmed gunmen punish early shots; armed gunmen can be hit at the deadline boundary',()=>{
  const early=fresh();reveal(early,0,'draw',{wait:40});early.shoot(0);assert.equal(early.lives,2);
  const g=fresh();const d=reveal(g,0,'draw',{wait:20,window:35});ticks(g,20);assert.equal(d.phase,'armed');
  ticks(g,34);assert.equal(g.lives,3);assert.equal(g.shoot(0),true);assert.equal(g.lives,3);assert.equal(g.bestReaction,680);
  const late=fresh();reveal(late,0,'draw',{wait:20,window:35});ticks(late,55);assert.equal(late.lives,2);
});
test('immediate outlaws and quickdraw are shootable on reveal',()=>{
  for(const kind of ['outlaw','quickdraw']){const g=fresh();const d=reveal(g,1,kind);assert.equal(d.phase,'armed');assert.equal(g.shoot(1),true);assert.ok(g.score>=150);}
});
test('five hats must be removed; gold is collected; bomb must be left alone',()=>{
  for(const reward of ['gold','bomb']){
    const g=fresh();const d=reveal(g,0,'hats',{reward});
    for(let i=0;i<5;i++){assert.equal(g.shoot(0),true);ticks(g,5);}
    assert.equal(d.hats,0);assert.equal(d.phase,'reward');assert.equal(g.score,50);
    g.shoot(0);
    if(reward==='gold'){assert.equal(g.score,300);assert.equal(g.deposits[0],true);assert.equal(g.lives,3);}
    else{assert.equal(g.score,50);assert.equal(g.lives,2);}
  }
  const g=fresh();const d=reveal(g,1,'hats',{reward:'bomb'});
  for(let i=0;i<5;i++){g.shoot(1);ticks(g,5);}ticks(g,150);assert.equal(g.lives,3);assert.equal(g.doors[1],null);
});
test('dandy can bank gold or draw a gun, with the corresponding judgement',()=>{
  const customer=fresh();reveal(customer,0,'dandy',{harmless:true});ticks(customer,85);assert.equal(customer.deposits[0],true);
  const hostile=fresh();const d=reveal(hostile,0,'dandy',{harmless:false,wait:10});ticks(hostile,10);assert.equal(d.phase,'armed');assert.equal(hostile.shoot(0),true);
});
test('cannot move through open doors or beyond the bank, but can move while closed',()=>{
  const g=fresh();assert.equal(g.move(-1),false);assert.equal(g.move(1),true);assert.equal(g.group,1);
  g.spawn(0,'farmer');assert.equal(g.move(1),false);g.doors.fill(null);assert.equal(g.move(1),true);assert.equal(g.move(1),false);assert.equal(g.group,2);
});
test('completed sections stop spawning and missing deposits are guaranteed',()=>{
  const g=fresh();g.deposits.fill(true,0,3);g.nextSpawn=0;ticks(g,500);assert.ok(g.doors.every(d=>d===null));
  const h=fresh();for(let i=0;i<10;i++)h.chooseKind(1);assert.ok(['farmer','lady'].includes(h.chooseKind(1)));
});
test('duel early shots lose a life; recovery restarts the duel safely',()=>{
  const g=fresh();g.beginDuel();g.shoot(1);assert.equal(g.lives,2);assert.equal(g.status,'duel');
  ticks(g,85);assert.equal(g.doors.filter(Boolean).length,3);assert.equal(g.duelDone,0);
  assert.ok(g.doors.every(d=>d.phase==='waiting'));
});
test('clock expiry loses a life and restores a full clock, game over freezes play',()=>{
  const g=fresh();g.time=1;g.tick();assert.equal(g.lives,2);assert.equal(g.time,MODES.classic.time*HZ);
  ticks(g,85);g.lose('test');ticks(g,85);g.lose('test');assert.equal(g.status,'gameover');assert.equal(g.lives,0);
  const state=JSON.stringify(g);ticks(g,100);g.shoot(0);assert.equal(JSON.stringify(g),state);
  g.start();assert.equal(g.lives,3);assert.equal(g.status,'bank');assert.equal(g.stage,1);
});
test('invalid inputs are harmless, unavailable modes fall back, cooldown blocks autofire',()=>{
  const g=fresh('bogus');assert.equal(g.mode,'classic');
  for(const lane of [-1,3,NaN,1.2,'0'])assert.equal(g.shoot(lane),false);
  for(const direction of [0,NaN,Infinity,'1',undefined])assert.equal(g.move(direction),false);
  reveal(g,0,'hats');g.shoot(0);assert.equal(g.shoot(0),false);assert.equal(g.doors[0].hats,4);
});
test('all 18 shifts, three duel opponents and all modes are completable across seeds',()=>{
  for(const mode of Object.keys(MODES))for(const seed of [1,42,991,238947]){
    const g=new Game({mode,seed});g.start();let elapsed=0,duels=0;
    while(g.status!=='victory' && elapsed++<250000){
      if(g.status==='stageclear'){duels++;g.advance();}
      if(g.status==='bank'&&!g.doors.some(Boolean)&&g.groupComplete){
        const missing=g.deposits.findIndex(v=>!v);
        if(missing>=0)g.move(Math.sign(Math.floor(missing/3)-g.group));
      }
      for(let lane=0;lane<3;lane++){
        const d=g.doors[lane];
        if(d&&(d.phase==='armed'||(d.kind==='hats'&&d.phase!=='opening'&&d.phase!=='closing'&&(d.hats>0||d.reward==='gold'))))g.shoot(lane);
      }
      g.tick();
      assert.notEqual(g.status,'gameover',`${mode} seed ${seed} stage ${g.stage}`);
    }
    assert.equal(g.status,'victory',`${mode}, seed ${seed}, stopped on ${g.stage}`);
    assert.equal(g.stage,LAST_STAGE);assert.equal(duels,17);assert.equal(g.lives,5);
    assert.ok(g.score>18000);assert.ok(g.reactions.length>=54);
  }
});

test('voluntary finish preserves earned score and freezes the run, including from pause or a cleared shift',()=>{
  for(const status of ['bank','duel','stageclear']){
    const g=fresh();g.status=status;g.score=1230;g.paused=true;const lives=g.lives;
    assert.equal(g.finish(),true);assert.equal(g.status,'gameover');assert.equal(g.score,1230);assert.equal(g.lives,lives);assert.equal(g.paused,false);assert.equal(g.retired,true);
    const snapshot=JSON.stringify(g);g.tick();g.shoot(0);assert.equal(g.finish(),false);assert.equal(JSON.stringify(g),snapshot);
    g.start();assert.equal(g.retired,false);
  }
});
