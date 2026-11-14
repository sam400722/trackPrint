// Pure stage maths, ported from the ferrofluid mockup: the merge/split rule and the
// per-player beat spring. No DOM, so web/test.mjs can import it.

export const SPLIT_MS = 2000; // a finger up this long splits the merged blob
// the per-player field F: an underdamped spring pulled to T on each beat (T decays), L lags F; spikes rise with F and L
const SPRING_K = 220, SPRING_C = 16;              // spring stiffness and damping
const T_DECAY = .26, LIFT_DECAY = .15, RIP_DECAY = .22, FL_DECAY = .45;   // seconds: beat target, reduced-motion lift, note ripple, window flash
const L_LAG = .11;                                // seconds: lag of L behind F

// all four ready -> merged; any one not ready for SPLIT_MS -> split. now in ms.
export function mergeStep(st, ready, now) {
  if (ready.every(Boolean)) return { merged: true, upAt: null };
  if (!st.merged) return st;
  const upAt = st.upAt ?? now;
  return now - upAt > SPLIT_MS ? { merged: false, upAt: null } : { merged: true, upAt };
}

export const newField = () => ({ T: 0, F: 0, vel: 0, L: 0, rip: 0, lift: 0, fl: 0 });

// One animation frame, dt in seconds. The caller sets f.rip = 1 when a note plays.
export function stepField(f, beat, dt) {
  if (beat) f.T = f.lift = f.fl = 1;
  f.T *= Math.exp(-dt / T_DECAY); f.lift *= Math.exp(-dt / LIFT_DECAY); f.rip *= Math.exp(-dt / RIP_DECAY); f.fl *= Math.exp(-dt / FL_DECAY);
  f.vel += (SPRING_K * (f.T - f.F) - SPRING_C * f.vel) * dt; f.F += f.vel * dt; // underdamped spring: the pull overshoots, then eases
  f.L += (f.F - f.L) * (1 - Math.exp(-dt / L_LAG));
  return f;
}
