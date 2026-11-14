// The stage canvas: one requestAnimationFrame loop draws everything on it.
// B3: voice panels in the stage rect. B4: drum ripples + pad wash here, notes lane in lane.js.
import { on, VOICES } from '../bus.js';
import { drawLane } from './lane.js';

const N = 200;          // ring buffer: ~4 s of frames at 50 Hz
const STALE_MS = 500;   // no frame for this long = treat every channel as no finger
const BEAT_MS = 150;    // ponytail: beat swell + glow flare decay time
const SWELL = 0.2;      // ponytail: blob grows ~20% on a beat
const LEVEL_TAU = 0.2;  // ponytail: seconds, smoothing of |ac| that drives blob radius
const GLOW = 2.5;       // ponytail: blob glow in vh, at rest
const FLARE = 4;        // ponytail: extra glow in vh at the peak of a beat
const RIPPLE_MS = 1200; // ponytail: drum ripple life
const RIPPLE = 1.5;     // ponytail: ripple grows to R * (1 + RIPPLE * velocity)
const WASH_MS = 7000;   // ponytail: pad wash fade
const rm = matchMedia('(prefers-reduced-motion: reduce)'); // live: .matches is read each use

const cv = document.getElementById('stage');
const c = cv.getContext('2d');
const css = getComputedStyle(document.documentElement);
const tok = (name) => css.getPropertyValue(name).trim();
// ponytail: tokens are 6-digit hex; parse more formats if style.css ever changes that
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${a})`; };
const TEXT = tok('--text'), MUTED = tok('--muted'), DIM = rgba(TEXT, 0.3), SERIF = tok('--serif');
document.fonts.load(`10px ${SERIF}`); // roman Fraunces isn't used by the DOM, so ask for it

const P = VOICES.map((v, i) => {
  const col = tok(`--${v}`) || tok('--other');
  const fill = c.createRadialGradient(-0.3, -0.3, 0, 0, 0, 1.1); // unit blob, scaled at draw time
  fill.addColorStop(0, rgba(col, 0.95));
  fill.addColorStop(1, rgba(col, 0.12));
  return { col, fill, dash: rgba(col, 0.45), trace: null, on: `${v} · bpm`, off: `rest a finger on sensor ${i + 1}`,
    buf: new Float32Array(N), head: 0, count: 0, max: 1, last: 0, level: 0, beatAt: -1e9 };
});
const COL = { other: tok('--other'), text: TEXT, muted: MUTED, serif: SERIF }; // lane colours
COL.v = Object.assign(Object.create(null), ...VOICES.map((v, i) => ({ [v]: P[i].col }))); // null prototype: 'constructor' etc. fall back to --other
COL.lead = COL.v.lead;

// music: drum ripples (pool, reused) and the pad wash
const DI = VOICES.indexOf('drums');
const RIP = Array.from({ length: 8 }, () => ({ t: -1e9, vel: 0 })); // ponytail: 8 live ripples is plenty at 16th-note drums
let ripHead = 0;
on('note', (n) => {
  if (n.voice === 'drums') {
    const r = RIP[ripHead = (ripHead + 1) % RIP.length];
    r.t = performance.now(); r.vel = typeof n.velocity === 'number' ? n.velocity : 0.7;
  } else if (n.voice === 'pad') {
    // full-screen wash: body::before in style.css (behind header and canvas), faded by the compositor
    const root = Array.isArray(n.notes) ? n.notes[0] : NaN, k = Number.isFinite(root) ? (((root % 12) + 12) % 12) % 3 : 0;
    document.body.style.setProperty('--wash', `var(--wash-${k + 1})`); // hue from the root's pitch class: same chord, same hue
    document.body.animate({ opacity: [1, 0] }, { duration: rm.matches ? WASH_MS * 2 : WASH_MS, pseudoElement: '::before' });
  }
});

// frames only update state; drawing happens in the loop
let frame = null, frameAt = -1e9;
on('frame', (f) => {
  const now = performance.now(), gap = now - frameAt > STALE_MS;
  frame = f; frameAt = now;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], ch = f.ch?.[i];
    if (gap || !ch?.finger) { p.count = 0; p.max = 1; p.level = 0; } // fresh scale for a new finger
    if (!ch?.finger) continue;
    p.buf[p.head] = p.last = ch.ac;
    p.head = (p.head + 1) % N;
    p.count = Math.min(N, p.count + 1);
    let m = 1; // floor: a flat signal shouldn't divide by zero
    for (let k = 1; k <= p.count; k++) m = Math.max(m, Math.abs(p.buf[(p.head - k + N) % N]));
    p.max = m;
    if (ch.beat) p.beatAt = now; // latched, so a beat between two rAF ticks isn't lost
  }
});

// layout, recomputed on resize. Canvas = stage (~60) over lane (~23), as in the spec.
let W = 0, H = 0, dpr = 1, u = 1, stage, lane;
let R, cy, bpmY, labelY, traceY, traceH, traceW, bpmFont, labelFont, DASH;
const SOLID = [];
function resize() {
  dpr = devicePixelRatio || 1;
  const b = cv.getBoundingClientRect();
  W = b.width; H = b.height; u = innerHeight / 100;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sh = (H * 60) / 83;
  stage = { x: 0, y: 0, w: W, h: sh };
  lane = { x: 0, y: sh, w: W, h: H - sh }; // B4 draws here
  const colW = stage.w / VOICES.length;
  R = Math.min(colW * 0.22, 9 * u);
  traceW = colW * 0.8; traceH = 9 * u;
  const above = 1.35 * R, below = R + 25 * u; // room for swell + harmonics; BPM, label, trace
  cy = stage.y + Math.max(0, (stage.h - above - below) / 2) + above;
  bpmY = cy + R + 7 * u; labelY = bpmY + 6.5 * u; traceY = labelY + 2.5 * u;
  bpmFont = `${10 * u}px ${SERIF}`; labelFont = `italic ${2.6 * u}px ${SERIF}`;
  DASH = [0.4 * u, 1 * u];
  P.forEach((p, i) => {
    const x = colW * (i + 0.5) - traceW / 2;
    p.trace = c.createLinearGradient(x, 0, x + traceW, 0); // fades toward the oldest sample (left)
    p.trace.addColorStop(0, rgba(p.col, 0));
    p.trace.addColorStop(0.6, rgba(p.col, 0.7));
    p.trace.addColorStop(1, p.col);
  });
}
new ResizeObserver(resize).observe(cv);

// outline from two slow sine harmonics
function blobPath(x, y, r, t, i) {
  c.beginPath();
  for (let k = 0; k <= 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const rr = r * (1 + 0.06 * Math.sin(3 * a + t * (1 + i * 0.2)) + 0.04 * Math.sin(5 * a - t * 1.3 + i));
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

function drawPanels(now, dt, live) {
  const t = now / 1000, colW = stage.w / VOICES.length, ease = 1 - Math.exp(-dt / LEVEL_TAU);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < P.length; i++) {
    const p = P[i], ch = live ? frame.ch?.[i] : null, touching = !!ch?.finger, cx = stage.x + colW * (i + 0.5);
    if (touching) {
      const kick = Math.min(1, Math.max(0, 1 - (now - p.beatAt) / BEAT_MS)) ** 2;
      p.level += (Math.abs(p.last) / p.max - p.level) * ease;
      const r = R * (0.85 + 0.15 * p.level + (rm.matches ? 0 : SWELL * kick));
      c.save();
      if (rm.matches) c.globalAlpha = 0.75 + 0.25 * kick; // reduced motion: brief opacity lift instead of swell and flare
      c.translate(cx, cy); c.scale(r, r);
      blobPath(0, 0, 1, t, i);
      c.fillStyle = p.fill; c.shadowColor = p.col;
      c.shadowBlur = (GLOW + (rm.matches ? 0 : FLARE * kick)) * u * dpr; // shadowBlur ignores the transform
      c.fill();
      c.restore();
    } else {
      blobPath(cx, cy, R * 0.8, t, i);
      c.setLineDash(DASH); c.strokeStyle = p.dash; c.lineWidth = Math.max(1.5, 0.2 * u); c.stroke(); c.setLineDash(SOLID);
    }

    c.font = bpmFont; c.fillStyle = touching ? TEXT : DIM;
    c.fillText(touching && ch.bpm > 0 ? String(Math.round(ch.bpm)) : '--', cx, bpmY);
    c.font = labelFont; c.fillStyle = touching ? p.col : MUTED;
    c.fillText(touching ? p.on : p.off, cx, labelY);

    if (touching && p.count > 1) { // newest sample at the right edge, scaled by this channel's own max
      const x1 = cx + traceW / 2, mid = traceY + traceH / 2;
      c.save();
      c.strokeStyle = p.trace; c.lineWidth = Math.max(1.5, 0.45 * u); c.lineJoin = c.lineCap = 'round';
      c.shadowColor = p.col; c.shadowBlur = 0.8 * u * dpr;
      c.beginPath();
      for (let k = p.count - 1; k >= 0; k--) {
        c.lineTo(x1 - (k / (N - 1)) * traceW, mid - (p.buf[(p.head - 1 - k + N) % N] / p.max) * traceH * 0.45);
      }
      c.stroke();
      c.restore();
    }
  }
}

function drawRipples(now) {
  const cx = stage.x + (stage.w / VOICES.length) * (DI + 0.5);
  c.strokeStyle = P[DI].col; c.lineWidth = Math.max(1.5, 0.25 * u);
  for (let i = 0; i < RIP.length; i++) {
    const r = RIP[i], a = Math.max(0, now - r.t) / RIPPLE_MS;
    if (a >= 1) continue;
    c.globalAlpha = (1 - a) * 0.7;
    c.beginPath(); c.arc(cx, cy, R * (1 + a * RIPPLE * r.vel), 0, 2 * Math.PI); c.stroke();
  }
  c.globalAlpha = 1;
}

let prev = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now; // time-based, so 60 Hz and 120 Hz look alike
  if ((devicePixelRatio || 1) !== dpr) resize(); // moved to a screen with another pixel ratio
  if (W) {
    c.clearRect(0, 0, W, H);
    drawPanels(now, dt, frame && now - frameAt < STALE_MS);
    if (DI >= 0 && !rm.matches) drawRipples(now);
    drawLane(c, lane, now, u, dpr, COL);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
