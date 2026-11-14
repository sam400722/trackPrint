// Per-channel pulse processing. One step() call per sample.

// ponytail: fixed threshold; tune per sensor/LED power. Raw IR below this = no finger.
// Measured on the Pi's four sensors (LED power 0x1F): no finger reads 500-7,000, and a finger
// reads 45,000-90,000, with sensor 2 at only 45,000-49,000 unless pressed hard. 50000 missed it.
export const FINGER_MIN = 30000;

// Beat detection follows the middle of the last WINDOW_S seconds of the pulse wave, so
// the reading creeping up while a finger settles doesn't hide beats. A beat is an upward
// crossing of that middle, after the wave has dipped below it, with at least MIN_SWING of
// peak-to-peak swing in the window (below that it's sensor noise, not a pulse).
const WINDOW_S = 1.5;       // must cover one beat: 1.5 s reaches down to 40 BPM
const MIN_SWING = 60;       // ponytail: raw counts; lower it if a weak finger never beats
const REARM = 0.1;          // dip this far (of the swing) below the middle before the next beat
// bpm: the median of the last BPM_BEATS beats (like the SparkFun example's average of
// recent beats), refined by averaging the beats within 10% of it. A missed or extra beat
// is far from the median and drops out; averaging the rest avoids the steps that
// whole-sample beat intervals give a plain median.
const BPM_BEATS = 5;
function robustBpm(a) {
  const m = [...a].sort((x, y) => x - y)[a.length >> 1];
  const near = a.filter((x) => Math.abs(x - m) <= 0.1 * m);
  return near.reduce((sum, x) => sum + x, 0) / near.length;
}

// Bad-read filter. A reading that can't be part of a pulse while a finger is on: a brief drop
// below FINGER_MIN (the finger slips, a bus error reads 0), a saturated ADC, or a lone sample far
// off the wave (a bus glitch). It is replaced by the last good reading, for at most HOLD samples:
// anything that lasts longer is real (finger lifted, pressure changed) and goes through. Clean
// readings are never touched, so the filter changes nothing on a clean signal.
const HOLD = 5;                       // ponytail: 100 ms at 50 Hz; tune from logs (tools/analyze-log.mjs)
const SAT = 262000;                   // the 18-bit ADC tops out at 262143
const SPIKE_K = 12, SPIKE_MIN = 3000; // ponytail: a glitch is off the smoothed level by > max(12 swings, 3000 counts)

export function createChannel(rate = 50, { filter = true } = {}) {
  const dcA = 1 / (rate * 0.5);                // DC tracker, ~0.5 s: lets go of a settling finger fast
  const lpA = 0.4;                             // light smoothing against sensor fuzz
  const envDecay = 1 - 1 / (rate * 2);         // envelope forgets over ~2 s (amp only)
  const refractory = Math.round(rate * 0.3);   // caps at 200 BPM
  const N = Math.round(rate * WINDOW_S);
  const warmup = Math.round(rate * 0.5);       // need some wave before the middle means anything
  const win = new Float32Array(N);
  let dc = null, lp = 0, prevAc = 0, env = 0, n = 0, k = 0, armed = true;
  let lastBeat = -Infinity, bpm = 0, inst = 0, recent = [];
  let bad = 0, good = 0, swing = 0;   // filter: run of bad readings, last good reading, last window swing

  return function step(raw) {
    n++;
    let held = false;
    if (filter && dc !== null) {      // a finger is on: screen this reading
      const off = raw < FINGER_MIN, sat = raw >= SAT;
      const spike = !off && !sat && k >= warmup && Math.abs(raw - lp) > Math.max(SPIKE_K * swing, SPIKE_MIN);
      if (off || sat || spike) {
        if (bad < HOLD) { bad++; raw = good; held = true; }
        else if (spike) { lp = raw; bad = 0; } // it lasted: a real level shift, so smoothing restarts there
        // off and sat that last past HOLD go through: the finger lifted, or the sensor really is saturated
      } else bad = 0;
    }
    if (raw < FINGER_MIN) {
      dc = null; env = 0; bpm = 0; inst = 0; recent = []; prevAc = 0; k = 0; armed = true; lastBeat = -Infinity; bad = 0;
      return { finger: false, ac: 0, beat: false, bpm: 0, amp: 0, inst: 0, held: false };
    }
    if (!held) good = raw;
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
    const mid = (hi + lo) / 2;
    swing = hi - lo;
    if (ac < mid - REARM * swing) armed = true;
    const beat = armed && prevAc < mid && ac >= mid && swing > MIN_SWING
      && k >= warmup && n - lastBeat > refractory;
    if (beat) armed = false;
    prevAc = ac;
    if (beat) {
      if (lastBeat !== -Infinity) {
        inst = (60 * rate) / (n - lastBeat);  // unsmoothed, latest beat only
        recent = [...recent.slice(1 - BPM_BEATS), inst];
        bpm = robustBpm(recent);
      }
      lastBeat = n;
    }
    // amp: pulse envelope (finger pressure). inst: BPM of the latest beat, 0 until two beats.
    // held: this reading was a bad read, replaced by the last good one.
    return { finger: true, ac, beat, bpm, amp: env, inst, held };
  };
}
