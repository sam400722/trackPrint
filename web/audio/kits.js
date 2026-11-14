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
    level: 0,
    kick: { note: 'A1', pitchDecay: 0.05, octaves: 6, decay: 0.45 },
    snare: { freq: 1800, decay: 0.16, body: 'D3' },
    hat: { closed: 0.045, open: 0.3 },
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
  saw: { type: 'mono', osc: 'sawtooth', glide: 0.03, sub: -8, level: -8 },
  fm: { type: 'fm', harmonicity: 1, glide: 0.02, sub: -10, level: -8 },
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
    verb: -12, level: -16,
  },
  keys: {
    type: 'fm', harmonicity: 3, index: 2.5, decay: 0.9, dur: '8n',
    vibrato: { rate: 4.5, depth: 0.12 }, // tape wobble
    delay: { time: '4n', feedback: 0.25, send: -10 },
    verb: -10, level: -12,
  },
  pluck: {
    type: 'pluck', dur: '4n',
    delay: { pingpong: true, time: '4n.', feedback: 0.45, send: -6 },
    verb: -4, level: -6,
  },
};

// ---------------------------------------------------------------- pad
function pad(ctx, o) {
  const filter = ctx.add(new Tone.Filter(800, 'lowpass'));
  sends(ctx, filter, o);
  const syn = ctx.add(new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: o.osc ?? 'fatsawtooth' }, envelope: { attack: 1, release: 2 }, volume: o.level,
  })).connect(filter);
  return {
    play(p, t) {
      filter.frequency.rampTo(p.cutoff * 2, 1);
      syn.triggerAttackRelease(p.notes.map(midi), '1n', t, p.velocity);
    },
    silence() { syn.releaseAll(); },
  };
}

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

const BASIC = {
  tail: 3,
  reverb: { decay: 3, wet: 1 },
  drums: DRUMS.punchy,
  bass: BASS.saw,
  lead: LEAD.square,
  pad: { level: -20, verb: -3 },
};

export const KITS = {
  basic: makeKit(BASIC),
  // Temporary A/B kit; removed in A7.
  test: makeKit({
    ...BASIC,
    bass: BASS.fm,
    lead: LEAD.pluck,
    pad: { ...BASIC.pad, osc: 'fattriangle' },
  }),
};
