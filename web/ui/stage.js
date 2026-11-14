// The stage canvas: one requestAnimationFrame loop draws everything on it.
// B3: voice panels in the stage rect. B4: drum ripples + pad wash here, notes lane in lane.js.
import { on, VOICES } from '../bus.js';
import { drawLane } from './lane.js';

const N = 200;          // ring buffer: ~4 s of frames at 50 Hz
const STALE_MS = 500;   // no frame for this long = treat every channel as no finger
const BEAT_MS = 150;    // ponytail: beat swell + rim/sparkle flare decay time
const SWELL = 0.2;      // ponytail: blob grows ~20% on a beat
const LEVEL_TAU = 0.2;  // ponytail: seconds, smoothing of |ac| that drives blob radius
const DUST = 320;       // ponytail: sparkle points per blob
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

// liquid metal, in unit-blob space (scaled at draw time): banded chrome body, a dark hollow, warm reflections
const grad = (g, stops) => (stops.forEach(([o, s]) => g.addColorStop(o, s)), g);
const radial = (x, y, r, stops) => grad(c.createRadialGradient(x, y, 0, x, y, r), stops);
// one metal per voice, tinted toward its colour. shape: outline waves [n, amp, speed, phase]; drips: slow
// bulges that stretch toward an angle (canvas radians, pi/2 = down) [angle, width, amp, speed, phase]; the
// first drip is where a droplet pinches off on each beat. hollow [x, y, r]; lip: lit arc of the hollow [from, to].
// ponytail: layout leaves 1.6 R above and ~1.5 R below the centre; keep wave amps + biggest drip within that
const METAL = {
  drums: { tint: [232, 146, 104], shape: [[2, 0.1, 0.6, 0], [3, 0.08, 0.9, 1], [5, 0.04, -1.3, 2]],        // copper, lopsided, leaking down-left
    drips: [[1.9, 0.34, 0.5, 0.7, 0], [0.2, 0.3, 0.32, 0.5, 2]], hollow: [0.12, -0.12, 0.5], lip: [-2.2, 0.8] },
  bass: { tint: [150, 186, 222], shape: [[2, 0.14, 0.35, 1.7], [3, 0.05, 0.7, 0], [1, 0.07, 0.5, 0.5]],    // blue steel, heavy, sags
    drips: [[1.3, 0.42, 0.45, 0.4, 1], [2.5, 0.3, 0.3, 0.6, 3]], hollow: [-0.1, -0.05, 0.62], lip: [1.9, 4.4] },
  lead: { tint: [246, 206, 120], shape: [[1, 0.1, 0.45, 0], [2, 0.07, 0.65, 2], [4, 0.05, 1.1, 0]],       // gold, quick, one tendril reaching up-left
    drips: [[1, 0.3, 0.45, 0.8, 0], [3.6, 0.28, 0.4, 0.55, 1.5]], hollow: [0.2, -0.2, 0.42], lip: [-0.9, 1.9] },
  pad: { tint: [186, 162, 228], shape: [[3, 0.09, 0.4, 0], [2, 0.07, 0.3, 3], [5, 0.04, -0.8, 1]],        // violet titanium, slow, three small drips
    drips: [[1.57, 0.36, 0.4, 0.35, 0], [0.5, 0.28, 0.28, 0.8, 2], [2.7, 0.28, 0.28, 0.65, 4]], hollow: [0, 0.05, 0.6], lip: [-3.1, -0.7] },
};
const SILVER = { tint: [205, 210, 218], shape: [[2, 0.05, 0.5, 0], [3, 0.05, 1, 0], [5, 0.03, -1.3, 0]], drips: [], hollow: [0.14, -0.14, 0.55], lip: [-2.6, 0.5] };
const BANDS = [[0, 0.78], [0.2, 0.96], [0.33, 0.55], [0.45, 0.17], [0.56, 0.34], [0.68, 0.77], [0.8, 0.42], [0.92, 0.16], [1, 0.07]]; // sky, horizon, ground
const lit = (tint, L) => `rgb(${tint.map((v) => Math.round(v * L * (1 - L ** 3) + 255 * L ** 3)).join(' ')})`; // bright bands go white
const RIM = radial(0, 0, 1.15, [[0.62, 'rgb(0 0 0 / 0)'], [0.84, 'rgb(0 0 0 / .45)'], [1, 'rgb(0 0 0 / .1)']]); // multiply: darker band inside the rim
const SHINE = [ // screen: warm reflections, then small white hot spots
  radial(-0.62, 0.48, 0.5, [[0, 'rgb(236 166 84 / .9)'], [1, 'rgb(236 166 84 / 0)']]),
  radial(-0.1, 0.8, 0.35, [[0, 'rgb(224 152 72 / .65)'], [1, 'rgb(224 152 72 / 0)']]),
  radial(-0.05, 0.02, 0.3, [[0, 'rgb(200 146 70 / .3)'], [1, 'rgb(200 146 70 / 0)']]),
  radial(0.5, -0.38, 0.1, [[0, 'rgb(255 255 255 / .7)'], [1, 'rgb(255 255 255 / 0)']]),
  radial(-0.48, 0.1, 0.22, [[0, 'rgb(255 255 255 / .45)'], [1, 'rgb(255 255 255 / 0)']]),
];
const WARM = 'rgb(255 214 160)';

const P = VOICES.map((v, i) => {
  const col = tok(`--${v}`) || tok('--other'), m = METAL[v] || SILVER, [hx, hy, hr] = m.hollow;
  const body = grad(c.createLinearGradient(-0.7, -1, 0.7, 1), BANDS.map(([o, L]) => [o, lit(m.tint, L)]));
  const drop = radial(-0.3, -0.3, 1.2, [[0, lit(m.tint, 0.95)], [0.4, lit(m.tint, 0.55)], [0.8, lit(m.tint, 0.15)], [1, lit(m.tint, 0.4)]]);
  const hollow = radial(hx, hy, hr, [[0, 'rgb(0 0 0 / .85)'], [0.6, 'rgb(0 0 0 / .45)'], [1, 'rgb(0 0 0 / 0)']]);
  const dust = new Float32Array(DUST * 4); // x, y, alpha, twinkle phase (NaN = steady)
  for (let k = 0; k < DUST; k++) {
    const a = Math.random() * 2 * Math.PI, d = 0.95 * Math.random() ** 0.6; // a little denser toward the middle
    dust.set([Math.cos(a) * d, Math.sin(a) * d, 0.1 + 0.8 * Math.random() ** 3, Math.random() < 0.3 ? Math.random() * 6.3 : NaN], k * 4);
  }
  return { col, body, hollow, hx, hy, hr, shape: m.shape, drips: m.drips, drop, lip: m.lip, dust, edge: rgba(col, 0.3), dash: rgba(col, 0.45), trace: null, on: `${v} · bpm`, off: `rest a finger on sensor ${i + 1}`,
    buf: new Float32Array(N), head: 0, count: 0, max: 1, last: 0, level: 0, beatAt: -1e9 };
});
const COL = { other: tok('--other'), text: TEXT, muted: MUTED, serif: SERIF }; // lane colours
COL.v = Object.assign(Object.create(null), ...VOICES.map((v, i) => ({ [v]: P[i].col }))); // null prototype: 'constructor' etc. fall back to --other
COL.lead = COL.v.lead;

// music: drum ripples (pool, reused) and the pad wash
const DI = VOICES.indexOf('drums');
const RIP = Array.from({ length: 8 }, () => ({ t: -1e9, vel: 0 })); // ponytail: 8 live ripples is plenty at 16th-note drums
let ripHead = 0;
let sensorCh = null; // ?fill=sim debugging: the voice the real sensor plays
on('sensor', (s) => (sensorCh = s));

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
  const above = 1.6 * R, below = R + 30 * u; // ponytail: tips reach ~1.5 R down, droplets fade before the BPM; room for swell + waves; drips; BPM, label, trace
  cy = stage.y + Math.max(0, (stage.h - above - below) / 2) + above;
  bpmY = cy + R + 12 * u; labelY = bpmY + 6.5 * u; traceY = labelY + 2.5 * u;
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

// on a beat the first drip stretches for STRETCH_S seconds, then snaps back as a droplet pinches off its tip
const STRETCH_S = 0.25, STRETCH = 0.3, DROP_S = 0.9;
const stretch = (p, t) => { const a = t - p.beatAt / 1000; return rm.matches || a < 0 || a >= STRETCH_S ? 0 : STRETCH * a / STRETCH_S; };
// outline from the voice's slow sine harmonics; a0..a1 draws an open arc
function blobPath(x, y, r, t, i, a0 = 0, a1 = 2 * Math.PI) {
  const sh = P[i].shape, st = stretch(P[i], t);
  c.beginPath();
  for (let k = 0; k <= 160; k++) { // fine enough for narrow drips
    const a = a0 + (k / 160) * (a1 - a0);
    let rr = 1;
    for (const [n, amp, sp, ph] of sh) rr += amp * Math.sin(n * a + t * sp + ph);
    if (r === 1) P[i].drips.forEach(([ang, w, amp, sp, ph], j) => { // only the outline drips, not the inner arcs
      const d = Math.atan2(Math.sin(a - ang), Math.cos(a - ang));
      rr += (amp * (0.5 + 0.5 * Math.sin(t * sp + ph)) + (j ? 0 : st)) * Math.exp(-(d * d) / (w * w));
    });
    rr *= r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  if (a1 - a0 >= 2 * Math.PI) c.closePath();
}

// a blurred stroke without ctx.filter (no Safari): stroke 4 units to the right, shadow lands back, clip hides the stroke
function soft(r, blur, col, width, path) {
  c.shadowColor = col; c.shadowBlur = blur * r * dpr; c.shadowOffsetX = -4 * r * dpr; // shadow ignores the transform
  c.translate(4, 0); path(); c.lineWidth = width; c.stroke(); c.translate(-4, 0);
  c.shadowBlur = c.shadowOffsetX = 0;
}

// the droplet falls from the first drip's tip and fades
function drawDrop(p, t) {
  const a = t - p.beatAt / 1000 - STRETCH_S, dr = p.drips[0];
  if (!dr || a < 0 || a >= DROP_S) return;
  const q = a / DROP_S, tip = 1.05 + STRETCH + dr[2] * (0.5 + 0.5 * Math.sin((t - a) * dr[3] + dr[4])); // tip as it was at the snap
  const x = Math.cos(dr[0]) * tip, y = Math.sin(dr[0]) * tip + 1.2 * q * q, s = 0.2 - 0.08 * q;
  c.save();
  c.globalAlpha = 1 - q; c.translate(x, y); c.scale(s, s * (1 + 0.5 * q)); // stretches as it falls
  c.beginPath(); c.arc(0, 0, 1, 0, 2 * Math.PI); c.fillStyle = p.drop; c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(-0.35, -0.4, 0.2, 0, 2 * Math.PI); c.fill();
  c.restore();
}

function drawMetal(p, r, t, i, kick) {
  if (!rm.matches) drawDrop(p, t);
  blobPath(0, 0, 1, t, i);
  c.fillStyle = p.body; c.fill(); c.clip();
  c.globalCompositeOperation = 'multiply';
  for (const g of [p.hollow, RIM]) { c.fillStyle = g; c.fillRect(-1.5, -1.5, 3, 3); }
  c.globalCompositeOperation = 'screen';
  for (const g of SHINE) { c.fillStyle = g; c.fillRect(-1.5, -1.5, 3, 3); }
  c.strokeStyle = '#000'; c.lineCap = 'round'; // only the shadows of these strokes show
  soft(r, 0.05, 'rgb(255 255 255 / .85)', 0.07, () => blobPath(p.hx, p.hy, p.hr, t, i, ...p.lip)); // lit lip of the hollow
  soft(r, 0.08, 'rgb(255 255 255 / .6)', 0.09, () => blobPath(0, 0.04, 0.74, t, i, 1.6, 3.3));        // lower-left smear
  soft(r, 0.02, 'rgb(255 255 255 / .8)', 0.035, () => blobPath(0, 0, 1, t, i, -2.4, 0.9));           // thin bright rim, top
  soft(r, 0.07, kick ? rgba(p.col, 0.3 + 0.5 * kick) : p.edge, 0.06, () => blobPath(0, 0, 1, t, i));  // voice-tinted edge, flares on a beat
  // sparkle dust, under 1 css px whatever the blob size
  const s = 0.75 / r, d = p.dust, base = c.globalAlpha;
  for (let k = 0; k < d.length; k += 4) {
    const ph = d[k + 3], tw = ph !== ph || rm.matches ? 1 : 0.5 + 0.5 * Math.sin(t * 3 + ph); // ph !== ph: NaN, steady
    c.globalAlpha = base * Math.min(1, d[k + 2] * tw * (1 + kick));
    c.fillStyle = k % 20 ? '#fff' : WARM; // every 5th point warm
    c.fillRect(d[k], d[k + 1], s, s);
  }
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
      if (rm.matches) c.globalAlpha = 0.75 + 0.25 * kick; // reduced motion: brief opacity lift instead of swell, flare and twinkle
      c.translate(cx, cy); c.scale(r, r);
      drawMetal(p, r, t, i, rm.matches ? 0 : kick);
      c.restore();
    } else {
      blobPath(cx, cy, R * 0.8, t, i);
      c.setLineDash(DASH); c.strokeStyle = p.dash; c.lineWidth = Math.max(1.5, 0.2 * u); c.stroke(); c.setLineDash(SOLID);
    }

    c.font = bpmFont; c.fillStyle = touching ? TEXT : DIM;
    c.fillText(touching && ch.bpm > 0 ? String(Math.round(ch.bpm)) : '--', cx, bpmY);
    c.font = labelFont; c.fillStyle = touching ? p.col : MUTED;
    c.fillText((touching ? p.on : p.off) + (live && i === sensorCh ? ' · sensor' : ''), cx, labelY);

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
    if (DI >= 0 && !rm.matches) drawRipples(now); // under the panels, so the drums BPM stays readable
    drawPanels(now, dt, frame && now - frameAt < STALE_MS);
    drawLane(c, lane, now, u, dpr, COL);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
