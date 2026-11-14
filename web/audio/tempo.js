// Song tempo from the drum finger's heart. Pure.

export const TEMPO_DEFAULT = 90;
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
//   default 90 while the drum finger is off or unsettled
//   lock    first settled reading jumps the target to songBpm(hr)
//   follow  then moves only for changes of 2 BPM or more
//   release finger lifts: back to 90
// The caller glides the transport to each new target over 2 bars.
export function createTempo() {
  let target = TEMPO_DEFAULT;
  let locked = false;
  return function update(drum) {
    if (!drum.on || !drum.settled) {
      locked = false;
      target = TEMPO_DEFAULT;
    } else {
      const want = songBpm(drum.hr);
      if (!locked || Math.abs(want - target) >= 2) target = want;
      locked = true;
    }
    return target;
  };
}
