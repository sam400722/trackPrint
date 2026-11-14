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
function bass(ctx, o) {
  const syn = ctx.add(new Tone.MonoSynth({ oscillator: { type: o.osc ?? 'sawtooth' }, volume: o.level }));
  sends(ctx, syn, o);
  return {
    play(p, t) {
      syn.filterEnvelope.baseFrequency = p.cutoff;
      syn.triggerAttackRelease(midi(p.notes[0]), '8n', t, p.velocity);
    },
    silence() { syn.triggerRelease(); },
  };
}

// ---------------------------------------------------------------- lead
function lead(ctx, o) {
  const vibrato = ctx.add(new Tone.Vibrato(5, 0.1));
  sends(ctx, vibrato, o);
  const syn = ctx.add(new Tone.Synth({ oscillator: { type: o.osc ?? 'square' }, volume: o.level })).connect(vibrato);
  return {
    play(p, t) { syn.triggerAttackRelease(midi(p.notes[0]), '8n', t, p.velocity); },
    silence() { syn.triggerRelease(); },
  };
}

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
  bass: { level: -6 },
  lead: { level: -14, verb: -6 },
  pad: { level: -20, verb: -3 },
};

export const KITS = {
  basic: makeKit(BASIC),
  // Temporary A/B kit; removed in A7.
  test: makeKit({
    ...BASIC,
    bass: { ...BASIC.bass, osc: 'sine' },
    lead: { ...BASIC.lead, osc: 'triangle' },
    pad: { ...BASIC.pad, osc: 'fattriangle' },
  }),
};
