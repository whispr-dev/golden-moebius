import { parentPort, workerData, isMainThread } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

export async function verifyReplay(payload, enginePath) {
  const { Game } = await import(pathToFileURL(enginePath).href);
  const { seed, mode, ticks, actions } = payload;
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff || !['easy','classic','hard'].includes(mode)) throw Error('Invalid run.');
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 360000 || !Array.isArray(actions) || actions.length > 20000) throw Error('Run exceeds replay limits.');
  let previous = -1, perTick = 0;
  for (const a of actions) {
    if (!Array.isArray(a) || a.length !== 3 || !Number.isInteger(a[0]) || a[0] < previous || a[0] > ticks || a[0] < 0) throw Error('Invalid action order.');
    perTick = a[0] === previous ? perTick + 1 : 1; previous = a[0];
    if (perTick > 8 || !(['s','m','a','q'].includes(a[1])) || !Number.isInteger(a[2]) || (a[1] === 's' ? a[2] < 0 || a[2] > 2 : a[1] === 'm' ? ![-1,1].includes(a[2]) : a[2] !== 0)) throw Error('Invalid action.');
  }
  const game = new Game({ seed, mode }); game.start(); let index = 0;
  for (let tick = 0; tick <= ticks; tick++) {
    if (game.tickCount !== tick) throw Error('Replay stalled.');
    while (index < actions.length && actions[index][0] === tick) {
      const [,kind,value] = actions[index++];
      if (kind === 'a') { if (game.status !== 'stageclear') throw Error('Invalid shift advance.'); game.advance(); }
      else if (kind === 'q') { if (!game.finish()) throw Error('Invalid run finish.'); }
      else if (kind === 's') game.shoot(value);
      else game.move(value);
    }
    if (tick === ticks) break;
    if (!['bank','duel'].includes(game.status)) throw Error('Run ended before its replay.');
    game.tick();
  }
  if (index !== actions.length || !['gameover','victory'].includes(game.status) || game.score <= 0) throw Error('Finish a game with a positive score before posting.');
  return { score: game.score, stage: game.stage, victory: game.status === 'victory', shots: game.shots, hits: game.hits, ticks: game.tickCount };
}
if (!isMainThread) {
  try { parentPort.postMessage({ result: await verifyReplay(workerData.payload, workerData.enginePath) }); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
}
