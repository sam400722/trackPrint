// Frames -> notes. One heart-driven 16th-note grid (docs/superpowers/specs/2026-11-14-heart-mapping-design.md):
// the drum finger sets the tempo, the tempo band picks the patterns, each finger
// shapes its own voice's timbre, and raw bits pick pitch and velocity.
import * as Tone from 'https://cdn.jsdelivr.net/npm/tone@15.0.4/+esm';
import { emit, on, VOICES } from '../bus.js';
import { mapVoice } from './mapping.js';
import { KITS } from './kits.js';
import { createHeart, HEART_OFF } from './heart.js';
import { createTempo, band as bandFor, TEMPO_DEFAULT } from './tempo.js';
import { DRUM_PATTERNS, BASS_PATTERNS, PAD_EVERY, isOff8th, leadLevel, LEAD_STEPS } from './patterns.js';

const [DRUMS, BASS, LEAD, PAD] = [0, 1, 2, 3]; // channel indexes

// Kits -> master -> glue compressor -> limiter -> speakers. The analysers tap the
// limiter so the visuals see exactly the final mix.
const master = new Tone.Gain();
const comp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.2 });
const limiter = new Tone.Limiter(-1);
master.chain(comp, limiter, Tone.getDestination());
const wave = new Tone.Waveform(256);
const fft = new Tone.FFT(64);
limiter.fan(wave, fft);

let kitName = Object.keys(KITS)[0]; // first kit is the default
let kit = KITS[kitName](master);

// Heart trackers and tempo live outside the kit, so they survive a kit switch.
let trackers, hearts, tempo, target, band, pendingBand, step, leadLvl, arpI, wasOn, lastT;
let last = [0, 0, 0, 0];
let bar = { bass: [], lead: [], pad: [] }; // per-bar pitch picks
function reset() {
  trackers = VOICES.map(() => createHeart(50));
  hearts = VOICES.map(() => HEART_OFF);
  tempo = createTempo();
  target = TEMPO_DEFAULT;
  band = pendingBand = 'slow';
  step = 0;
  leadLvl = null;
  arpI = 0;
  wasOn = VOICES.map(() => false);
  lastT = {}; // per synth: mono synths reject two triggers at the same instant
}
reset();

on('frame', ({ raws, ch }) => {
  last = raws;
  hearts = ch.map((c, i) => trackers[i](c));
});

function play(voice, p, heart, time, key = voice) {
  time = lastT[key] = Math.max(time, (lastT[key] ?? 0) + 0.01);
  kit[voice](p, heart, time);
  const n = { voice, ...p, kit: kitName };
  Tone.getDraw().schedule(() => emit('note', n), time); // fires when audible
}

function pickBar() {
  bar.bass = mapVoice('bass', last[BASS]).notes;
  bar.lead = mapVoice('lead', last[LEAD]).notes;
  bar.pad = mapVoice('pad', last[PAD]).notes;
  arpI = 0;
}

const transport = Tone.getTransport();
transport.bpm.value = TEMPO_DEFAULT;

transport.scheduleRepeat((time) => {
  const s = step++ % 16;

  // 1. Tempo from the drum finger; glide to each new target over 2 bars.
  const next = tempo(hearts[DRUMS]);
  if (next !== target) {
    target = next;
    transport.bpm.rampTo(target, (8 * 60) / transport.bpm.value, time);
  }
  pendingBand = bandFor(target, pendingBand);

  // 2. Bar boundary: band changes land here, and the bits pick new pitches.
  if (s === 0) {
    band = pendingBand;
    pickBar();
  } else if (s % PAD_EVERY[band] === 0) {
    bar.pad = mapVoice('pad', last[PAD]).notes; // fast band: a second chord mid-bar
  }
  kit.update({ drums: hearts[DRUMS], bass: hearts[BASS], lead: hearts[LEAD], pad: hearts[PAD] }, time);

  // 3. Voices with a finger on fire from their pattern or step rate.
  VOICES.forEach((voice, i) => {
    const h = hearts[i];
    if (!h.on) {
      if (wasOn[i]) kit.lift(voice); // pad releases; bass and lead finish their envelopes
      wasOn[i] = false;
      return;
    }
    wasOn[i] = true;
    const bits = mapVoice(voice, last[i]); // velocity (and cutoff) from this step's raw value

    if (i === DRUMS) {
      for (const drum of ['kick', 'snare', 'hat']) {
        if (!DRUM_PATTERNS[band][drum][s]) continue;
        const accent = drum === 'hat' && isOff8th(s) ? 0.5 : 1;
        const velocity = (0.5 + 0.5 * h.press) * bits.velocity * accent;
        play('drums', { drum, velocity }, h, time, drum);
      }
    } else if (i === BASS) {
      if (BASS_PATTERNS[band][s]) play('bass', { ...bits, notes: bar.bass }, h, time);
    } else if (i === LEAD) {
      leadLvl = leadLevel(h.hr, leadLvl);
      const every = LEAD_STEPS[leadLvl];
      if (s % every === 0) {
        const note = bar.lead[arpI++ % bar.lead.length];
        const duration = every * Tone.Time('16n').toSeconds();
        play('lead', { ...bits, notes: [note], velocity: 0.4 + 0.6 * h.press, duration }, h, time);
      }
    } else if (s % PAD_EVERY[band] === 0) {
      play('pad', { ...bits, notes: bar.pad }, h, time);
    }
  });
}, '16n');

const begin = () => Tone.start(); // runs inside the click: browsers need a gesture for audio
on('connect', begin);
on('simulate', begin);
on('status', (s) => {
  if (s === 'running') {
    transport.start();
    return;
  }
  kit.silence();
  reset();
  transport.bpm.cancelScheduledValues(0);
  transport.bpm.value = TEMPO_DEFAULT;
});
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
