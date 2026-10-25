// Simulation contract: all durations are integer ticks at 50 Hz. Rendering never
// advances the world. The injected seed makes encounters reproducible in tests.
export const HZ = 50;
export const LAST_STAGE = 18;
export const MODES = Object.freeze({
  easy: { label: 'Tenderfoot', reaction: 1.45, time: 150 },
  classic: { label: 'Deputy', reaction: 1, time: 120 },
  hard: { label: 'Gunslinger', reaction: .75, time: 105 }
});
export class Game {
  constructor({ seed = Date.now(), mode = 'classic', emit = () => {} } = {}) {
    this.seed = seed >>> 0 || 1;
    this.mode = Object.hasOwn(MODES, mode) ? mode : 'classic';
    this.emit = emit;
    this.status = 'title';
    this.paused = false;
    this.score = 0;
    this.lives = 3;
    this.stage = 1;
    this.group = 0;
    this.tickCount = 0;
    this.shots = 0;
    this.hits = 0;
    this.bestReaction = null;
    this.reactions = [];
    this.deposits = Array(9).fill(false);
    this.doors = Array(3).fill(null);
    this.cooldown = [0, 0, 0];
    this.banner = 'YOUR SHIFT STARTS HERE';
    this.bannerTime = 0;
  }
  random() {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }
  int(a, b) { return a + Math.floor(this.random() * (b - a + 1)); }
  say(message, kind = 'info', duration = 110) {
    this.banner = message; this.bannerKind = kind; this.bannerTime = duration;
    this.emit({ type: 'message', message, kind });
  }
  start() {
    this.status = 'bank'; this.paused = false; this.score = 0; this.lives = 3;
    this.stage = 1; this.retired = false; this.shots = 0; this.hits = 0; this.tickCount = 0;
    this.bestReaction = null; this.reactions = []; this.resetStage();
  }
  finish() {
    if (!['bank','duel','stageclear'].includes(this.status)) return false;
    this.paused = false; this.status = 'gameover'; this.retired = true;
    this.say('BADGE HANDED IN — RUN FINISHED', 'info');
    this.emit({ type: 'end' }); return true;
  }
  resetStage() {
    this.status = 'bank'; this.group = 0; this.deposits = Array(9).fill(false);
    this.doors = Array(3).fill(null); this.cooldown = [0,0,0];
    this.time = MODES[this.mode].time * HZ; this.nextSpawn = 60;
    this.recovery = 0; this.duelRestart = false; this.groupVisits = Array(9).fill(0);
    this.say(`DAY ${this.day} / SHIFT ${this.shift} — COLLECT ALL 9 DEPOSITS`);
  }
  get day() { return Math.floor((this.stage - 1) / 9) + 1; }
  get shift() { return (this.stage - 1) % 9 + 1; }
  get night() { return this.shift >= 8; }
  get reactionWindow() {
    return Math.max(16, Math.round((48 - (this.stage - 1) * 1.7) * MODES[this.mode].reaction));
  }
  get groupComplete() { return this.deposits.slice(this.group*3, this.group*3+3).every(Boolean); }
  move(direction) {
    if (this.paused || this.status !== 'bank' || this.recovery) return false;
    if (!Number.isFinite(direction) || direction === 0) return false;
    if (this.doors.some(Boolean)) { this.say('WAIT FOR THE DOORS TO CLOSE', 'info', 45); return false; }
    const next = this.group + Math.sign(direction);
    if (next < 0 || next > 2) return false;
    this.group = next; this.nextSpawn = 35;
    this.emit({ type: 'move' });
    this.say(`DOORS ${next * 3 + 1}–${next * 3 + 3} — KEEP YOUR EYES OPEN`, 'info', 60);
    return true;
  }
  spawn(lane, kind, overrides = {}) {
    const hostage = kind === 'dandy' && this.random() < .52;
    this.doors[lane] = {
      kind, age: 0, phase: 'opening', phaseAge: 0, opening: 12,
      wait: this.int(45, 95), window: this.reactionWindow,
      hats: 5, reward: this.random() < .55 ? 'gold' : 'bomb',
      harmless: ['farmer','lady'].includes(kind) || hostage,
      appearance: this.int(0, 2), resolved: false,
      ...overrides
    };
    this.emit({ type: 'door', lane });
    return this.doors[lane];
  }
  chooseKind(lane) {
    const door = this.group * 3 + lane;
    // Guarantee an unfilled door a customer within three scheduled visits.
    // Every group is completable; randomness cannot starve a deposit forever.
    this.groupVisits[door] = (this.groupVisits[door] || 0) + 1;
    if (!this.deposits[door] && (this.groupVisits[door] >= 3 || this.random() < .5)) {
      return this.random() < .5 ? 'farmer' : 'lady';
    }
    const pool = ['outlaw', 'draw', 'farmer', 'lady'];
    if (this.stage >= 2) pool.push('hats');
    if (this.stage >= 3) pool.push('dandy');
    if (this.stage >= 5) pool.push('quickdraw');
    if (this.stage >= 6) pool.push('mystery');
    return pool[this.int(0, pool.length-1)];
  }
  deposit(lane, amount = 100) {
    this.deposits[this.group * 3 + lane] = true;
    this.score += amount;
    this.say(`+$${amount} — DEPOSIT RECEIVED`, 'good', 55);
    this.emit({ type: 'deposit', lane });
  }
  close(d) { d.phase = 'closing'; d.phaseAge = 0; d.resolved = true; }
  lose(message) {
    if (!['bank','duel'].includes(this.status) || this.recovery) return;
    this.lives--;
    this.say(message, 'bad', 85); this.emit({ type: 'hurt' });
    this.doors = Array(3).fill(null); this.cooldown = [0,0,0];
    if (this.lives <= 0) { this.status = 'gameover'; this.emit({ type: 'end' }); }
    else { this.recovery = 85; this.nextSpawn = 45; if (this.status === 'duel') this.duelRestart = true; }
  }
  shoot(lane) {
    if (this.paused || !['bank','duel'].includes(this.status) || this.recovery || !Number.isInteger(lane) || lane<0 || lane>2 || this.cooldown[lane]) return false;
    this.cooldown[lane] = 5; this.shots++; this.emit({ type: 'shot', lane });
    const d = this.doors[lane];
    if (!d || ['opening','closing','hit'].includes(d.phase)) return false;
    if (d.kind === 'hats') {
      if (d.hats > 0) {
        d.hats--; this.hits++; this.score += 10; this.emit({ type: 'hat', lane });
        d.wait = Math.max(d.wait, d.phaseAge + 100);
        if (!d.hats) { d.phase = 'reward'; d.phaseAge = 0; }
        return true;
      }
      if (d.reward === 'bomb') { this.lose('THAT WAS A BOMB. LEAVE IT ALONE!'); return false; }
      this.hits++; this.deposit(lane, 250); this.close(d); return true;
    }
    if (d.phase === 'armed') {
      this.hits++;
      const reaction = Math.max(20, (this.tickCount - d.armedAt) * 20);
      this.reactions.push(reaction);
      this.bestReaction = this.bestReaction === null ? reaction : Math.min(this.bestReaction, reaction);
      const points = 150 + Math.max(0, Math.floor((d.window - d.phaseAge) / 5) * 10);
      this.score += points;
      this.say(`+$${points} — ${reaction} MS. NICE SHOOTING.`, 'good', 55);
      d.phase = 'hit'; d.phaseAge = 0; d.resolved = true;
      this.emit({ type: 'hit', lane });
      return true;
    }
    if (d.harmless) this.lose('INNOCENT CUSTOMER! HOLD YOUR FIRE.');
    else this.lose('TOO EARLY! WAIT UNTIL THE GUN IS DRAWN.');
    return false;
  }
  beginDuel() {
    this.status = 'duel'; this.duelTimer = 150; this.duelDone = 0;
    this.doors = Array(3).fill(null); this.cooldown = [0,0,0];
    const order = [0,1,2];
    for (let i=2;i>0;i--) { const j=this.int(0,i); [order[i],order[j]]=[order[j],order[i]]; }
    order.forEach((lane,i)=> this.spawn(lane, 'draw', { phase:'waiting', wait: 150 + i*55 + this.int(0,20), window: this.reactionWindow + 5, opening:0 }));
    this.say('HIGH NOON — WAIT FOR EACH GUN', 'info', 120);
    this.emit({type:'duel'});
  }
  advance() {
    if (this.status !== 'stageclear') return false;
    this.stage++; this.resetStage(); return true;
  }
  tick() {
    if (this.paused || !['bank','duel'].includes(this.status)) return;
    this.tickCount++;
    if (this.bannerTime > 0) this.bannerTime--;
    this.cooldown = this.cooldown.map(t=> Math.max(0,t-1));
    if (this.recovery) {
      this.recovery--;
      if (!this.recovery && this.duelRestart) { this.duelRestart = false; this.beginDuel(); }
      return;
    }
    if (this.status === 'bank') {
      this.time--;
      if (this.time <= 0) { this.time = MODES[this.mode].time*HZ; this.lose('SHIFT RAN OUT. THE BANK NEEDS THOSE DEPOSITS!'); return; }
      if (this.deposits.every(Boolean) && !this.doors.some(Boolean)) { this.beginDuel(); return; }
      if (!this.groupComplete && --this.nextSpawn <= 0) {
        const free = [0,1,2].filter(i => !this.doors[i]);
        const active = this.doors.filter(Boolean).length;
        const maxActive = this.stage >= 4 ? 3 : 2;
        if (free.length && active < maxActive) {
          const unfilled = free.filter(i=> !this.deposits[this.group*3+i]);
          const candidates = unfilled.length ? unfilled : free;
          const lane = candidates[this.int(0,candidates.length-1)];
          this.spawn(lane,this.chooseKind(lane));
        }
        this.nextSpawn = this.int(38,70);
      }
      if (this.groupComplete && !this.doors.some(Boolean) && this.bannerTime === 0) this.say('THIS SECTION IS FUNDED. MOVE TO THE NEXT DOORS.', 'good', 95);
    } else this.duelTimer = Math.max(0,this.duelTimer-1);
    for (let lane=0;lane<3;lane++) {
      const d = this.doors[lane]; if (!d) continue;
      d.age++; d.phaseAge++;
      if (d.phase === 'opening' && d.phaseAge >= d.opening) {
        d.phaseAge=0;
        d.phase = ['outlaw','quickdraw'].includes(d.kind) ? 'armed' : 'waiting';
        if (d.phase === 'armed') { d.armedAt=this.tickCount; if(d.kind==='quickdraw')d.window=Math.max(16,d.window-6); this.emit({type:'draw',lane}); }
      } else if (d.phase === 'waiting') {
        if (d.kind==='hats') { if(d.phaseAge>=220)this.close(d); }
        else if (d.harmless) {
          if (d.phaseAge>=85) { this.deposit(lane); this.close(d); }
        } else if (d.phaseAge>=d.wait) { d.phase='armed'; d.phaseAge=0; d.armedAt=this.tickCount; this.emit({type:'draw',lane}); }
      } else if (d.phase==='reward' && d.phaseAge>=120) this.close(d);
      else if (d.phase==='armed' && d.phaseAge>=d.window) { this.lose('OUTDRAWN! WATCH FOR THE RAISED PISTOL.'); return; }
      else if ((d.phase==='closing' && d.phaseAge>=12) || (d.phase==='hit' && d.phaseAge>=22)) {
        this.doors[lane]=null;
        if(this.status==='duel') this.duelDone++;
      }
    }
    if(this.status==='duel' && this.duelDone===3) {
      this.score+=500; this.lives=Math.min(5,this.lives+1);
      this.status=this.stage===LAST_STAGE?'victory':'stageclear';
      this.say('DUEL WON — $500 BONUS + ONE LIFE', 'good'); this.emit({type:'clear'});
      if(this.status==='victory')this.emit({type:'end'});
    }
  }
}
