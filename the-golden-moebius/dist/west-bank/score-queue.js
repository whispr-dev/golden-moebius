// Keep completed, unposted runs across menu changes and page reloads.
export const QUEUE_KEY='westbank.ranked.pending.v1';
export const MAX_AGE=24*60*60*1000;
export function readQueue(storage,now=Date.now()){
  try{
    const data=JSON.parse(storage.getItem(QUEUE_KEY)||'[]');
    if(!Array.isArray(data))return [];
    return data.filter(r=>r&&typeof r.ticket==='string'&&typeof r.key==='string'&&['easy','classic','hard'].includes(r.mode)&&Number.isFinite(r.savedAt)&&r.savedAt<=now&&now-r.savedAt<MAX_AGE&&Number.isInteger(r.score)&&r.score>0&&Number.isInteger(r.ticks)&&Array.isArray(r.actions)).slice(-6);
  }catch{return [];}
}
export function writeQueue(storage,queue){try{storage.setItem(QUEUE_KEY,JSON.stringify(queue));return true;}catch{return false;}}
export function addRun(queue,run){
  // Reserve one best candidate per difficulty when six saved slots are full.
  const next=queue.filter(r=>r.ticket!==run.ticket).concat(run);
  if(next.length<=6)return next;
  const protectedRuns=new Set();
  for(const mode of ['easy','classic','hard']){
    const best=next.filter(r=>r.mode===mode).sort((a,b)=>b.score-a.score)[0];if(best)protectedRuns.add(best);
  }
  const discard=next.findIndex(r=>r!==run&&!protectedRuns.has(r));
  next.splice(discard>=0?discard:0,1);return next;
}
