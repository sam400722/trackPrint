// Chop a raw sample into bit fields; map fields to pitch and velocity.
// Rhythm (including which drum hits) comes from patterns.js, timbre from heart.js.

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
// Lead arp: scale-degree offsets from the bar's root, cycled upward.
export const ARP = [0, 2, 4, 5];

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
    case 'drums': return { velocity };
    case 'bass':  return { notes: [note(a % 5, 0)], velocity, cutoff };
    // The four arp notes for the bar; the root degree is d folded into one octave,
    // so the arp stays within octaves 2-3.
    case 'lead':  return { notes: ARP.map((k) => note((d % 5) + k, 2)), velocity, cutoff };
    case 'pad':   return { notes: [note(a, 1), note(a + 2, 1), note(a + 4, 1)], velocity, cutoff };
  }
}
