// Sound kits. A kit is a spec of voice presets; makeKit turns it into a builder
// `(out) => Kit` whose instruments connect only to `out`.
// Kit = { drums, bass, lead, pad, update(hearts, t), lift(voice), silence(), dispose(), ready, tail }.
// Each voice is (params, heart, time) => void, where heart is that finger's heart.js state.
import * as Tone from 'https://cdn.jsdelivr.net/npm/tone@15.0.4/+esm';

const midi = (m) => Tone.Frequency(m, 'midi').toNote();
const gain = (add, db = 0) => add(new Tone.Gain(Tone.dbToGain(db)));

// Heart rate drives timbre: clamp to 55..110, then map linearly or exponentially.
const hr01 = (hr) => (Math.min(110, Math.max(55, hr)) - 55) / 55;
const hrLin = (hr, lo, hi) => lo + (hi - lo) * hr01(hr);
const hrExp = (hr, lo, hi) => lo * (hi / lo) ** hr01(hr);

// Every voice factory takes ctx = { add, dest, verb } and a preset.
// `add` registers a node for dispose, `dest` is the kit bus, `verb` the kit reverb.
function sends(ctx, node, o) {
  node.connect(ctx.dest);
  if (o.verb != null) node.connect(gain(ctx.add, o.verb).connect(ctx.verb));
}

// ---------------------------------------------------------------- drums
// Pieces: kick, snare, clap, hat, openhat, tom. Unknown names play the closed hat.
// Velocity changes level everywhere, and decay on kick, snare and closed hat.
//   kick:  sine body with a pitch sweep, optional noise `click` (dB) for attack, and
//          optional `drive` (0..1) through a tanh saturator for weight.
//   snare: optional pitched `body` (MembraneSynth) plus white or pink noise through a
//          high-pass / low-pass pair. No body + slow attack = a brush.
//   hats:  `kind` 'metal' (MetalSynth, clangy and bright) or 'noise' (filtered noise,
//          softer). One synth serves closed and open hats, so a closed hat chokes an open one.
function drums(ctx, o) {
  const { add } = ctx;
  const bus = gain(add, o.level);
  if (o.crush) {
    const crush = add(new Tone.BitCrusher({ bits: o.crush, wet: o.crushWet ?? 0.5 }));
    bus.connect(crush);
    sends(ctx, crush, o);
  } else sends(ctx, bus, o);

  // kick
  const K = o.kick;
  let kickOut = bus;
  if (K.drive) {
    const k = 1 + 4 * K.drive; // unity at full scale, more gain (fatter) on the decay
    kickOut = add(new Tone.WaveShaper((x) => Math.tanh(k * x) / Math.tanh(k), 1024)).connect(bus);
  }
  const kick = add(new Tone.MembraneSynth({
    pitchDecay: K.pitchDecay, octaves: K.octaves, oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: K.decay, sustain: 0, release: 0.05 },
    volume: K.volume ?? 0,
  })).connect(kickOut);
  let click = null;
  if (K.click != null) {
    const clickFilter = add(new Tone.Filter({ type: 'bandpass', frequency: 3500, Q: 0.7 })).connect(kickOut);
    click = add(new Tone.NoiseSynth({
      envelope: { attack: 0.0005, decay: 0.006, sustain: 0, release: 0.005 }, volume: K.click,
    })).connect(clickFilter);
  }

  // snare
  const S = o.snare;
  const snareLp = add(new Tone.Filter({ type: 'lowpass', frequency: S.lp ?? 10000 })).connect(bus);
  const snareHp = add(new Tone.Filter({ type: 'highpass', frequency: S.hp ?? 1500 })).connect(snareLp);
  const snare = add(new Tone.NoiseSynth({
    noise: { type: S.noise ?? 'white' },
    envelope: { attack: S.attack ?? 0.001, decay: S.decay, sustain: 0, release: 0.02 },
    volume: S.volume ?? -4,
  })).connect(snareHp);
  const snareBody = S.body == null ? null : add(new Tone.MembraneSynth({
    pitchDecay: 0.03, octaves: 1.5, oscillator: { type: S.bodyType ?? 'triangle' },
    envelope: { attack: 0.001, decay: S.bodyDecay ?? 0.1, sustain: 0, release: 0.02 },
    volume: (S.volume ?? -4) - 4,
  })).connect(bus);

  // clap
  const clapFilter = add(new Tone.Filter({ type: 'bandpass', frequency: o.clap?.freq ?? 1100, Q: 0.8 })).connect(bus);
  const clap = add(new Tone.NoiseSynth({
    envelope: { attack: 0.001, decay: 0.01, sustain: 0, release: 0.01 },
    volume: o.clap?.volume ?? -4,
  })).connect(clapFilter);

  // hats
  const H = o.hat;
  const hatLp = add(new Tone.Filter({ type: 'lowpass', frequency: H.lp ?? 16000 })).connect(bus);
  const hatHp = add(new Tone.Filter({ type: 'highpass', frequency: H.hp ?? 7000 })).connect(hatLp);
  let hatHit;
  if (H.kind === 'noise') {
    const hat = add(new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: H.closed, sustain: 0, release: 0.02 },
      volume: H.volume ?? -18,
    })).connect(hatHp);
    hatHit = (decay, t, v) => { hat.envelope.decay = decay; hat.triggerAttackRelease(0.01, t, v); };
  } else {
    const hat = add(new Tone.MetalSynth({
      harmonicity: H.harmonicity ?? 5.1, modulationIndex: H.modulationIndex ?? 32,
      resonance: H.resonance ?? 4000, octaves: 1.5,
      envelope: { attack: 0.001, decay: H.closed, release: 0.05 },
      volume: H.volume ?? -16,
    })).connect(hatHp);
    hatHit = (decay, t, v) => { hat.envelope.decay = decay; hat.triggerAttackRelease(300, 0.02, t, v); };
  }

  // tom
  const tom = add(new Tone.MembraneSynth({
    pitchDecay: 0.06, octaves: 2,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.05 },
    volume: o.tom?.volume ?? -4,
  })).connect(bus);

  // Envelope times are read when a trigger is scheduled, so setting them first is sample-accurate.
  return (p, t) => {
    const v = p.velocity;
    switch (p.drum) {
      case 'kick':
        kick.envelope.decay = K.decay * (0.5 + 0.7 * v); // harder hit, longer boom
        kick.triggerAttackRelease(K.note, 0.1, t, v);
        click?.triggerAttackRelease(0.004, t, v);
        break;
      case 'snare':
        snare.envelope.decay = S.decay * (0.7 + 0.5 * v);
        snare.triggerAttackRelease(0.05, t, v);
        snareBody?.triggerAttackRelease(S.body, 0.05, t, v);
        break;
      case 'clap': // three quick bursts then a short tail
        clap.envelope.decay = 0.01;
        [0, 0.011, 0.022].forEach((k) => clap.triggerAttackRelease(0.005, t + k, v));
        clap.envelope.decay = 0.16;
        clap.triggerAttackRelease(0.01, t + 0.033, v);
        break;
      case 'tom':
        tom.triggerAttackRelease(o.tom?.note ?? 'E2', 0.1, t, v);
        break;
      case 'openhat':
        hatHit(H.open, t, v * 0.8);
        break;
      default:
        hatHit(H.closed * (0.7 + 0.6 * v), t, v * 0.7);
    }
  };
}

const DRUMS = {
  // Tuned 808: long boomy kick with a click and a little drive, tonal snare,
  // crisp metallic hats.
  punchy: {
    level: -6, verb: -18,
    kick: { note: 'A1', pitchDecay: 0.08, octaves: 5, decay: 0.9, click: -14, drive: 0.25, volume: -2 },
    snare: { body: 'E3', bodyType: 'triangle', bodyDecay: 0.12, noise: 'white', hp: 1800, lp: 9000, decay: 0.18 },
    hat: { kind: 'metal', closed: 0.035, open: 0.32, modulationIndex: 40, resonance: 6000, hp: 7500 },
    clap: { freq: 1200 },
  },
  // Boom-bap: short, thuddy, heavily driven kick, dark pink-noise snare,
  // soft noise hats, all through the 6-bit crush.
  dusty: {
    level: -6, crush: 6, crushWet: 0.35, verb: -14,
    kick: { note: 'A1', pitchDecay: 0.025, octaves: 3.5, decay: 0.35, click: -18, drive: 0.6, volume: -3 },
    snare: { body: 'C3', bodyType: 'sine', bodyDecay: 0.15, noise: 'pink', hp: 900, lp: 5000, decay: 0.24 },
    hat: { kind: 'noise', closed: 0.04, open: 0.28, hp: 6000, lp: 11000, volume: -14 },
    clap: { freq: 900 },
    tom: { note: 'D2', volume: -8 },
  },
  // Brushes: soft sub kick with no click, a swishy brush snare (slow attack,
  // no body), airy noise hats.
  soft: {
    level: -3, verb: -6,
    kick: { note: 'A1', pitchDecay: 0.015, octaves: 2, decay: 0.8, volume: -4 },
    snare: { noise: 'pink', attack: 0.02, hp: 1500, lp: 7000, decay: 0.4, volume: -6 },
    hat: { kind: 'noise', closed: 0.09, open: 0.6, hp: 8000, lp: 14000, volume: -16 },
    clap: { volume: -14, freq: 1500 },
    tom: { note: 'E2', volume: -8 },
  },
};

// ---------------------------------------------------------------- bass
// type 'mono': MonoSynth with a 24 dB filter envelope; heart rate sets the envelope base.
// type 'fm':   FMSynth; heart rate sets the modulation index (faster heart = growlier).
// type 'soft': plain Synth, long and round.
// `sub` (dB) layers a sine at the same pitch under the main voice for weight.
// Heart: pressure drives a distortion (0.4 * press * grit); heart rate sets the filter
// base (mono, 100..600 Hz) or the modulation index (fm, 1.5..8).
function bass(ctx, o) {
  const { add } = ctx;
  const bus = gain(add, o.level);
  sends(ctx, bus, o);
  const glide = o.glide ?? 0;
  let syn, setTone = () => {};
  if (o.type === 'fm') {
    syn = add(new Tone.FMSynth({
      harmonicity: o.harmonicity ?? 1, modulationIndex: 4, portamento: glide,
      modulation: { type: o.mod ?? 'square' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.3 },
      modulationEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.3 },
    }));
    setTone = (hr, t) => syn.modulationIndex.setValueAtTime(hrLin(hr, 1.5, 8), t);
  } else if (o.type === 'soft') {
    syn = add(new Tone.Synth({
      oscillator: { type: o.osc ?? 'triangle' }, portamento: glide,
      envelope: { attack: 0.03, decay: 0.6, sustain: 0.6, release: 1.2 },
    }));
  } else {
    syn = add(new Tone.MonoSynth({
      oscillator: { type: o.osc ?? 'sawtooth' }, portamento: glide,
      filter: { type: 'lowpass', Q: o.q ?? 2, rolloff: -24 },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.25 },
      filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.25, release: 0.3, baseFrequency: 150, octaves: o.octaves ?? 2.5 },
    }));
    setTone = (hr) => (syn.filterEnvelope.baseFrequency = hrLin(hr, 100, 600));
  }
  // At press 0 the distortion is fully dry: Tone's curve at amount 0 isn't unity gain.
  // Tone's curve squashes a full-level input by ~8 dB, so drive it 10 dB lower and
  // make up 10 dB after: unity when dry, gentle saturation and similar level when wet.
  const post = gain(add, 10).connect(bus);
  const dist = add(new Tone.Distortion({ distortion: 0, wet: 0, oversample: '2x' })).connect(post);
  syn.connect(gain(add, -10).connect(dist));
  const sub = o.sub == null ? null : add(new Tone.Synth({
    oscillator: { type: 'sine' }, portamento: glide,
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.25 }, volume: o.sub,
  })).connect(bus);
  const dur = o.dur ?? '8n';
  return {
    play(p, heart, t) {
      const n = midi(p.notes[0]);
      const grit = 0.4 * heart.press * (o.grit ?? 1);
      dist.distortion = grit;
      dist.wet.setValueAtTime(Math.min(1, grit / 0.2), t);
      setTone(heart.hr, t);
      syn.triggerAttackRelease(n, dur, t, p.velocity);
      sub?.triggerAttackRelease(n, dur, t, 0.5 + 0.5 * p.velocity);
    },
    silence() { syn.triggerRelease(); sub?.triggerRelease(); },
  };
}

const BASS = {
  saw: { type: 'mono', osc: 'sawtooth', glide: 0.03, sub: -8, level: -9 },
  fm: { type: 'fm', harmonicity: 1, glide: 0.02, sub: -10, level: -2 },
  soft: { type: 'soft', osc: 'triangle', glide: 0.08, dur: '4n', level: -6, grit: 0.4 },
};

// ---------------------------------------------------------------- lead
// type 'synth': Synth (any oscillator, `spread` makes it a 3-voice fat one).
// type 'fm':    FMSynth, bell / electric-piano family.
// type 'pluck': PluckSynth. Ignores velocity.
// Optional `vibrato` {rate, depth} and `delay` {time, feedback, send (dB), pingpong}.
// Heart: heart rate sets a low-pass before the vibrato, 400..4000 Hz (exponential).
// Note length is p.duration (the arp step, in seconds) when given, else o.dur.
function lead(ctx, o) {
  const { add } = ctx;
  const bus = gain(add, o.level);
  sends(ctx, bus, o);
  if (o.delay) {
    const Delay = o.delay.pingpong ? Tone.PingPongDelay : Tone.FeedbackDelay;
    const delay = add(new Delay({ delayTime: o.delay.time, feedback: o.delay.feedback, wet: 1 }));
    bus.connect(gain(add, o.delay.send).connect(delay));
    sends(ctx, delay, o); // echoes go to the reverb too, so they sit in the same room
  }
  let head = bus;
  if (o.vibrato) head = add(new Tone.Vibrato(o.vibrato.rate, o.vibrato.depth)).connect(head);
  const lp = add(new Tone.Filter({ type: 'lowpass', frequency: 2000, Q: 1 })).connect(head);
  head = lp;
  const glide = o.glide ?? 0;
  let syn;
  if (o.type === 'pluck') {
    syn = add(new Tone.PluckSynth({ attackNoise: 1.5, dampening: 4000, resonance: 0.97, release: 1.5 }));
  } else if (o.type === 'fm') {
    syn = add(new Tone.FMSynth({
      harmonicity: o.harmonicity ?? 3, modulationIndex: o.index ?? 4, portamento: glide,
      envelope: { attack: 0.005, decay: o.decay ?? 0.6, sustain: 0.15, release: 0.8 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.4 },
    }));
  } else {
    syn = add(new Tone.Synth({
      oscillator: o.spread ? { type: o.osc, count: 3, spread: o.spread } : { type: o.osc ?? 'square' },
      portamento: glide,
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
    }));
  }
  syn.connect(head);
  const dur = o.dur ?? '8n';
  return {
    play(p, heart, t) {
      lp.frequency.setTargetAtTime(hrExp(heart.hr, 400, 4000), t, 0.03);
      syn.triggerAttackRelease(midi(p.notes[0]), p.duration ?? dur, t, p.velocity);
    },
    silence() { syn.triggerRelease(); },
  };
}

const LEAD = {
  square: {
    type: 'synth', osc: 'fatsquare', spread: 12, glide: 0.015, dur: '8n',
    vibrato: { rate: 5, depth: 0.06 },
    delay: { pingpong: true, time: '8n.', feedback: 0.3, send: -8 },
    verb: -12, level: -7,
  },
  keys: {
    type: 'fm', harmonicity: 3, index: 2.5, decay: 0.9, dur: '8n',
    vibrato: { rate: 4.5, depth: 0.12 }, // tape wobble
    delay: { time: '4n', feedback: 0.25, send: -10 },
    verb: -10, level: -1,
  },
  pluck: {
    type: 'pluck', dur: '4n',
    delay: { pingpong: true, time: '4n.', feedback: 0.45, send: -6 },
    verb: -4, level: -4, // transient: peaks ~6 dB over its RMS
  },
};

// ---------------------------------------------------------------- pad
// PolySynth of type 'synth' (any oscillator; `spread` = 3-voice fat), 'am' or 'fm'.
// Chain: synth -> 180 Hz high-pass (keeps it off the bass) -> low-pass following
// heart -> optional slow AutoFilter (`motion` Hz), Phaser, Chorus -> bus.
// Heart: update() sets the low-pass from heart rate, 300..3000 Hz (exponential),
// times 2^breath (+-1 octave with the player's breathing). Called every 16th step.
function pad(ctx, o) {
  const { add } = ctx;
  const bus = gain(add, o.level);
  sends(ctx, bus, o);
  let head = bus;
  if (o.chorus) head = add(new Tone.Chorus({ frequency: o.chorus.rate, delayTime: 3.5, depth: o.chorus.depth, wet: 0.5 }).start()).connect(head);
  if (o.phaser) head = add(new Tone.Phaser({ frequency: 0.15, octaves: 3, baseFrequency: 400, wet: 0.35 })).connect(head);
  if (o.motion) {
    head = add(new Tone.AutoFilter({
      frequency: o.motion, baseFrequency: 300, octaves: 3.5, wet: 0.7,
      filter: { type: 'lowpass', rolloff: -12, Q: 1 },
    }).start()).connect(head);
  }
  const lp = add(new Tone.Filter({ type: 'lowpass', frequency: 1200, rolloff: -12 })).connect(head);
  const hp = add(new Tone.Filter({ type: 'highpass', frequency: 180 })).connect(lp);

  const env = { attack: o.attack ?? 1.5, decay: 1, sustain: 0.8, release: o.release ?? 3 };
  let syn;
  if (o.type === 'am') {
    syn = new Tone.PolySynth(Tone.AMSynth, { harmonicity: 2, modulation: { type: 'triangle' }, envelope: env });
  } else if (o.type === 'fm') {
    syn = new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 1.5, envelope: env });
  } else {
    const oscillator = o.spread ? { type: o.osc, count: 3, spread: o.spread } : { type: o.osc ?? 'triangle' };
    syn = new Tone.PolySynth(Tone.Synth, { oscillator, envelope: env });
  }
  add(syn).connect(hp);
  syn.maxPolyphony = 16;
  return {
    play(p, heart, t) {
      syn.triggerAttackRelease(p.notes.map(midi), o.hold ?? 2.5, t, 0.3 + 0.5 * p.velocity);
    },
    update(heart, t) {
      lp.frequency.rampTo(hrExp(heart.hr, 300, 3000) * 2 ** heart.breath, 0.1, t);
    },
    silence() { syn.releaseAll(); },
  };
}

const PAD = {
  saw: {
    osc: 'fatsawtooth', spread: 25, attack: 1.2, release: 3, hold: 3,
    chorus: { rate: 0.7, depth: 0.5 }, motion: 0.08,
    verb: -2, level: -18,
  },
  warm: {
    type: 'am', attack: 0.8, release: 2.5, hold: 2.5,
    chorus: { rate: 1.2, depth: 0.7 },
    verb: -6, level: -6,
  },
  air: {
    osc: 'fattriangle', spread: 30, attack: 3, release: 5, hold: 3,
    phaser: true, motion: 0.05,
    verb: 0, level: -20,
  },
};

// ---------------------------------------------------------------- kits
function makeKit(spec) {
  return (out) => {
    const nodes = [];
    const add = (n) => (nodes.push(n), n);
    const dest = spec.bus ? spec.bus(add, out) : out;
    const verb = add(new Tone.Reverb(spec.reverb)).connect(dest);
    const ctx = { add, dest, verb };
    const d = drums(ctx, spec.drums);
    const b = bass(ctx, spec.bass);
    const l = lead(ctx, spec.lead);
    const p = pad(ctx, spec.pad);
    return {
      drums: (params, heart, t) => d(params, t),
      bass: b.play,
      lead: l.play,
      pad: p.play,
      update(hearts, t) { p.update(hearts.pad, t); },  // continuous, every 16th step
      lift(voice) { if (voice === 'pad') p.silence(); }, // finger lifted: pad releases now
      silence() { b.silence(); l.silence(); p.silence(); },
      dispose() { nodes.forEach((n) => n.dispose()); },
      ready: verb.ready, // resolves once the reverb impulse is generated
      tail: spec.tail, // seconds of release/reverb to let ring before dispose
    };
  };
}

// Order matters: the first kit is the default.
export const KITS = {
  // Clean, punchy electronic: tuned 808-style drums, saw bass with sub,
  // fat square lead with ping-pong echoes, moving supersaw pad.
  pulse: makeKit({
    tail: 4,
    reverb: { decay: 2.5, preDelay: 0.02, wet: 1 },
    drums: DRUMS.punchy,
    bass: BASS.saw,
    lead: LEAD.square,
    pad: PAD.saw,
  }),
  // Dusty and warm: whole kit low-passed at 4.5 kHz, crushed drums,
  // FM bass, wobbly electric-piano lead, soft AM pad.
  lofi: makeKit({
    tail: 4,
    bus: (add, out) => add(new Tone.Filter({ type: 'lowpass', frequency: 4500, rolloff: -12 })).connect(out),
    reverb: { decay: 2, preDelay: 0.01, wet: 1 },
    drums: DRUMS.dusty,
    bass: BASS.fm,
    lead: LEAD.keys,
    pad: PAD.warm,
  }),
  // Slow and spacious: soft brushed drums in an 8 s room, round bass,
  // plucks echoing on dotted quarters, airy pad.
  ambient: makeKit({
    tail: 10,
    reverb: { decay: 8, preDelay: 0.05, wet: 1 },
    drums: DRUMS.soft,
    bass: BASS.soft,
    lead: LEAD.pluck,
    pad: PAD.air,
  }),
};
