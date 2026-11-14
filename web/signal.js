// Per-channel pulse processing. One step() call per sample.

// ponytail: fixed threshold; tune per sensor/LED power. Raw IR below this = no finger.
export const FINGER_MIN = 50000;

export function createChannel(rate = 50) {
  const dcA = 1 / (rate * 1.5);               // DC tracker, ~1.5 s
  const lpA = 0.4;                             // light smoothing against sensor fuzz
  const envDecay = 1 - 1 / (rate * 2);         // envelope forgets over ~2 s
  const refractory = Math.round(rate * 0.3);   // caps at 200 BPM
  let dc = null, lp = 0, prevAc = 0, env = 0, n = 0, lastBeat = -Infinity, bpm = 0;

  return function step(raw) {
    n++;
    if (raw < FINGER_MIN) {
      dc = null; env = 0; bpm = 0; prevAc = 0; lastBeat = -Infinity;
      return { finger: false, ac: 0, beat: false, bpm: 0 };
    }
    if (dc === null) { dc = raw; lp = raw; }
    dc += (raw - dc) * dcA;
    lp += (raw - lp) * lpA;
    const ac = dc - lp;                        // IR dips on each pulse; flip so beats point up
    env = Math.max(Math.abs(ac), env * envDecay);
    const thr = env * 0.5;
    const beat = prevAc < thr && ac >= thr && n - lastBeat > refractory;
    prevAc = ac;
    if (beat) {
      if (lastBeat !== -Infinity) {
        const inst = (60 * rate) / (n - lastBeat);
        bpm = bpm ? bpm * 0.7 + inst * 0.3 : inst;
      }
      lastBeat = n;
    }
    return { finger: true, ac, beat, bpm };
  };
}
