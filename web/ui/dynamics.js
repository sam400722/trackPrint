export const SPLIT_MS = 2000;

const SPRING_K = 220, SPRING_C = 16;
const T_DECAY = .26, LIFT_DECAY = .15, RIP_DECAY = .22, FL_DECAY = .45;
const L_LAG = .11;

export function mergeStep(st, ready, now) {
  if (ready.every(Boolean)) return { merged: true, upAt: null };
  if (!st.merged) return st;
  const upAt = st.upAt ?? now;
  return now - upAt > SPLIT_MS ? { merged: false, upAt: null } : { merged: true, upAt };
}

export function newField() {
  return { T: 0, F: 0, vel: 0, L: 0, rip: 0, lift: 0, fl: 0 };
}

export function stepField(f, beat, dt) {
  if (beat) f.T = f.lift = f.fl = 1;
  f.T *= Math.exp(-dt / T_DECAY); f.lift *= Math.exp(-dt / LIFT_DECAY); f.rip *= Math.exp(-dt / RIP_DECAY); f.fl *= Math.exp(-dt / FL_DECAY);
  f.vel += (SPRING_K * (f.T - f.F) - SPRING_C * f.vel) * dt; f.F += f.vel * dt;
  f.L += (f.F - f.L) * (1 - Math.exp(-dt / L_LAG));
  return f;
}
