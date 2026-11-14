// Song tempo from the drum finger's heart. Pure.

// With the drum finger off the song plays at a random tempo in this range, picked anew each time
// the drums go off. TEMPO_DEFAULT is only the transport's starting point before the first pick.
export const TEMPO_MIN = 70, TEMPO_MAX = 90, TEMPO_DEFAULT = 80;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Heart rate 50..110 maps linearly to song tempo 100..180, clamped.
export function songBpm(hr) {
  return 100 + 80 * clamp((hr - 50) / 60, 0, 1);
}

// Tempo band: slow < 125 <= mid <= 155 < fast. Leaving the previous band takes
// 3 BPM past its edge, so a tempo sitting on an edge doesn't flip every step.
export function band(bpm, prev) {
  const raw = bpm < 125 ? 'slow' : bpm <= 155 ? 'mid' : 'fast';
  if (!prev || raw === prev) return raw;
  if (prev === 'slow') return bpm >= 128 ? raw : 'slow';
  if (prev === 'fast') return bpm <= 152 ? raw : 'fast';
  if (raw === 'slow') return bpm < 122 ? 'slow' : 'mid';
  return bpm > 158 ? 'fast' : 'mid';
}

// Tempo follower. update(drumHeart) -> target BPM.
//   default random 70..90 while the drum finger is off or unsettled (new pick each release)
//   lock    first settled reading jumps the target to songBpm(hr)
//   follow  then moves only for changes of 2 BPM or more
//   release finger lifts: a new random default
// The caller glides the transport to each new target over 2 bars.
export function createTempo(random = Math.random) {
  const pick = () => TEMPO_MIN + (TEMPO_MAX - TEMPO_MIN) * random();
  let target = pick();
  let locked = false;
  return function update(drum) {
    if (!drum.on || !drum.settled) {
      if (locked) target = pick(); // just released
      locked = false;
    } else {
      const want = songBpm(drum.hr);
      if (!locked || Math.abs(want - target) >= 2) target = want;
      locked = true;
    }
    return target;
  };
}
