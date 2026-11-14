// Frames -> notes. Owns the trigger mode, the active kit, and the master chain.
import * as Tone from 'https://cdn.jsdelivr.net/npm/tone@15.0.4/+esm';
import { emit, on, VOICES } from '../bus.js';
import { mapVoice, tempoFrom } from './mapping.js';
import { KITS } from './kits.js';

// Fire a voice on every Nth event (event = beat in 'beats' mode, 16th step in 'bits' mode).
// bits: drums on 8ths, bass on quarters, lead every 3 sixteenths (a dotted-8th
// cycle against the bar), pad once a bar.
const DIV = {
  beats: { drums: 1, bass: 1, lead: 1, pad: 4 },
  bits: { drums: 2, bass: 4, lead: 3, pad: 16 },
};
// bits mode: glide the transport to the players' mean heart rate instead of a fixed tempo.
const FOLLOW_TEMPO = true;

const master = new Tone.Gain().toDestination();
const wave = new Tone.Waveform(256);
const fft = new Tone.FFT(64);
master.fan(wave, fft);

let kitName = Object.keys(KITS)[0]; // first kit is the default
let kit = KITS[kitName](master);
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
  const n = { voice, ...p, kit: kitName };
  Tone.getDraw().schedule(() => emit('note', n), time); // fires when audible
}

on('frame', ({ raws, ch }) => {
  last = raws;
  fingers = ch.map((c) => c.finger);
  if (mode === 'beats') ch.forEach((c, i) => c.beat && fire(i));
  else if (FOLLOW_TEMPO) followTempo(ch);
});

let tempoAt = 0;
function followTempo(ch) {
  const now = Tone.now();
  if (now - tempoAt < 1) return; // re-aim once a second, not 50 times
  tempoAt = now;
  const bpm = tempoFrom(ch);
  if (bpm && Math.abs(bpm - transport.bpm.value) > 0.5) transport.bpm.rampTo(bpm, 2);
}

const transport = Tone.getTransport();
transport.bpm.value = 110; // bits-mode start tempo; FOLLOW_TEMPO takes over once BPMs read
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
  kitName = name;
  kit = KITS[name](master);
  old.silence();
  // Let release and effect tails ring out before freeing the old kit's nodes.
  setTimeout(() => old.dispose(), (old.tail ?? 3) * 1000);
});

emit('kits', Object.keys(KITS));
emit('analyser', { wave, fft });
