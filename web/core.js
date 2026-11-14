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
  const prev = stop;
  stop = null; // take ownership before awaiting: concurrent starts must not re-stop it
  await prev?.();
  if (run !== me) return;
  channels = VOICES.map(() => createChannel(50));
  try {
    const s = await source((raws) => run === me && onFrame(raws), () => run === me && emit('status', 'disconnected'));
    if (run !== me) return void (await s?.());
    stop = s;
    emit('status', 'running');
  } catch (e) {
    if (run === me) throw e; // a superseded run's failure is not the current status
  }
}

const go = (source) => () => start(source).catch((e) => emit('status', `error: ${e.message}`));
on('connect', go(connectSerial));
on('simulate', go(startSim));
emit('status', 'idle');
