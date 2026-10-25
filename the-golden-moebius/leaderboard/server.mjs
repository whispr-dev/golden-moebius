// Small, same-origin API. No npm dependencies, accounts, cookies or score trusts.
import http from 'node:http';
import { readFile, writeFile, rename, open, mkdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.argv.includes('--dev');
const WEB = path.resolve(process.env.GOLDEN_WEB_ROOT || path.join(HERE, existsSync(path.join(HERE,'../public')) ? '../public' : '../dist'));
const STATE = process.env.STATE_DIRECTORY || process.env.GOLDEN_STATE_DIR || (DEV ? path.join(os.tmpdir(),'golden-moebius-dev') : '');
if (!STATE) throw Error('STATE_DIRECTORY or GOLDEN_STATE_DIR is required.');
const option = name => { const index=process.argv.indexOf(name); return index>=0?process.argv[index+1]:undefined; };
const PORT = Number(process.env.PORT || (DEV?option('--port'):undefined) || 8791);
const HOST = DEV ? (option('--host') || '127.0.0.1') : '127.0.0.1';
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw Error('Invalid PORT.');
const enginePath = path.join(WEB,'west-bank/engine.js');
const engine = createHash('sha256').update(await readFile(enginePath)).digest('hex');
const build = JSON.parse(await readFile(path.join(WEB,'site-version.json'),'utf8')).build;
await mkdir(STATE,{recursive:true,mode:0o700});
const keyFile = path.join(STATE,'signing.key'), dataFile = path.join(STATE,'leaderboard.json');
let secret;
try { secret = await readFile(keyFile); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  secret = randomBytes(32); await writeFile(keyFile,secret,{flag:'wx',mode:0o600});
}
if (secret.length !== 32) throw Error('Invalid signing key; restore the existing key from backup.');
let state;
try { state = JSON.parse(await readFile(dataFile,'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { version:1, boards:{easy:[],classic:[],hard:[]}, used:{} }; }
if (state.version !== 1 || !state.boards || !state.used || !['easy','classic','hard'].every(m=>Array.isArray(state.boards[m])&&state.boards[m].length<=1000)) throw Error('Invalid leaderboard file; restore a backup.');
const hash = s => createHash('sha256').update(s).digest('hex');
const modes = ['easy','classic','hard'];
const compare = (a,b) => b.score-a.score || Number(b.victory)-Number(a.victory) || b.stage-a.stage || a.ticks-b.ticks || a.at-b.at || a.player.localeCompare(b.player);
let writeQueue = Promise.resolve(), workers = 0;
async function transaction(action) {
  const task = writeQueue.then(async()=> {
    const candidate = structuredClone(state);
    for (const [id,value] of Object.entries(candidate.used)) if (value.expires < Date.now()) delete candidate.used[id];
    const result = action(candidate);
    const temporary = path.join(STATE,`leaderboard-${randomBytes(8).toString('hex')}.tmp`);
    try {
      const handle = await open(temporary,'wx',0o600);
      try { await handle.writeFile(JSON.stringify(candidate)+'\n'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary,dataFile);
      if(process.platform!=='win32'){const directory = await open(STATE,'r'); try { await directory.sync(); } finally { await directory.close(); }}
      state = candidate; return result;
    } finally { await unlink(temporary).catch(()=>{}); }
  });
  writeQueue = task.catch(()=>{}); return task;
}
const limits = new Map();
function limit(key, maximum, window=60000) {
  const now=Date.now(); let item=limits.get(key);
  if (!item || item.reset<=now) { item={count:0,reset:now+window}; limits.set(key,item); }
  if (++item.count>maximum) throw Object.assign(Error('A little breather, sheriff. Please try again in a minute.'),{status:429});
}
const prune = setInterval(()=>{const now=Date.now();for(const [key,item] of limits)if(item.reset<=now)limits.delete(key);},60000); prune.unref();
function token(data) { const body=Buffer.from(JSON.stringify(data)).toString('base64url'); return body+'.'+createHmac('sha256',secret).update(body).digest('hex'); }
function untoken(value) {
  if (typeof value!=='string'||value.length>1500) throw Error('Invalid run ticket.');
  const [body,sig,...extra]=value.split('.');
  const expected=createHmac('sha256',secret).update(body||'').digest();
  if (extra.length||!/^[a-f0-9]{64}$/.test(sig||'')||!timingSafeEqual(expected,Buffer.from(sig,'hex'))) throw Error('Invalid run ticket.');
  const data=JSON.parse(Buffer.from(body,'base64url').toString());
  if (!modes.includes(data.mode)||data.engine!==engine||!Number.isInteger(data.issued)||Date.now()-data.issued>86400000||data.issued>Date.now()+1000||!/^[a-f0-9]{32}$/.test(data.id||'')||!/^[a-f0-9]{64}$/.test(data.player||'')||!Number.isInteger(data.seed)||data.seed<1||data.seed>0xffffffff) throw Error('Run ticket expired or the game has been updated. Start a new run.');
  return data;
}
function playerKey(data) { if (!/^[a-f0-9]{64}$/.test(data.key||'')) throw Error('Invalid player key.'); return hash(data.key); }
function nameOf(value) {
  if (typeof value!=='string') throw Error('Choose a public name.');
  const name=value.normalize('NFKC').trim().replace(/\s+/gu,' ');
  if (!/^[\p{L}\p{N}_. -]{1,24}$/u.test(name)||!/[\p{L}\p{N}]/u.test(name)) throw Error('Use 1–24 letters, numbers, spaces, dots, hyphens or underscores.');
  return name;
}
function replay(payload) {
  if (workers>=2) throw Object.assign(Error('The scorekeeper is busy. Your result is kept here; try posting again shortly.'),{status:503});
  workers++;
  return new Promise((resolve,reject)=>{
    let worker, settled=false;
    const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);workers--;if(worker)void worker.terminate();error?reject(error):resolve(result);};
    const timer=setTimeout(()=>done(Error('Replay verification timed out.')),8000);
    try {
      worker=new Worker(new URL('./verify.mjs',import.meta.url),{workerData:{payload,enginePath},resourceLimits:{maxOldGenerationSizeMb:64,stackSizeMb:4}});
      worker.once('message',message=>done(message.error?Error(message.error):null,message.result));
      worker.once('error',error=>done(error));worker.once('exit',code=>{if(!settled)done(Error(`Replay worker stopped (${code}).`));});
    } catch(error) { done(error); }
  });
}
function board(mode) { return state.boards[mode].slice().sort(compare).slice(0,25).map((r,index)=>({ rank:index+1,name:r.name,score:r.score,stage:r.stage,victory:r.victory,at:r.at,player:r.player.slice(0,12) })); }
function send(res,status,data) {
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(body);
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim()!=='application/json') throw Object.assign(Error('Use application/json.'),{status:415});
  const length=req.headers['content-length'];
  if (length&&!/^\d+$/.test(length)) throw Error('Invalid body length.');
  if (Number(length)>768000) throw Object.assign(Error('Replay is too large.'),{status:413});
  let size=0;const parts=[];
  for await(const chunk of req){size+=chunk.length;if(size>768000)throw Object.assign(Error('Replay is too large.'),{status:413});parts.push(chunk);}
  const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!data||Array.isArray(data)||typeof data!=='object')throw Error('Invalid JSON object.');
  return data;
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json','.ttf':'font/ttf','.gz':'application/gzip'};
async function staticDev(req,res,url){
  let relative=decodeURIComponent(url.pathname);if(relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(WEB,'.'+relative);
  if(!file.startsWith(WEB+path.sep))return send(res,404,{error:'Not found.'});
  try{if(!(await stat(file)).isFile())throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}
  catch{send(res,404,{error:'Not found.'});}
}
const server=http.createServer({maxHeaderSize:8192},async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/west-bank/')){if(DEV&&req.method==='GET')return await staticDev(req,res,url);return send(res,404,{error:'Not found.'});}
    const client=String(req.headers['x-golden-client']||req.socket.remoteAddress||'local').slice(0,100);
    limit('all',600);limit('client:'+client,240);
    if(req.method==='GET'&&url.pathname==='/api/west-bank/health')return send(res,200,{ok:true,engine,build});
    if(req.method==='GET'&&url.pathname==='/api/west-bank/leaderboard'){
      const mode=url.searchParams.get('mode')||'classic';if(!modes.includes(mode))throw Error('Unknown difficulty.');return send(res,200,{mode,entries:board(mode)});
    }
    if(req.method!=='POST')return send(res,405,{error:'Method not allowed.'});
    const origins=['https://yt.cafe','https://www.yt.cafe'];
    if(DEV&&req.headers.host)origins.push('http://'+req.headers.host);
    if(!origins.includes(req.headers.origin))return send(res,403,{error:'Use the game on yt.cafe to post a score.'});
    const data=await body(req),player=playerKey(data);
    if(url.pathname==='/api/west-bank/run'){
      limit('issue:'+player,6);limit('issue:global',120);
      if(!modes.includes(data.mode)||data.engine!==engine)throw Error('Refresh the page to load the current game.');
      const seed=randomBytes(4).readUInt32LE()||1;
      const ticket=token({id:randomBytes(16).toString('hex'),player,mode:data.mode,seed,engine,issued:Date.now()});
      return send(res,201,{ticket,seed,engine});
    }
    if(url.pathname==='/api/west-bank/score'){
      limit('submit:'+player,6);const run=untoken(data.ticket);if(run.player!==player)throw Error('This run belongs to another player.');
      if(state.used[run.id])return send(res,200,state.used[run.id].receipt);
      const name=nameOf(data.name);
      if(!Number.isInteger(data.ticks)||data.ticks/50>(Date.now()-run.issued)/1000+3)throw Error('Run was faster than real time.');
      const result=await replay({seed:run.seed,mode:run.mode,ticks:data.ticks,actions:data.actions});
      const receipt=await transaction(candidate=>{
        if(candidate.used[run.id])return candidate.used[run.id].receipt;
        if(Object.keys(candidate.used).length>=20000)throw Object.assign(Error('The scorekeeper is full for today. Try again later.'),{status:503});
        const entries=candidate.boards[run.mode],previous=entries.find(e=>e.player===player);
        const entry={...result,name,player,at:Date.now()};
        const improved=!previous||compare(entry,previous)<0;
        if(improved){if(previous)entries.splice(entries.indexOf(previous),1);entries.push(entry);entries.sort(compare);entries.splice(1000);}
        for(const mode of modes)for(const record of candidate.boards[mode])if(record.player===player)record.name=name;
        const rank=candidate.boards[run.mode].findIndex(e=>e.player===player)+1;
        const receipt={ok:true,mode:run.mode,score:result.score,best:improved?result.score:previous.score,rank:rank||null,improved};
        candidate.used[run.id]={expires:run.issued+86400000,receipt};return receipt;
      });return send(res,200,receipt);
    }
    return send(res,404,{error:'Not found.'});
  }catch(error){if(res.destroyed||res.headersSent)return;const status=error.status||(error.code?503:400);if(status>=500)console.error('Leaderboard request failed:',error.message);send(res,status,{error:status>=500&&error.code?'Scorekeeper temporarily unavailable. Please retry.':error.message});}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.timeout=15000;server.keepAliveTimeout=3000;server.maxRequestsPerSocket=50;server.maxConnections=100;
server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
server.listen(PORT,HOST,()=>console.log(`Golden Moebius leaderboard listening on ${HOST}:${server.address().port} (build ${build})`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{void writeQueue.finally(()=>process.exit(0));});setTimeout(()=>process.exit(1),10000).unref();});
