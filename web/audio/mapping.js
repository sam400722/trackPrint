// Chop a raw sample into bit fields; map fields to musical params.

export const SCALE = [0, 3, 5, 7, 10];  // minor pentatonic
export const ROOT = 45;                 // A2
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

export function mapVoice(name, raw) {
  const [a, b, c, d] = fields(raw >>> SKIP_BITS, WIDTHS);
  const velocity = 0.4 + (c / 15) * 0.6;
  const cutoff = 200 + d * 150;
  switch (name) {
    case 'drums': return { drum: DRUMS[a], velocity };
    case 'bass':  return { notes: [note(a, -1)], velocity, cutoff }; // A1..D3, under the pad
    case 'lead':  return { notes: [note(a + b, 2)], velocity, cutoff };
    case 'pad':   return { notes: [note(a, 1), note(a + 2, 1), note(a + 4, 1)], velocity, cutoff };
  }
}
