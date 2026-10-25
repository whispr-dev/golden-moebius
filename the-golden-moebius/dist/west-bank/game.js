import { Game, HZ, MODES, LAST_STAGE } from './engine.js?v=1.1.1';
import { beginRankedRun, captureAction, finishRankedRun, hideScoreEntry, showScoreEntry, savedCount } from './leaderboard.js?v=1.1.1';

const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha: false });
const W = 480, H = 300;
ctx.imageSmoothingEnabled = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colors = {
  ink:'#242c2c', dark:'#352f2b', shade:'#684d3a', wood:'#a47747',
  ochre:'#bb9359', sand:'#d5b87c', cream:'#eee0af', gold:'#efcb6c',
  rust:'#a8493b', red:'#db6850', skin:'#e5ae78', skinShadow:'#b97b50',
  teal:'#6c9b8c', green:'#77885c', blue:'#647a93', purple:'#8c6d86'
};
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
let records = load('westbank.frontier.records.v1', {});
if(!records || typeof records!=='object' || Array.isArray(records)) records={};
let muted = load('westbank.frontier.muted.v1', false) === true;
let audio = null;
function enableAudio() {
  if(muted)return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if(!Audio)return;
    if(!audio)audio=new Audio();
    if(audio.state==='suspended')audio.resume().catch(()=>{});
  } catch { /* Audio is optional; gameplay never depends on it. */ }
}
function tone(freq, time=.09, type='square', gain=.025, delay=0, endFreq) {
  if(muted||!audio||audio.state!=='running')return;
  const start=audio.currentTime+delay, osc=audio.createOscillator(), amp=audio.createGain();
  osc.type=type; osc.frequency.setValueAtTime(freq,start);
  if(endFreq)osc.frequency.exponentialRampToValueAtTime(endFreq,start+time);
  amp.gain.setValueAtTime(gain,start); amp.gain.exponentialRampToValueAtTime(.0001,start+time);
  osc.connect(amp);amp.connect(audio.destination);osc.start(start);osc.stop(start+time+.01);
  osc.onended=()=>{osc.disconnect();amp.disconnect();};
}
function noise(time=.12) {
  if(muted||!audio||audio.state!=='running')return;
  const length=Math.floor(audio.sampleRate*time),buffer=audio.createBuffer(1,length,audio.sampleRate),data=buffer.getChannelData(0);
  // Deterministic white noise, separate from the gameplay RNG.
  let seed=437;
  for(let i=0;i<length;i++){seed=(seed*16807)%2147483647;data[i]=(seed/2147483647*2-1)*.09*(1-i/length)**3;}
  const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);source.start();source.onended=()=>source.disconnect();
}
let flashes=[0,0,0], effects=[], damage=0, lastStatus='title', overlayReason='', accumulator=0, lastTime=0;
let queued=[], rankedRun=null, starting=false;
let game=new Game({emit:onEvent});
function onEvent(event) {
  if(event.type==='message') {
    // Announce important events, never every simulated frame.
    if(event.kind==='bad')$('announcement').textContent=event.message;
  } else if(event.type==='shot'){flashes[event.lane]=5;noise(.08);tone(130,.05,'square',.018,0,45);}
  else if(event.type==='deposit'){tone(660,.08);tone(880,.12,'square',.022,.08);effects.push({lane:event.lane,text:'+$',life:35,color:colors.gold});}
  else if(event.type==='hit'){tone(180,.07,'square',.03,0,80);effects.push({lane:event.lane,text:'HIT',life:30,color:colors.gold});}
  else if(event.type==='hat'){tone(480,.035,'square',.022);effects.push({lane:event.lane,text:'✦',life:20,color:colors.cream});}
  else if(event.type==='draw'){tone(220,.04,'square',.012);}
  else if(event.type==='door'){tone(90,.08,'triangle',.02,0,65);}
  else if(event.type==='move'){tone(130,.08,'triangle',.025);}
  else if(event.type==='hurt'){damage=18;noise(.22);tone(110,.3,'sawtooth',.035,0,45);}
  else if(event.type==='clear'){[392,494,587,784].forEach((f,i)=>tone(f,.18,'square',.022,i*.11));record();}
  else if(event.type==='end') record();
}
function record() {
  const prior=Number(records[game.mode]) || 0;
  if(game.score>prior){records[game.mode]=game.score;save('westbank.frontier.records.v1',records);}
  updateRecord();
}
function updateRecord() {
  const mode=game.status==='title'?$('difficulty').value:game.mode;
  $('high-score').textContent='$'+String(Math.max(0,Number(records[mode])||0)).padStart(6,'0');
  $('record-mode').textContent=MODES[mode].label.toUpperCase();
}
function setSound() {
  $('sound').setAttribute('aria-pressed',String(muted));
  $('sound').setAttribute('aria-label',muted?'Unmute sound':'Mute sound');
  $('sound').querySelector('span').textContent=muted?'SOUND OFF':'SOUND ON';
}
$('sound').addEventListener('click',()=>{muted=!muted;save('westbank.frontier.muted.v1',muted);setSound();enableAudio();});
$('difficulty').addEventListener('change',updateRecord);
setSound();updateRecord();
function setOverlay(title,subtitle,detail,button,reason,foot='A STEADY HAND BEATS A BUSY TRIGGER.') {
  hideScoreEntry();$('finish-notice').hidden=true;$('start').hidden=reason==='saved';
  $('done').hidden=!['gameover','victory','saved'].includes(reason);
  $('finish-run').hidden=!['pause','stageclear'].includes(reason);
  $('practice-start').hidden=!['start','connection'].includes(reason);
  $('saved-scores').hidden=!['start','connection'].includes(reason)||!savedCount();
  overlayReason=reason;
  $('overlay').hidden=false;
  $('overlay').className='overlay '+(reason==='pause'?'paused':reason==='start'?'':'result');
  $('overlay-title').textContent=title;
  $('overlay-subtitle').textContent=subtitle;
  $('overlay-detail').textContent=detail;
  $('start').replaceChildren(document.createTextNode(button+'  →'));
  $('overlay-foot').textContent=foot;
  const showDifficulty=['start','connection'].includes(reason);
  $('difficulty').hidden=!showDifficulty;$('difficulty-label').hidden=!showDifficulty;
  $('pause').hidden=true;
  $('announcement').textContent=title+'. '+subtitle;
  if(reason!=='start')$('start').focus({preventScroll:true});
}
function hideOverlay() {
  $('overlay').hidden=true;$('pause').hidden=false;overlayReason='';
  canvas.focus({preventScroll:true});queued=[];accumulator=0;lastTime=0;
}
async function start(practice=false) {
  practice=practice===true;
  if(starting)return;
  enableAudio();
  if(overlayReason==='saved'){returnToMenu();return;}
  if(overlayReason==='pause'){game.paused=false;hideOverlay();return;}
  if(game.status==='stageclear'){captureAction(rankedRun,game,'a',0);game.advance();hideOverlay();lastStatus=game.status;return;}
  const mode=$('difficulty').value;
  starting=true;$('start').disabled=true;$('difficulty').disabled=true;
  try{rankedRun=practice?{valid:false,reason:'You chose a practice game.'}:await beginRankedRun(mode);}
  finally{starting=false;$('start').disabled=false;$('difficulty').disabled=false;}
  if(!practice&&!rankedRun.valid){setOverlay('SCOREKEEPER OFFLINE','Ranked game has not started.',rankedRun.reason+' Retry ranked or choose Play practice.','RETRY RANKED','connection');return;}
  if(practice)$('run-badge').textContent='PRACTICE · Local score only. This run will not go on the public leaderboard.';
  game=new Game({seed:rankedRun?.seed??Date.now(),mode,emit:onEvent});game.start();
  flashes=[0,0,0];effects=[];damage=0;lastStatus='bank';hideOverlay();updateRecord();
  tone(330,.12);tone(440,.15,'square',.02,.11);tone(660,.2,'square',.02,.22);
}
$('start').addEventListener('click',()=>void start());
$('practice-start').addEventListener('click',()=>void start(true));
function returnToMenu(){
  game=new Game({mode:$('difficulty').value,emit:onEvent});queued=[];rankedRun=null;lastStatus='title';
  setOverlay('WANTED','A steady hand. A cooler head.','Choose your badge. Play ranked to join the public leaderboard, or choose Play practice.','PLAY RANKED','start','UNPOSTED RANKED RUNS CAN BE RECOVERED FROM THIS MENU.');
  $('run-badge').textContent=savedCount()?'Your unposted run is saved. Choose Post saved score, or play again.':'Choose a badge, then Play ranked to compete.';
  updateRecord();$('start').focus();
}
$('done').addEventListener('click',()=>{returnToMenu();if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});if(parent!==window)parent.postMessage({type:'golden-bank-done'},location.origin);});
$('finish-run').addEventListener('click',()=>{
  captureAction(rankedRun,game,'q',0);queued=[];game.finish();syncState();
});
$('saved-scores').addEventListener('click',()=>{
  setOverlay('SAVED SCORE','Your last runs are waiting.','Choose a saved run, enter your name, then Post score.','BACK TO MENU','saved');
  if(showScoreEntry())$('score-name').focus();
});

function pause(reason = 'manual') {
  if(!['bank','duel'].includes(game.status))return;
  if(game.paused){game.paused=false;hideOverlay();return;}
  game.paused=true;queued=[];accumulator=0;
  const subtitle=reason==='focus'?'You stepped away. The frontier can wait.':'Even a sheriff needs a breather.';
  setOverlay('HOLD FIRE',subtitle,`Day ${game.day}, shift ${game.shift}. Your score: $${game.score.toLocaleString()}. The frontier can wait.`,'BACK TO THE BANK','pause');
}
$('pause').addEventListener('click',pause);
function enqueue(type,value) { enableAudio(); if(!game.paused&&['bank','duel'].includes(game.status))queued.push({type,value}); }
document.querySelectorAll('[data-fire]').forEach(button=>button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();canvas.focus({preventScroll:true});enqueue('shoot',Number(button.dataset.fire));}));
// Keyboard activation of the real buttons remains available to assistive input.
document.querySelectorAll('[data-fire]').forEach(button=>button.addEventListener('click',event=>{if(event.detail===0)enqueue('shoot',Number(button.dataset.fire));}));
$('left').addEventListener('click',()=>enqueue('move',-1));$('right').addEventListener('click',()=>enqueue('move',1));
document.addEventListener('keydown',event=>{
  if(event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey)return;
  const key=event.key.toLowerCase();
  if(key==='m'&&!event.repeat){$('sound').click();return;}
  if(['escape',' '].includes(key)&&['bank','duel'].includes(game.status)) {
    // Space on the focused resume button should activate it only once.
    if(key===' '&&event.target instanceof HTMLButtonElement)return;
    event.preventDefault();if(!event.repeat)pause();return;
  }
  if(game.paused||!['bank','duel'].includes(game.status))return;
  if(['1','2','3','o','p','arrowleft','arrowright','a','d'].includes(key)) {
    event.preventDefault();if(event.repeat)return;
    if(['1','2','3'].includes(key))enqueue('shoot',Number(key)-1);
    else enqueue('move',['o','a','arrowleft'].includes(key)?-1:1);
  }
});
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  event.preventDefault();canvas.focus({preventScroll:true});
  const bounds=canvas.getBoundingClientRect(),scale=Math.min(bounds.width/W,bounds.height/H);
  const x=(event.clientX-bounds.left-(bounds.width-W*scale)/2)/scale;
  const y=(event.clientY-bounds.top-(bounds.height-H*scale)/2)/scale;
  if(y<88||y>232)return;
  const lane=Math.floor((x-34)/138);
  if(lane>=0&&lane<3)enqueue('shoot',lane);
});
window.addEventListener('blur',()=>{if(!game.paused&&['bank','duel'].includes(game.status))pause('focus');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!game.paused&&['bank','duel'].includes(game.status))pause('focus');lastTime=0;accumulator=0;});
$('fullscreen').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await $('playfield').requestFullscreen();}
  catch{$('announcement').textContent='Fullscreen is unavailable in this browser. The game still works in the page.';}
});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');});

function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function line(x,y,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(Math.round(x),Math.round(y));ctx.lineTo(Math.round(x2),Math.round(y2));ctx.stroke();}
function poly(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
function text(value,x,y,size=8,color=colors.cream,align='left',font='monospace'){ctx.fillStyle=color;ctx.font=`bold ${size}px ${font}`;ctx.textAlign=align;ctx.textBaseline='top';ctx.fillText(value,Math.round(x),Math.round(y));}
function star(x,y,r,color=colors.gold){const pts=[];for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,rr=i%2?r*.45:r;pts.push([Math.round(x+Math.cos(a)*rr),Math.round(y+Math.sin(a)*rr)]);}poly(pts,color);}
function cactus(x,y,s=1) {
  const c=game.night?'#424a47':'#777e53',l=game.night?'#5a6355':'#969267';
  rect(x,y-31*s,5*s,31*s,c);rect(x+1*s,y-29*s,1*s,27*s,l);
  rect(x-7*s,y-22*s,4*s,12*s,c);rect(x-4*s,y-14*s,6*s,4*s,c);
  rect(x+5*s,y-18*s,8*s,4*s,c);rect(x+10*s,y-26*s,4*s,11*s,c);
}
function background() {
  const night=game.night;
  rect(0,0,W,H,colors.ink);
  rect(0,32,W,172,night?'#444854':'#bc8e70');
  rect(0,50,W,34,night?'#55505a':'#cda57a');
  if(night){rect(438,39,9,9,'#decf9c');rect(436,39,6,7,'#444854');for(const [x,y] of [[18,44],[90,39],[327,43],[410,52]])rect(x,y,1,1,colors.cream);}
  else {rect(434,43,16,16,'#dfbe86');rect(431,47,22,8,'#dfbe86');}
  poly([[0,99],[20,71],[36,84],[53,70],[80,103],[380,99],[418,69],[434,82],[454,65],[480,93],[480,150],[0,150]],night?'#5c5658':'#aa805e');
  poly([[0,120],[22,101],[40,110],[65,96],[99,126],[390,124],[425,98],[452,113],[480,94],[480,190],[0,190]],night?'#69605b':'#b59269');
  rect(0,148,W,98,night?'#86795d':'#ba9b66');
  for(let i=0;i<30;i++){const x=(i*71+13)%480,y=152+(i*29)%88;rect(x,y,3+i%4,1,night?'#726c59':'#a58a5e');}
  cactus(13,214,1.1);cactus(460,202,.9);
  rect(1,232,26,5,colors.shade);rect(5,237,18,11,colors.wood);rect(7,241,14,2,colors.ochre);
  // Bank facade: roof, timber siding, windows and deep-set doors.
  rect(25,64,430,172,colors.shade);rect(31,70,418,162,colors.ochre);
  for(let y=76;y<232;y+=10){rect(31,y,418,1,colors.wood);rect(31,y+1,418,1,'#c6a068');}
  rect(21,62,438,5,colors.cream);rect(25,67,430,4,colors.wood);
  rect(29,70,422,4,colors.shade);rect(30,57,420,5,colors.sand);
  for(let x=32;x<450;x+=14){rect(x,57,9,2,colors.cream);rect(x+2,72,5,5,colors.wood);}
  // Signboard has deliberately original lettering/layout.
  rect(144,48,192,34,colors.shade);rect(147,47,186,31,colors.sand);
  rect(151,50,178,25,colors.cream);rect(154,53,172,19,colors.dark);
  text('W E S T  B A N K',240,56,13,colors.gold,'center','Georgia');
  star(159,62,3,colors.sand);star(321,62,3,colors.sand);
  // Side columns and small lanterns.
  for(const x of [32,175,313,445]){rect(x,83,6,149,colors.shade);rect(x,83,2,149,colors.sand);rect(x-2,225,10,9,colors.wood);}
  for(const x of [43,430]){rect(x,93,4,7,colors.shade);rect(x-3,101,10,3,colors.dark);rect(x-2,104,8,11,colors.dark);rect(x,105,4,8,night?colors.gold:'#d6b577');rect(x-2,116,8,2,colors.dark);}
  rect(23,232,435,5,colors.shade);rect(19,237,443,6,colors.sand);rect(16,243,448,6,colors.wood);rect(13,249,454,6,colors.shade);
  rect(0,255,W,12,night?'#5f5647':'#967a53');
  for(let x=-50;x<530;x+=58)line(240+(x-240)*.84,255,x,267,colors.shade);
  line(0,262,480,262,colors.shade);
}
function bag(x,y,s=1){
  rect(x+5*s,y,6*s,3*s,colors.gold);rect(x+6*s,y+3*s,4*s,2*s,colors.shade);
  poly([[x+5*s,y+5*s],[x+11*s,y+5*s],[x+15*s,y+10*s],[x+14*s,y+17*s],[x+2*s,y+17*s],[x+1*s,y+11*s]],colors.gold);
  rect(x+3*s,y+12*s,1*s,4*s,colors.ochre);text('$',x+8*s,y+7*s,7*s,colors.shade,'center');
}
function hat(x,y,c=colors.shade,s=1){rect(x+4*s,y,13*s,6*s,c);rect(x,y+6*s,21*s,3*s,c);rect(x+4*s,y+4*s,13*s,2*s,colors.ochre);}
function character(cx,base,d) {
  ctx.save();
  let scale=1.65;
  const bob=reducedMotion?0:Math.floor(Math.sin(d.age/12)*.6);
  ctx.translate(Math.round(cx-27),Math.round(base-99+bob));ctx.scale(scale,scale);
  if(d.phase==='hit') {ctx.translate(2,d.phaseAge*.3);ctx.globalAlpha=Math.max(0,1-d.phaseAge/25);}
  const r=(x,y,w,h,c)=>rect(x,y,w,h,c);
  const kind=d.kind, armed=d.phase==='armed';
  const lady=kind==='lady', farmer=kind==='farmer', hats=kind==='hats', dandy=kind==='dandy', mystery=kind==='mystery';
  const coat=farmer?colors.green:lady?colors.teal:hats?colors.green:dandy?colors.purple:mystery?colors.shade:colors.blue;
  const skin=colors.skin;
  // Boots, legs and the body silhouette are distinct in every archetype.
  r(9,48,6,10,colors.dark);r(19,48,6,10,colors.dark);r(7,57,8,3,colors.dark);r(19,57,9,3,colors.dark);
  if(lady)poly([[12,27],[23,27],[29,53],[5,53]],colors.teal);
  else {r(8,31,19,18,coat);r(8,47,8,8,colors.shade);r(19,47,8,8,colors.shade);r(10,48,5,5,colors.wood);}
  r(8,28,20,17,coat);r(5,30,5,16,coat);r(26,30,5,16,coat);
  r(9,29,3,16,farmer?'#9ba579':lady?'#8db2a0':colors.sand);
  r(22,29,3,16,farmer?'#9ba579':lady?'#8db2a0':colors.shade);
  if(farmer){for(let y=31;y<43;y+=4)r(12,y,10,1,colors.shade);r(14,28,2,17,colors.sand);r(22,28,2,17,colors.sand);}
  if(dandy){r(13,29,10,14,colors.cream);poly([[17,29],[21,29],[19,34]],colors.rust);r(17,35,2,8,colors.dark);}
  r(8,44,20,3,colors.dark);r(17,44,4,3,colors.gold);
  // Neck, ears, face, eyes and hair.
  r(14,24,8,6,skin);r(10,12,15,14,skin);r(8,16,3,6,colors.skinShadow);r(24,16,3,6,colors.skinShadow);
  r(10,12,3,13,colors.skinShadow);r(13,14,12,1,colors.cream);r(14,18,2,2,colors.dark);r(22,18,2,2,colors.dark);
  r(18,19,2,4,colors.skinShadow);r(16,24,6,1,colors.shade);
  if(!lady&&!farmer){r(13,22,11,2,colors.shade);r(14,24,8,3,colors.shade);}
  if(lady){r(8,11,5,19,colors.shade);r(24,11,3,20,colors.shade);r(12,9,12,5,colors.shade);r(17,24,4,1,colors.rust);r(15,29,6,3,colors.cream);hat(7,5,colors.teal);r(21,9,3,3,colors.red);}
  else if(hats){
    hat(7,5,colors.shade);
    for(let i=0;i<d.hats;i++){const cc=[colors.shade,colors.rust,colors.blue,colors.green,colors.ochre][i];hat(7,5-i*5,cc);}
    if(!d.hats){
      if(d.reward==='gold')bag(10,-10,.85);
      else {r(12,-5,13,10,colors.dark);r(10,-2,17,5,colors.dark);r(17,-8,3,4,colors.shade);r(19,-10,3,2,colors.gold);r(23,-12,2,2,colors.red);r(15,-3,3,3,'#7b7664');}
    }
  } else {
    hat(5,5,dandy?colors.purple:farmer?colors.sand:colors.shade);
    if(!farmer&&!dandy){poly([[12,26],[24,26],[19,35]],colors.rust);r(9,28,4,3,colors.red);}
  }
  // Explicit prop shapes are the gameplay cue. No colour-only judgement.
  if(armed){
    r(24,30,7,5,coat);r(28,25,6,8,skin);r(29,22,4,8,colors.dark);
    r(27,20,9,5,'#a8aaa0');r(29,20,5,2,'#d2d1b5');r(32,22,3,2,colors.dark);r(28,25,3,3,colors.shade);
  } else if(farmer||lady||(dandy&&d.harmless)){
    r(25,38,6,5,skin);bag(23,34,.85);
  } else {r(5,44,5,4,skin);r(27,44,5,4,skin);r(26,41,3,7,colors.dark);}
  if(d.phase==='hit'){text('✦',18,20,17,colors.gold,'center');}
  ctx.restore();
}
const doorXs=[57,195,333];
function doors(attract=false) {
  doorXs.forEach((x,lane)=>{
    const number=game.group*3+lane+1;
    rect(x-5,91,99,138,colors.shade);rect(x-3,92,95,134,colors.sand);
    rect(x,106,89,115,colors.dark);rect(x+3,108,83,113,'#373630');
    rect(x+4,110,81,24,'#4d4333');
    // Interior walls and floor recede into the bank.
    rect(x+7,113,73,1,'#65513a');rect(x+11,118,65,1,'#4a4938');
    rect(x+2,207,85,14,'#82734e');poly([[x+2,207],[x+21,195],[x+68,195],[x+87,207]],'#615a41');
    const d=game.doors[lane];
    let openness=d?1:0;
    if(d?.phase==='opening')openness=d.phaseAge/12;
    if(d?.phase==='closing')openness=1-d.phaseAge/12;
    if(attract){openness=lane===1?.8:lane===0?.13:.15;}
    ctx.save();ctx.beginPath();ctx.rect(x,106,89,115);ctx.clip();
    if(d)character(x+44,219,d);
    else if(attract&&lane===1)character(x+44,219,{kind:'outlaw',age:10,phase:'waiting',hats:5});
    const leaf=Math.round(45*(1-openness));
    for(let side=0;side<2;side++){
      const dx=side===0?x:x+89-leaf;
      if(leaf>0){
        rect(dx,106,leaf,115,colors.wood);rect(dx+1,107,Math.max(0,leaf-2),112,colors.ochre);
        for(let j=0;j<3;j++){const xx=dx+j*14;rect(xx,108,1,110,colors.wood);rect(xx+2,109,1,106,colors.sand);}
        rect(dx,113,leaf,4,colors.sand);rect(dx,117,leaf,2,colors.shade);
        rect(dx,153,leaf,3,colors.sand);rect(dx,156,leaf,2,colors.wood);rect(dx,208,leaf,4,colors.sand);
        if(leaf>8){const hx=side===0?dx+leaf-6:dx+3;rect(hx,163,2,6,colors.dark);rect(hx,164,2,2,colors.gold);}
      }
    }
    ctx.restore();
    rect(x-3,102,95,5,colors.shade);rect(x-3,219,95,6,colors.shade);rect(x-1,219,91,2,colors.sand);
    // Number / deposited marker.
    rect(x+23,87,44,16,colors.shade);rect(x+25,88,40,12,colors.dark);
    text(String(number).padStart(2,'0'),x+45,90,9,game.deposits[number-1]?colors.gold:colors.sand,'center');
    if(game.deposits[number-1])star(x+58,94,3,colors.gold);
    rect(x+27,228,37,11,colors.dark);text(`[ ${lane+1} ]`,x+45,230,7,colors.sand,'center');
    if(d?.phase==='armed') {
      rect(x+20,109,49,12,colors.rust);text('DRAW!',x+44,111,8,colors.cream,'center');
      rect(x+4,215,81,2,colors.dark);rect(x+4,215,81*Math.max(0,1-d.phaseAge/d.window),2,colors.red);
    }
    if(d?.kind==='hats'&&d.phase==='reward'){text(d.reward==='gold'?'SHOOT GOLD':'HOLD FIRE',x+44,110,7,d.reward==='gold'?colors.gold:colors.cream,'center');}
    if(flashes[lane]&&!reducedMotion){
      const alpha=flashes[lane]/6;ctx.globalAlpha=alpha;star(x+44,180,15,colors.cream);ctx.globalAlpha=1;
      line(x+37,173,x+51,187,colors.gold,2);line(x+51,173,x+37,187,colors.gold,2);
    }
  });
}
function duel() {
  const night=game.night;
  rect(0,32,W,236,night?'#424953':'#bd9872');
  rect(0,83,W,185,night?'#8b7b5d':'#c6a86d');
  // A desert main street, with distant mountains and porch-front shops.
  poly([[0,98],[32,65],[50,84],[92,66],[130,102],[356,99],[391,59],[421,85],[456,66],[480,95]],night?'#69635c':'#a68262');
  for(const [x,width,height,c] of [[-20,117,90,colors.wood],[107,85,63,colors.ochre],[294,70,66,colors.wood],[376,125,103,colors.ochre]]) {
    rect(x,108-height/2,width,height,c);rect(x-3,108-height/2,width+6,4,colors.shade);
    for(let y=115-height/2;y<108+height/2;y+=9)rect(x,y,width,1,colors.shade);
    rect(x+12,112,20,28,colors.dark);rect(x+width-32,107,16,15,colors.dark);rect(x+9,145,width-18,3,colors.shade);
  }
  rect(1,92,89,15,colors.dark);text('S A L O O N',46,96,8,colors.sand,'center');
  rect(390,77,75,16,colors.dark);text('LIVERY',427,81,8,colors.sand,'center');
  cactus(254,132,.7);cactus(15,198,.7);cactus(470,210,.8);
  for(let i=0;i<24;i++)rect(i*41%480,166+i*13%90,4,1,colors.wood);
  text('H I G H  N O O N',240,46,17,colors.dark,'center','Georgia');
  const countdown=Math.ceil(game.duelTimer/HZ);
  text(countdown>0?`STEADY… ${countdown}`:'WAIT FOR THE GUNS',240,68,8,colors.shade,'center');
  for(let lane=0;lane<3;lane++) {
    const x=101+lane*138,d=game.doors[lane];
    rect(x-24,227,49,4,colors.wood);
    if(d){character(x,227,d);if(d.phase==='armed'){rect(x-26,119,52,13,colors.rust);text('DRAW!',x,121,9,colors.cream,'center');}}
    if(flashes[lane]&&!reducedMotion)star(x,185,14,colors.gold);
    rect(x-17,243,35,12,colors.dark);text(`[ ${lane+1} ]`,x,245,8,colors.sand,'center');
  }
}
function hud() {
  rect(0,0,W,32,colors.ink);rect(0,31,W,1,'#6f684d');
  text('SCORE',12,5,6,'#a7a184');text('$'+String(game.score).padStart(6,'0'),12,14,11,colors.gold);
  text(`DAY ${game.day} / SHIFT ${game.shift}`,173,5,7,colors.sand);
  // Ledger is the entire stage, rather than just the visible section.
  for(let i=0;i<9;i++){
    const x=174+i*11;rect(x,17,8,9,game.deposits[i]?colors.gold:'#4d5143');
    text(String(i+1),x+4,18,6,game.deposits[i]?colors.dark:'#9c9d82','center');
    if(Math.floor(i/3)===game.group)rect(x,28,8,1,colors.sand);
  }
  const seconds=Math.max(0,Math.ceil((game.time||MODES[game.mode].time*HZ)/HZ));
  text('TIME',309,5,6,'#a7a184');text(String(seconds).padStart(3,'0'),309,14,11,seconds<20?colors.red:colors.cream);
  text('LIVES',384,5,6,'#a7a184');
  for(let i=0;i<5;i++)star(389+i*15,20,5,i<game.lives?colors.gold:'#434a3c');
}
function bottom() {
  rect(0,267,W,33,colors.ink);rect(0,267,W,1,'#6f684d');
  let message=game.status==='title'?'THE GOLD RUSH IS ON. KEEP YOUR NERVE.':game.recovery?game.banner:game.bannerTime?game.banner:game.status==='duel'?'WAIT UNTIL EACH DUELLIST RAISES A GUN.':game.groupComplete?'SECTION FUNDED. MOVE ON WITH O / P OR THE ARROWS.':'LET CUSTOMERS DEPOSIT. SHOOT ONLY A DRAWN GUN.';
  const col=game.bannerTime&&game.bannerKind==='bad'?colors.red:game.bannerTime&&game.bannerKind==='good'?colors.gold:colors.sand;
  text(message,240,276,message.length>56?6:7,col,'center');
  text(game.status==='duel'?'THREE OUTLAWS. NO SECOND GUESSES.':`SECTION ${game.group+1} OF 3   ·   ${game.deposits.filter(Boolean).length} / 9 DEPOSITS`,240,289,6,'#95977c','center');
}
function render() {
  ctx.globalAlpha=1;
  if(game.status==='duel'||(game.status==='stageclear'&&game.duelDone===3))duel();
  else {background();doors(game.status==='title');}
  hud();bottom();
  for(const effect of effects)text(effect.text,101+effect.lane*138,130-(35-effect.life)*.5,9,effect.color,'center');
  if(damage>0){
    if(!reducedMotion){ctx.strokeStyle=colors.rust;ctx.lineWidth=6;ctx.strokeRect(3,34,474,231);}
    text('HOLD STEADY',240,254,8,colors.cream,'center');
  }
}
function syncState() {
  const active=['bank','duel'].includes(game.status)&&!game.paused;
  document.querySelectorAll('[data-fire]').forEach(b=>b.disabled=!active||Boolean(game.recovery));
  $('left').disabled=!active||game.status!=='bank'||game.group===0||game.doors.some(Boolean)||Boolean(game.recovery);
  $('right').disabled=!active||game.status!=='bank'||game.group===2||game.doors.some(Boolean)||Boolean(game.recovery);
  if(game.status===lastStatus)return;
  lastStatus=game.status;
  if(game.status==='stageclear') {
    setOverlay('GOOD SHOOTING',`Day ${game.day}, shift ${game.shift} — complete.`,`All nine deposits secured. Duel won. $500 bonus and one life earned. Total: $${game.score.toLocaleString()}.`,'NEXT SHIFT','stageclear');
  } else if(game.status==='gameover'||game.status==='victory'){
    const accuracy=game.shots?Math.round(game.hits/game.shots*100):0;
    setOverlay(game.status==='victory'?'LEGEND OF THE WEST':game.retired?'RUN FINISHED':'END OF THE TRAIL',game.status==='victory'?'Two days. Eighteen shifts. One legend.':game.retired?'Your badge, your call. Your score is kept.':'The frontier gets another chance tomorrow.',`$${game.score.toLocaleString()} · ${accuracy}% accuracy · Best draw: ${game.bestReaction===null?'—':game.bestReaction+' ms'}. Reached day ${game.day}, shift ${game.shift}.`,'PLAY AGAIN',game.status);
    record();finishRankedRun(rankedRun,game);
    if(!$('score-form').hidden)$('score-name').focus();else $('done').focus();
  }
}
function frame(now) {
  if(!lastTime)lastTime=now;
  const elapsed=now-lastTime;lastTime=now;
  // Bound catch-up to five ticks. Long browser stalls freeze excess wall time
  // rather than consuming an entire reaction window before rendering again.
  // Simulation steps remain exactly 20 ms; focus/visibility loss pauses outright.
  accumulator+=Math.min(elapsed,100);
  while(accumulator>=1000/HZ){
    const commands=queued;queued=[];
    for(const command of commands){
      captureAction(rankedRun,game,command.type==='shoot'?'s':'m',command.value);
      if(command.type==='shoot')game.shoot(command.value);else game.move(command.value);
    }
    game.tick();
    if(!game.paused){flashes=flashes.map(x=>Math.max(0,x-1));effects=effects.filter(x=>--x.life>0);damage=Math.max(0,damage-1);}
    accumulator-=1000/HZ;
  }
  syncState();render();requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
