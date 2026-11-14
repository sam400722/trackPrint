// Rhythm patterns per tempo band: 16 steps per bar (16ths), x = hit. Pure data.

const grid = (s) => [...s].map((c) => c === 'x');

export const DRUM_PATTERNS = {
  slow: { kick: grid('x.......x.......'), snare: grid('....x.......x...'), hat: grid('................') },
  mid:  { kick: grid('x.......x.x.....'), snare: grid('....x.......x...'), hat: grid('x.x.x.x.x.x.x.x.') },
  fast: { kick: grid('x.....x...x...x.'), snare: grid('....x.......x..x'), hat: grid('xxxxxxxxxxxxxxxx') },
};

export const BASS_PATTERNS = {
  slow: grid('x.......x.......'),
  mid:  grid('x..x..x.x..x....'),
  fast: grid('x..x..x...x.x..x'),
};

// Pad chord change, in steps.
export const PAD_EVERY = { slow: 16, mid: 16, fast: 8 };

// The "and" of each beat (steps 2, 6, 10, 14). Hats there play at half velocity.
export const isOff8th = (step) => step % 4 === 2;

// Lead arp note length from the lead finger's heart rate.
// level:   0      1      2        3     4
// hr:     <65   65-75  75-85   85-95  >=95
// note:  whole  half  quarter   8th   16th
export const LEAD_EDGES = [65, 75, 85, 95];
export const LEAD_STEPS = [16, 8, 4, 2, 1];

// Leaving the previous level takes 2 BPM past the edge (hysteresis).
export function leadLevel(hr, prev) {
  if (prev == null) return LEAD_EDGES.filter((e) => hr >= e).length;
  let lvl = prev;
  while (lvl < LEAD_EDGES.length && hr >= LEAD_EDGES[lvl] + 2) lvl++;
  while (lvl > 0 && hr < LEAD_EDGES[lvl - 1] - 2) lvl--;
  return lvl;
}
