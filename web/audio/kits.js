// Sound kits. A kit is a spec of voice presets; makeKit turns it into a builder
// `(out) => Kit` whose instruments connect only to `out`.
// Kit = { drums, bass, lead, pad, silence(), dispose(), tail }. Each voice is (params, time) => void.
import * as Tone from 'https://cdn.jsdelivr.net/npm/tone@15.0.4/+esm';

const midi = (m) => Tone.Frequency(m, 'midi').toNote();
const gain = (add, db = 0) => add(new Tone.Gain(Tone.dbToGain(db)));

// Every voice factory takes ctx = { add, dest, verb } and a preset.
// `add` registers a node for dispose, `dest` is the kit bus, `verb` the kit reverb.
function sends(ctx, node, o) {
  node.connect(ctx.dest);
  if (o.verb != null) node.connect(gain(ctx.add, o.verb).connect(ctx.verb));
}

// ---------------------------------------------------------------- drums
// Pieces: kick, snare, clap, hat, openhat, tom. Unknown names play the closed hat.
// Velocity changes level everywhere, and decay on kick, snare and closed hat.
function drums(ctx, o) {
  const { add } = ctx;
  const bus = gain(add, o.level);
  if (o.crush) {
    const crush = add(new Tone.BitCrusher({ bits: o.crush, wet: o.crushWet ?? 0.5 }));
    bus.connect(crush);
    sends(ctx, crush, o);
  } else sends(ctx, bus, o);

  const kick = add(new Tone.MembraneSynth({
    pitchDecay: o.kick.pitchDecay, octaves: o.kick.octaves,
    envelope: { attack: 0.001, decay: o.kick.decay, sustain: 0, release: 0.05 },
    volume: o.kick.volume ?? 0,
  })).connect(bus);

  const snareFilter = add(new Tone.Filter({ type: 'bandpass', frequency: o.snare.freq, Q: 0.9 })).connect(bus);
  const snare = add(new Tone.NoiseSynth({
    envelope: { attack: 0.001, decay: o.snare.decay, sustain: 0, release: 0.02 },
    volume: o.snare.volume ?? -4,
  })).connect(snareFilter);
  const snareBody = add(new Tone.MembraneSynth({
    pitchDecay: 0.015, octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
    volume: (o.snare.volume ?? -4) - 6,
  })).connect(bus);

  const clapFilter = add(new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 0.8 })).connect(bus);
  const clap = add(new Tone.NoiseSynth({
    envelope: { attack: 0.001, decay: 0.01, sustain: 0, release: 0.01 },
    volume: o.clap?.volume ?? -4,
  })).connect(clapFilter);

  const hatFilter = add(new Tone.Filter({ type: 'highpass', frequency: 7000 })).connect(bus);
  const hat = add(new Tone.MetalSynth({
    harmonicity: 5.1, modulationIndex: 32, resonance: o.hat.resonance ?? 4000, octaves: 1.5,
    envelope: { attack: 0.001, decay: o.hat.closed, release: 0.05 },
    volume: o.hat.volume ?? -16,
  })).connect(hatFilter);

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
        kick.envelope.decay = o.kick.decay * (0.5 + 0.7 * v); // harder hit, longer boom
        kick.triggerAttackRelease(o.kick.note, 0.1, t, v);
        break;
      case 'snare':
        snare.envelope.decay = o.snare.decay * (0.7 + 0.5 * v);
        snare.triggerAttackRelease(0.05, t, v);
        snareBody.triggerAttackRelease(o.snare.body, 0.05, t, v);
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
      case 'openhat': // same synth as the closed hat, so a closed hat chokes it
        hat.envelope.decay = o.hat.open;
        hat.triggerAttackRelease(300, 0.05, t, v * 0.8);
        break;
      default:
        hat.envelope.decay = o.hat.closed * (0.7 + 0.6 * v);
        hat.triggerAttackRelease(300, 0.02, t, v * 0.7);
    }
  };
}

const DRUMS = {
  punchy: {
    level: -4, verb: -18,
    kick: { note: 'A1', pitchDecay: 0.05, octaves: 6, decay: 0.45 },
    snare: { freq: 1800, decay: 0.16, body: 'D3' },
    hat: { closed: 0.045, open: 0.3 },
  },
  dusty: {
    level: -6, crush: 6, crushWet: 0.35, verb: -14,
    kick: { note: 'A1', pitchDecay: 0.03, octaves: 4, decay: 0.5 },
    snare: { freq: 1400, decay: 0.2, body: 'C3' },
    hat: { closed: 0.03, open: 0.25, volume: -20 },
    tom: { note: 'D2', volume: -8 },
  },
  soft: {
    level: -3, verb: -6,
    kick: { note: 'A1', pitchDecay: 0.02, octaves: 3, decay: 0.6, volume: -4 },
    snare: { freq: 2500, decay: 0.35, body: 'A3', volume: -14 }, // brush swish
    clap: { volume: -14 },
    hat: { closed: 0.08, open: 0.6, volume: -24 },
    tom: { note: 'E2', volume: -8 },
  },
};

// ---------------------------------------------------------------- bass
// type 'mono': MonoSynth with a 24 dB filter envelope; cutoff sets the envelope base.
// type 'fm':   FMSynth; cutoff sets the modulation index (brighter = growlier).
// type 'soft': plain Synth, long and round.
// `sub` (dB) layers a sine at the same pitch under the main voice for weight.
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
    setTone = (c, t) => syn.modulationIndex.setValueAtTime(1 + c / 350, t); // 1.6..8
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
    setTone = (c) => (syn.filterEnvelope.baseFrequency = 60 + c * 0.3); // 120..795 Hz
  }
  syn.connect(bus);
  const sub = o.sub == null ? null : add(new Tone.Synth({
    oscillator: { type: 'sine' }, portamento: glide,
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.25 }, volume: o.sub,
  })).connect(bus);
  const dur = o.dur ?? '8n';
  return {
    play(p, t) {
      const n = midi(p.notes[0]);
      setTone(p.cutoff, t);
      syn.triggerAttackRelease(n, dur, t, p.velocity);
      sub?.triggerAttackRelease(n, dur, t, 0.5 + 0.5 * p.velocity);
    },
    silence() { syn.triggerRelease(); sub?.triggerRelease(); },
  };
}

const BASS = {
  saw: { type: 'mono', osc: 'sawtooth', glide: 0.03, sub: -8, level: -9 },
  fm: { type: 'fm', harmonicity: 1, glide: 0.02, sub: -10, level: -2 },
  soft: { type: 'soft', osc: 'triangle', glide: 0.08, dur: '4n', level: -6 },
};

// ---------------------------------------------------------------- lead
// type 'synth': Synth (any oscillator, `spread` makes it a 3-voice fat one) through
//               a low-pass that follows cutoff.
// type 'fm':    FMSynth, bell / electric-piano family; cutoff ignored.
// type 'pluck': PluckSynth; cutoff sets the string dampening. Ignores velocity.
// Optional `vibrato` {rate, depth} and `delay` {time, feedback, send (dB), pingpong}.
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
  const glide = o.glide ?? 0;
  let syn, setTone = () => {};
  if (o.type === 'pluck') {
    syn = add(new Tone.PluckSynth({ attackNoise: 1.5, dampening: 4000, resonance: 0.97, release: 1.5 }));
    setTone = (c) => (syn.dampening = 1500 + c * 2); // 1.9..6.4 kHz
  } else if (o.type === 'fm') {
    syn = add(new Tone.FMSynth({
      harmonicity: o.harmonicity ?? 3, modulationIndex: o.index ?? 4, portamento: glide,
      envelope: { attack: 0.005, decay: o.decay ?? 0.6, sustain: 0.15, release: 0.8 },
      modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.4 },
    }));
  } else {
    const filter = add(new Tone.Filter({ type: 'lowpass', frequency: 3000, Q: 1 })).connect(head);
    head = filter;
    syn = add(new Tone.Synth({
      oscillator: o.spread ? { type: o.osc, count: 3, spread: o.spread } : { type: o.osc ?? 'square' },
      portamento: glide,
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
    }));
    setTone = (c, t) => filter.frequency.setTargetAtTime(800 + c * 2.5, t, 0.03); // 1.3..6.9 kHz
  }
  syn.connect(head);
  const dur = o.dur ?? '8n';
  return {
    play(p, t) {
      setTone(p.cutoff, t);
      syn.triggerAttackRelease(midi(p.notes[0]), dur, t, p.velocity);
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
// cutoff -> optional slow AutoFilter (`motion` Hz), Phaser, Chorus -> bus.
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
    play(p, t) {
      lp.frequency.rampTo(400 + p.cutoff * 1.2, 2, t); // 640..3340 Hz, glides between chords
      syn.triggerAttackRelease(p.notes.map(midi), o.hold ?? 2.5, t, 0.3 + 0.5 * p.velocity);
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
      drums: d,
      bass: b.play,
      lead: l.play,
      pad: p.play,
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
