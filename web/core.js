// Sources -> per-channel signal -> 'frame' events. Owns connect/simulate and status.
import { emit, on, VOICES } from './bus.js';
import { connectSerial, startSim } from './serial.js';
import { createChannel } from './signal.js';

let stop = null;
let run = null;                   // latest requested run; older ones are stale
let queue = Promise.resolve();    // starts run one at a time, so a stop never overlaps an open
let channels = [];

function onFrame(raws) {
  emit('frame', { raws, ch: raws.map((raw, i) => channels[i](raw)) });
}

export function start(source) {
  const me = (run = {});
  const job = queue.then(async () => {
    if (run !== me) return;       // superseded before we began; the newer job handles it
    const prev = stop;
    stop = null;
    await prev?.();
    channels = VOICES.map(() => createChannel(50));
    stop = await source(
      (raws) => run === me && onFrame(raws),
      () => run === me && emit('status', 'disconnected'),
    );                            // stored even if superseded: the next queued job stops it
    if (run === me) emit('status', 'running');
  });
  queue = job.catch(() => {});
  return job.catch((e) => { if (run === me) throw e; });  // stale failures stay quiet
}

const go = (source) => () => start(source).catch((e) => emit('status', `error: ${e.message}`));
on('connect', go(connectSerial));
on('simulate', go(startSim));
emit('status', 'idle');
