// Sources -> per-channel signal -> 'frame' events. Owns connect/simulate and status.
import { emit, on, VOICES } from './bus.js';
import { connectSerial, startSim } from './serial.js';
import { createChannel } from './signal.js';

let stop = null;
let run = null;      // identifies the active source, so a stale onClose is ignored
let channels = [];

function onFrame(raws) {
  emit('frame', { raws, ch: raws.map((raw, i) => channels[i](raw)) });
}

export async function start(source) {
  const me = (run = {});
  await stop?.();
  stop = null;
  channels = VOICES.map(() => createChannel(50));
  stop = await source(onFrame, () => run === me && emit('status', 'disconnected'));
  emit('status', 'running');
}

const go = (source) => () => start(source).catch((e) => emit('status', `error: ${e.message}`));
on('connect', go(connectSerial));
on('simulate', go(startSim));
emit('status', 'idle');
