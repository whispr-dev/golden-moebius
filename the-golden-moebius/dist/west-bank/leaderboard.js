import { readQueue, writeQueue, addRun } from './score-queue.js?v=1.1.1';
import { ENGINE_VERSION } from './engine-version.js?v=1.1.1';
const $ = id => document.getElementById(id);
const names = {easy:'Tenderfoot',classic:'Deputy',hard:'Gunslinger'};
function load(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Storage is optional. */}}
let key=load('westbank.ranked.key.v1','');
if(!/^[a-f0-9]{64}$/.test(key)){const bytes=crypto.getRandomValues(new Uint8Array(32));key=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');save('westbank.ranked.key.v1',key);}
let ownId='';
try{ownId=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),b=>b.toString(16).padStart(2,'0')).join('').slice(0,12);}catch{/* Highlighting is optional. */}
async function api(path,options={}){
  const response=await fetch('/api/west-bank/'+path,{cache:'no-store',signal:AbortSignal.timeout(12000),...options});
  let data;try{data=await response.json();}catch{throw Error('The public scorekeeper is unavailable. Your game still works.');}
  if(!response.ok)throw Error(data.error||'The scorekeeper is unavailable. Please retry.');return data;
}
const post=(path,data)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
let storage;try{storage=localStorage;}catch{/* This browser may block persistent storage. */}
let queue=readQueue(storage),pending=null,selected='classic',requestId=0;
export function savedCount(){return queue.length;}
function savedButton(){const button=$('saved-scores');if(!queue.length)button.hidden=true;button.textContent=`POST SAVED SCORE${queue.length===1?'':'S'} (${queue.length})`;}
function persist(){const kept=writeQueue(storage,queue);savedButton();return kept;}
export function hideScoreEntry(){$('score-form').hidden=true;}
export function showScoreEntry(ticket){
  pending=queue.find(r=>r.ticket===ticket)||queue.at(-1);if(!pending)return false;
  $('score-form').hidden=false;$('score-submit').disabled=false;$('score-name').disabled=false;$('score-discard').hidden=false;
  $('score-result').textContent=`Enter your name for the ${names[pending.mode]} leaderboard · $${pending.score.toLocaleString()}`;
  $('score-submit').textContent='POST SCORE ↗';
  $('score-feedback').textContent='Your nickname, verified score, difficulty and date will be public. Posting is optional.';
  $('saved-choice').replaceChildren();queue.forEach((run,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${names[run.mode]} · $${run.score.toLocaleString()}`;option.selected=run.ticket===pending.ticket;$('saved-choice').append(option);});
  $('saved-choice-label').hidden=queue.length<2;
  return true;
}
savedButton();$('saved-scores').hidden=!queue.length;
$('saved-choice').addEventListener('change',()=>showScoreEntry(queue[Number($('saved-choice').value)]?.ticket));
$('score-discard').addEventListener('click',()=>{if(!pending)return;queue=queue.filter(r=>r.ticket!==pending.ticket);pending=null;persist();if(!showScoreEntry()){$('score-form').hidden=true;$('finish-notice').hidden=false;$('finish-notice').textContent='Saved run discarded. Choose Done to return to the menu.';}});
const initialName=load('westbank.ranked.name.v1','');if(typeof initialName==='string')$('score-name').value=initialName;
export async function beginRankedRun(mode){
  $('run-badge').textContent='Checking the public scorekeeper…';
  $('ranked-status').textContent='Checking the public scorekeeper…';
  try{
    const data=await api('run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,mode,engine:ENGINE_VERSION}),signal:AbortSignal.timeout(6000)});
    const message='RANKED · '+names[mode]+' · Your result can be posted when you finish.';
    $('ranked-status').textContent=message;$('run-badge').textContent=message;
    return {seed:data.seed,ticket:data.ticket,actions:[],mode,valid:true};
  }catch(error){
    const reason=error.name==='TimeoutError'?'The scorekeeper did not respond in time.':error.message;
    $('ranked-status').textContent=reason;$('run-badge').textContent='Ranked game has not started. Retry or choose Play practice.';
    return {valid:false,reason};
  }
}
export function captureAction(run,game,kind,value){
  if(!run||!run.valid)return;
  const previous=run.actions.at(-1);let same=0;
  if(previous?.[0]===game.tickCount){for(let i=run.actions.length-1;i>=0&&run.actions[i][0]===game.tickCount;i--)same++;}
  if(run.actions.length>=20000||same>=8){run.valid=false;run.reason='This run exceeded the public replay limit.';$('run-badge').textContent=run.reason+' Local score only.';return;}
  run.actions.push([game.tickCount,kind,value]);
}
export function finishRankedRun(run,game){
  $('finish-notice').hidden=false;
  if(!run?.valid||game.score<=0){
    const message=game.score<=0?'No leaderboard entry: this run scored $0. Earn a positive score to compete.':(run?.reason||'You chose a practice game.')+' Your score is saved on this device, but this run cannot be posted publicly.';
    $('finish-notice').textContent=message;$('ranked-status').textContent=message;$('run-badge').textContent='Run finished · local score saved.';
    return;
  }
  const snapshot={key,ticket:run.ticket,mode:run.mode,ticks:game.tickCount,actions:run.actions.map(a=>a.slice()),score:game.score,savedAt:Date.now()};
  queue=addRun(queue,snapshot);const kept=persist();showScoreEntry(snapshot.ticket);
  $('finish-notice').textContent=kept?'Post your score now, or choose Done and use Post saved score from the menu later. Saved runs expire with their 24-hour ticket.':'Browser storage is unavailable. Post this score before closing or reloading this tab.';
  $('ranked-status').textContent='Run finished · enter your name on the result screen.';$('run-badge').textContent='RANKED RUN FINISHED · Enter your name and Post score.';
  $('overlay-foot').textContent='YOUR RESULT IS READY. YOUR NAME BELONGS HERE.';
  void loadBoard(run.mode);
}
export async function loadBoard(mode=selected){
  selected=mode;const request=++requestId;
  document.querySelectorAll('[data-board]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.board===mode));});
  $('board-caption').textContent=names[mode]+' · Top 25';$('board-status').textContent='Loading the frontier’s finest…';
  $('board-rows').replaceChildren();
  try{
    const data=await api('leaderboard?mode='+encodeURIComponent(mode));if(request!==requestId)return;
    if(!data.entries.length){$('board-status').textContent='No legends here yet. Finish a game and stake your claim.';return;}
    $('board-status').textContent='One personal best per player, per difficulty. Updated when you refresh or post.';
    for(const entry of data.entries){
      const row=document.createElement('tr');if(entry.player===ownId)row.className='your-record';
      const date=new Date(entry.at).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
      for(const value of [entry.rank,entry.name+(entry.player===ownId?' · you':''),'$'+entry.score.toLocaleString(),entry.victory?'All 18 ✓':`Day ${Math.floor((entry.stage-1)/9)+1}, shift ${(entry.stage-1)%9+1}`,date]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}
      $('board-rows').append(row);
    }
  }catch{if(request===requestId)$('board-status').textContent='The public leaderboard is unavailable right now. Try Refresh in a moment; the game still works.';}
}
document.querySelectorAll('[data-board]').forEach(button=>button.addEventListener('click',()=>void loadBoard(button.dataset.board)));
$('board-refresh').addEventListener('click',()=>void loadBoard());
$('score-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!pending)return;
  const snapshot=pending,name=$('score-name').value.trim();
  const locked=['score-submit','score-name','saved-choice','score-discard','start','done'];locked.forEach(id=>$(id).disabled=true);
  $('score-feedback').textContent='Checking your replay with the sheriff…';
  try{
    const result=await post('score',{key:snapshot.key,ticket:snapshot.ticket,name,ticks:snapshot.ticks,actions:snapshot.actions});save('westbank.ranked.name.v1',name);
    queue=queue.filter(run=>run.ticket!==snapshot.ticket);pending=null;persist();
    $('score-submit').textContent='SCORE POSTED ✓';$('score-discard').hidden=true;
    $('score-feedback').textContent=result.improved?`Posted! $${result.score.toLocaleString()} · ${names[result.mode]}${result.rank?' · rank #'+result.rank:''}. Choose Done or Play again.`:`Run verified. Your best remains $${result.best.toLocaleString()}. Choose Done or Play again.`;
    $('finish-notice').textContent=queue.length?`${queue.length} other saved run(s) can be posted from the menu.`:'Your result is safely on the public board.';
    void loadBoard(snapshot.mode);$('done').focus();
  }catch(error){$('score-feedback').textContent=error.name==='TimeoutError'?'Posting timed out. Your run is saved—try Post score again.':error.message;}
  finally{locked.forEach(id=>$(id).disabled=false);if(!pending){$('score-submit').disabled=true;$('done').focus();}}
});
void loadBoard();
// Let the surrounding page fit the game and live board without nested scrolling.
if(window.parent!==window){let timer;new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>parent.postMessage({type:'golden-bank-height',height:document.documentElement.scrollHeight},location.origin),60);}).observe(document.body);}
