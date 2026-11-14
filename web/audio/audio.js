// Frames -> notes. Owns the trigger mode, the active kit, and the master chain.
import * as Tone from 'https://cdn.jsdelivr.net/npm/tone@15.0.4/+esm';
import { emit, on, VOICES } from '../bus.js';
import { mapVoice } from './mapping.js';
import { KITS } from './kits.js';

// Fire a voice on every Nth event (event = beat in 'beats' mode, 16th step in 'bits' mode).
const DIV = {
  beats: { drums: 1, bass: 1, lead: 1, pad: 4 },
  bits: { drums: 1, bass: 2, lead: 2, pad: 16 },
};

const master = new Tone.Gain().toDestination();
const wave = new Tone.Waveform(256);
const fft = new Tone.FFT(64);
master.fan(wave, fft);

let kit = KITS.basic(master);
let mode = 'beats';
let last = [0, 0, 0, 0];
let fingers = [];
let counts = [0, 0, 0, 0];
let lastT = [0, 0, 0, 0];   // mono synths reject two triggers at the same instant

function fire(i, time = Tone.now()) {
  const voice = VOICES[i];
  if (++counts[i] % DIV[mode][voice]) return;
  time = lastT[i] = Math.max(time, lastT[i] + 0.01);
  const p = mapVoice(voice, last[i]);
  kit[voice](p, time);
  Tone.getDraw().schedule(() => emit('note', { voice, ...p }), time); // fires when audible
}

on('frame', ({ raws, ch }) => {
  last = raws;
  fingers = ch.map((c) => c.finger);
  if (mode === 'beats') ch.forEach((c, i) => c.beat && fire(i));
});

const transport = Tone.getTransport();
transport.bpm.value = 110; // ponytail: fixed tempo for bits mode; tune by ear
transport.scheduleRepeat((time) => {
  if (mode === 'bits') fingers.forEach((f, i) => f && fire(i, time));
}, '16n');

const begin = () => Tone.start(); // runs inside the click: browsers need a gesture for audio
on('connect', begin);
on('simulate', begin);
on('status', (s) => {
  counts = [0, 0, 0, 0];
  if (s === 'running') return transport.start();
  fingers = [];
  kit.silence();
});
on('mode', (m) => { mode = m; counts = [0, 0, 0, 0]; });
on('kit', (name) => {
  if (!KITS[name]) return;
  const old = kit;
  kit = KITS[name](master);
  old.silence();
  // Let release and effect tails ring out before freeing the old kit's nodes.
  setTimeout(() => old.dispose(), (old.tail ?? 3) * 1000);
});

emit('kits', Object.keys(KITS));
emit('analyser', { wave, fft });
