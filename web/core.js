// Sources -> per-channel signal -> 'frame' events. Owns connect/simulate and status.
import { emit, on, VOICES } from './bus.js';
import { connectSerial, simFill, startSim } from './serial.js';
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
// Open the page with ?fill=sim to debug with fewer sensors than voices: the real
// sensor plays the voice chosen by 'route' (default drums) and the rest are simulated.
// Read at click time, not import time, so Node can still load this module.
const fillMissing = () => new URLSearchParams(globalThis.location?.search).get('fill') === 'sim';
let route = 0;
let filling = false;
const announce = () => emit('sensor', filling ? route : null);
on('route', (ch) => {
  if (!Number.isInteger(ch) || ch < 0 || ch >= VOICES.length) return;
  route = ch;
  announce();
});
on('connect', go((onFrame, onClose) => {
  filling = fillMissing();
  announce();
  return connectSerial(filling ? simFill(onFrame, () => route) : onFrame, onClose);
}));
on('simulate', go((onFrame, onClose) => {
  filling = false;
  announce();
  return startSim(onFrame, onClose);
}));
emit('sensor', null);
emit('status', 'idle');
