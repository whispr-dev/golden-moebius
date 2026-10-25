import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../dist/west-bank/engine.js';
import { verifyReplay } from '../leaderboard/verify.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const enginePath=path.join(ROOT,'dist/west-bank/engine.js');
const engine=createHash('sha256').update(await readFile(enginePath)).digest('hex');
function run(seed,mode,{win=false}={}){
  const game=new Game({seed,mode});game.start();const actions=[];
  const action=(kind,value)=>{actions.push([game.tickCount,kind,value]);if(kind==='s')game.shoot(value);else if(kind==='m')game.move(value);else game.advance();};
  let budget=360000;
  while(!['gameover','victory'].includes(game.status)&&budget-->0){
    if(game.status==='stageclear')action('a',0);
    if(!game.recovery){
      if(game.status==='bank'&&game.groupComplete&&!game.doors.some(Boolean))action('m',game.group<2?1:-1);
      for(let i=0;i<3;i++){
        const d=game.doors[i];if(!d)continue;
        if(d.phase==='armed'&&(win||game.score===0))action('s',i);
        else if(win&&d.kind==='hats'&&['waiting','reward'].includes(d.phase)&&(d.hats>0||d.reward==='gold'))action('s',i);
        else if(!win&&game.score>0&&d.harmless&&d.phase==='waiting')action('s',i);
      }
    }
    game.tick();
  }
  assert.ok(budget>0);return {ticks:game.tickCount,actions,expected:game.score,stage:game.stage,status:game.status,seed,mode};
}
for(const mode of ['easy','classic','hard'])test('replay matches a complete 18-shift game: '+mode,async()=>{
  const payload=run(555,mode,{win:true});assert.equal(payload.status,'victory');
  const result=await verifyReplay(payload,enginePath);assert.equal(result.score,payload.expected);assert.equal(result.stage,18);assert.equal(result.victory,true);
});
test('voluntary finish is replayed and cannot claim a future tick or extra points',async()=>{
  const seed=555,mode='classic',g=new Game({seed,mode});g.start();
  while(g.score===0&&g.tickCount<5000)g.tick();
  assert.ok(g.score>0);const earned=g.score;const ticks=g.tickCount;
  g.finish();const actions=[[ticks,'q',0]];
  const result=await verifyReplay({seed,mode,ticks,actions},enginePath);
  assert.equal(result.score,earned);assert.equal(result.victory,false);
  await assert.rejects(verifyReplay({seed,mode,ticks:ticks+1,actions},enginePath));
});
test('replay rejects unfinished, excessive, reordered and invalid actions',async()=>{
  const valid=run(12345,'classic');
  for(const change of [{ticks:360001},{actions:[[2,'s',0],[1,'s',0]]},{actions:[[0,'s',5]]},{actions:[[0,'a',0]]},{actions:Array.from({length:9},()=>[0,'s',0])},{ticks:1,actions:[]}]){
    await assert.rejects(verifyReplay({...valid,...change},enginePath));
  }
});
test('API verifies scores, rejects forgery, separates modes and preserves data after restart',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'golden-board-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let child,base,output='';
  async function start(){
    output='';child=spawn(process.execPath,['leaderboard/server.mjs'],{cwd:ROOT,env:{...process.env,GOLDEN_STATE_DIR:directory,PORT:'0'},stdio:['ignore','pipe','pipe']});
    t.after(()=>{if(child?.exitCode===null)child.kill();});
    const ready=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/127\.0\.0\.1:(\d+)/);if(m)resolve('http://127.0.0.1:'+m[1]);});child.stderr.on('data',chunk=>output+=chunk);child.once('exit',code=>reject(Error('API exited '+code+': '+output)));});
    base=await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('API startup timed out: '+output)),5000);timer.unref();})]);
  }
  async function stop(){const process=child;process.kill();await once(process,'exit');}
  const api=async(route,data,origin='https://yt.cafe')=>{const response=await fetch(base+'/api/west-bank/'+route,data?{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)}:{});return {status:response.status,data:await response.json(),headers:response.headers};};
  const key=randomBytes(32).toString('hex');
  // Tickets are server issued in production. Advancing their issuance timestamp
  // with this isolated test key lets deterministic integration tests run fast.
  async function age(ticket){const [body]=ticket.split('.');const data=JSON.parse(Buffer.from(body,'base64url'));data.issued-=7200000;const encoded=Buffer.from(JSON.stringify(data)).toString('base64url');const secret=await readFile(path.join(directory,'signing.key'));return encoded+'.'+createHmac('sha256',secret).update(encoded).digest('hex');}
  await start();
  assert.equal((await api('health')).data.engine,engine);
  assert.equal((await api('leaderboard?mode=classic')).data.entries.length,0);
  assert.equal((await api('run',{key,mode:'classic',engine},'https://attacker.example')).status,403);
  assert.equal((await api('run',{key,mode:'classic',engine:'0'.repeat(64)})).status,400);
  const ticket=await api('run',{key,mode:'classic',engine});assert.equal(ticket.status,201);
  const payload=run(ticket.data.seed,'classic');
  const score={key,name:'wofl',ticket:await age(ticket.data.ticket),ticks:payload.ticks,actions:payload.actions,score:999999999};
  const submitted=await api('score',score);assert.equal(submitted.status,200,JSON.stringify(submitted.data));assert.equal(submitted.data.score,payload.expected);assert.notEqual(submitted.data.score,score.score);
  assert.equal(submitted.headers.get('cache-control'),'no-store');
  const duplicate=await api('score',score);assert.deepEqual(duplicate.data,submitted.data);
  assert.equal((await api('leaderboard?mode=classic')).data.entries[0].name,'wofl');
  assert.equal((await api('leaderboard?mode=hard')).data.entries.length,0);
  assert.equal((await api('score',{...score,key:'0'.repeat(64)})).status,400);
  const bad=await api('run',{key,mode:'hard',engine});const badReplay=run(bad.data.seed,'hard');
  assert.equal((await api('score',{key,name:'<script>alert(1)</script>',ticket:await age(bad.data.ticket),ticks:badReplay.ticks,actions:badReplay.actions})).status,400);
  assert.equal((await api('score',{key,name:'OK',ticket:bad.data.ticket+'0',ticks:badReplay.ticks,actions:badReplay.actions})).status,400);
  assert.equal((await api('score',{key,name:'OK',ticket:bad.data.ticket,ticks:360000,actions:[]})).status,400);
  const hard=await api('score',{key,name:'wofl',ticket:await age(bad.data.ticket),ticks:badReplay.ticks,actions:badReplay.actions});assert.equal(hard.status,200,JSON.stringify(hard.data));
  await stop();await start();
  const retained=await api('leaderboard?mode=classic');assert.equal(retained.data.entries[0].score,payload.expected);assert.equal((await api('leaderboard?mode=hard')).data.entries.length,1);
  assert.deepEqual((await api('score',score)).data,submitted.data);
  const second=await api('run',{key,mode:'classic',engine});const secondRun=run(second.data.seed,'classic');
  const secondPost=await api('score',{key,name:'wofl renamed',ticket:await age(second.data.ticket),ticks:secondRun.ticks,actions:secondRun.actions});assert.equal(secondPost.status,200);
  const best=await api('leaderboard?mode=classic');assert.equal(best.data.entries.length,1);assert.equal(best.data.entries[0].score,Math.max(payload.expected,secondRun.expected));assert.equal(best.data.entries[0].name,'wofl renamed');
  assert.equal((await api('leaderboard?mode=hard')).data.entries[0].name,'wofl renamed');
  const persisted=JSON.parse(await readFile(path.join(directory,'leaderboard.json'),'utf8'));assert.equal(persisted.boards.classic.length,1);assert.ok(!JSON.stringify(persisted).includes(key));
  await stop();
});
