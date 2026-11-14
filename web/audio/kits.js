// Sound kits. A kit builder makes its instruments, connected only to `out`.
import * as Tone from 'https://cdn.jsdelivr.net/npm/tone@15.0.4/+esm';

const midi = (m) => Tone.Frequency(m, 'midi').toNote();

function basic(out, osc = { bass: 'sawtooth', lead: 'square', pad: 'fatsawtooth' }) {
  const verb = new Tone.Reverb(3).connect(out);
  const kick = new Tone.MembraneSynth().connect(out);
  const snare = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(out);
  const hat = new Tone.MetalSynth({ envelope: { decay: 0.05 }, volume: -18 }).connect(out);
  const bass = new Tone.MonoSynth({ oscillator: { type: osc.bass }, volume: -6 }).connect(out);
  const vibrato = new Tone.Vibrato(5, 0.1).connect(verb);
  const lead = new Tone.Synth({ oscillator: { type: osc.lead }, volume: -14 }).connect(vibrato);
  const padFilter = new Tone.Filter(800, 'lowpass').connect(verb);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: osc.pad },
    envelope: { attack: 1, release: 2 },
    volume: -20,
  }).connect(padFilter);
  const nodes = [verb, kick, snare, hat, bass, vibrato, lead, padFilter, pad];

  return {
    drums(p, t) {
      if (p.drum === 'kick') kick.triggerAttackRelease('C1', '8n', t, p.velocity);
      else if (p.drum === 'snare') snare.triggerAttackRelease('16n', t, p.velocity);
      else hat.triggerAttackRelease(200, '32n', t, p.velocity);
    },
    bass(p, t) {
      bass.filterEnvelope.baseFrequency = p.cutoff;
      bass.triggerAttackRelease(midi(p.notes[0]), '8n', t, p.velocity);
    },
    lead(p, t) {
      lead.triggerAttackRelease(midi(p.notes[0]), '8n', t, p.velocity);
    },
    pad(p, t) {
      padFilter.frequency.rampTo(p.cutoff * 2, 1);
      pad.triggerAttackRelease(p.notes.map(midi), '1n', t, p.velocity);
    },
    silence() { pad.releaseAll(); bass.triggerRelease(); lead.triggerRelease(); },
    tail: 3, // seconds of release/reverb to let ring before dispose
    dispose() { nodes.forEach((n) => n.dispose()); },
  };
}

// Temporary A/B kit: same as basic with different oscillators.
const test = (out) => basic(out, { bass: 'sine', lead: 'triangle', pad: 'fattriangle' });

export const KITS = { basic, test };
