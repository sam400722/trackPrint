// Per-channel pulse processing. One step() call per sample.

// ponytail: fixed threshold; tune per sensor/LED power. Raw IR below this = no finger.
export const FINGER_MIN = 50000;

// Beat detection follows the middle of the last WINDOW_S seconds of the pulse wave, so
// the reading creeping up while a finger settles doesn't hide beats. A beat is an upward
// crossing of that middle, after the wave has dipped below it, with at least MIN_SWING of
// peak-to-peak swing in the window (below that it's sensor noise, not a pulse).
const WINDOW_S = 1.5;       // must cover one beat: 1.5 s reaches down to 40 BPM
const MIN_SWING = 60;       // ponytail: raw counts; lower it if a weak finger never beats
const REARM = 0.1;          // dip this far (of the swing) below the middle before the next beat

export function createChannel(rate = 50) {
  const dcA = 1 / (rate * 0.5);                // DC tracker, ~0.5 s: lets go of a settling finger fast
  const lpA = 0.4;                             // light smoothing against sensor fuzz
  const envDecay = 1 - 1 / (rate * 2);         // envelope forgets over ~2 s (amp only)
  const refractory = Math.round(rate * 0.3);   // caps at 200 BPM
  const N = Math.round(rate * WINDOW_S);
  const warmup = Math.round(rate * 0.5);       // need some wave before the middle means anything
  const win = new Float32Array(N);
  let dc = null, lp = 0, prevAc = 0, env = 0, n = 0, k = 0, armed = true;
  let lastBeat = -Infinity, bpm = 0, inst = 0;

  return function step(raw) {
    n++;
    if (raw < FINGER_MIN) {
      dc = null; env = 0; bpm = 0; inst = 0; prevAc = 0; k = 0; armed = true; lastBeat = -Infinity;
      return { finger: false, ac: 0, beat: false, bpm: 0, amp: 0, inst: 0 };
    }
    if (dc === null) { dc = raw; lp = raw; }
    dc += (raw - dc) * dcA;
    lp += (raw - lp) * lpA;
    const ac = dc - lp;                        // IR dips on each pulse; flip so beats point up
    env = Math.max(Math.abs(ac), env * envDecay);

    win[k++ % N] = ac;
    let hi = -Infinity, lo = Infinity;
    for (let j = 0, m = Math.min(k, N); j < m; j++) {
      if (win[j] > hi) hi = win[j];
      if (win[j] < lo) lo = win[j];
    }
    const mid = (hi + lo) / 2, swing = hi - lo;
    if (ac < mid - REARM * swing) armed = true;
    const beat = armed && prevAc < mid && ac >= mid && swing > MIN_SWING
      && k >= warmup && n - lastBeat > refractory;
    if (beat) armed = false;
    prevAc = ac;
    if (beat) {
      if (lastBeat !== -Infinity) {
        inst = (60 * rate) / (n - lastBeat);  // unsmoothed, latest beat only
        bpm = bpm ? bpm * 0.7 + inst * 0.3 : inst;
      }
      lastBeat = n;
    }
    // amp: pulse envelope (finger pressure). inst: BPM of the latest beat, 0 until two beats.
    return { finger: true, ac, beat, bpm, amp: env, inst };
  };
}
