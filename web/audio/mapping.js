// Chop a raw sample into bit fields; map fields to musical params.

// Candidates tried. Pentatonic wins: the lead and bass pick notes from noise,
// and with no semitones in the scale no pick can clash with the pad.
// Seven-note modes (dorian, phrygian) give the pad real 7th chords, but the
// lead then lands a semitone off a chord tone about one note in four.
export const SCALES = {
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
export const SCALE = SCALES.minorPentatonic;
export const ROOT = 45;                 // A2. Kick (A1) and bass are tuned to it.
export const WIDTHS = [3, 3, 4, 4];     // a, b, c, d
// ponytail: lowest bits are pure sensor noise; raise to make voices calmer, lower for glitchier
export const SKIP_BITS = 2;
// Field `a` is 3 bits, so 8 slots. Kick and closed hat appear twice so they
// come up twice as often as the colour pieces.
export const DRUMS = ['kick', 'hat', 'snare', 'hat', 'kick', 'clap', 'openhat', 'tom'];

export function fields(value, widths) {
  return widths.map((w) => {
    const f = value & ((1 << w) - 1);
    value >>>= w;
    return f;
  });
}

export function note(index, octave) {
  const n = SCALE.length;
  return ROOT + 12 * (octave + Math.floor(index / n)) + SCALE[index % n];
}

// Bits-mode tempo: the mean BPM of channels with a finger on and a reading,
// clamped to a playable range. null when nobody is on (caller holds its tempo).
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 140;
export function tempoFrom(ch) {
  const bpms = ch.filter((c) => c.finger && c.bpm > 0).map((c) => c.bpm);
  if (!bpms.length) return null;
  const avg = bpms.reduce((a, b) => a + b, 0) / bpms.length;
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, avg));
}

export function mapVoice(name, raw) {
  const [a, b, c, d] = fields(raw >>> SKIP_BITS, WIDTHS);
  const velocity = 0.4 + (c / 15) * 0.6;
  const cutoff = 200 + d * 150;
  switch (name) {
    case 'drums': return { drum: DRUMS[a], velocity };
    case 'bass':  return { notes: [note(a, -1)], velocity, cutoff }; // A1..D3, under the pad
    case 'lead':  return { notes: [note(a + b, 2)], velocity, cutoff };
    // Every other scale step: in minor pentatonic that stacks 4ths (A D G C), an open
    // sus/7 sound that never clashes, whatever the root.
    case 'pad':   return { notes: [note(a, 1), note(a + 2, 1), note(a + 4, 1), note(a + 6, 1)], velocity, cutoff };
  }
}
