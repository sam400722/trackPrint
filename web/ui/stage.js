// The stage: one requestAnimationFrame loop. fluid.js draws the ferrofluid balls and their
// windows on #gl; this file feeds it live heartbeats, lays out both states (assigning, merged),
// moves the BPM and label text in #text, and draws the pulse traces and notes lane on #stage.
// Ported from docs/superpowers/specs/2026-11-14-trackprint-ferrofluid-mockups.html.
import { on, VOICES } from '../bus.js';
import { drawLane } from './lane.js';
import { mergeStep, newField, stepField } from './dynamics.js';
import { createFluid } from './fluid.js';

const N = 200;          // ring buffer: ~4 s of frames at 50 Hz
const STALE_MS = 500;   // no frame for this long = treat every channel as no finger
const SLIDE_S = 1.6;    // assign <-> merged transition
// blob body radii, in u (1% of app height); the window behind each body is WINDOW_K times its body radius
const ASSIGN_R_MAX = 7.92, ASSIGN_R_COL = .176;   // assigning state: at most this many u, and at most this fraction of a column width
const ROW_R = 3.52, MERGED_R = 13.2;              // bottom row blobs; the big merged blob
const WINDOW_K = 1.67;                            // window radius / body radius
const PRES_TAU = .25;                             // seconds: finger presence easing
const rm = matchMedia('(prefers-reduced-motion: reduce)'); // live: .matches is read each use

const $ = (id) => document.getElementById(id);
const lerp = (a, b, k) => a + (b - a) * k, clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => (x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
// ponytail: tokens are 6-digit hex; parse more formats if style.css ever changes that
const hex3 = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

const cv = $('stage'), c = cv.getContext('2d');
const css = getComputedStyle(document.documentElement);
const tok = (name) => css.getPropertyValue(name).trim();
const NUM = tok('--num');
document.fonts.load(`10px ${NUM}`); // roman Fraunces isn't used by the DOM, so ask for it

const COLS = VOICES.map((v) => tok(`--${v}`) || tok('--other'));
const COL = { other: tok('--other'), text: tok('--text'), muted: tok('--muted'), line: tok('--line'), serif: NUM }; // lane colours
COL.v = Object.assign(Object.create(null), ...VOICES.map((v, i) => ({ [v]: COLS[i] }))); // null prototype: 'constructor' etc. fall back to --other
COL.lead = COL.v.lead;

const err = $('err'), text = $('text');
const fluid = createFluid($('gl'), COLS.map(hex3), (msg) => { err.textContent += (err.textContent ? '\n' : '') + msg; });

const P = VOICES.map((v, i) => {
  const bpm = document.createElement('div'), lab = document.createElement('div');
  bpm.className = 'bpm'; lab.className = 'lab'; text.append(bpm, lab);
  return { v, i, col: COLS[i], bpm, lab, f: newField(), pres: 0, m: 0, cx: 0, trace: null,
    buf: new Float32Array(N), head: 0, count: 0, max: 1, beat: false };
});

let sensorCh = null; // ?fill=sim debugging: the voice the real sensor plays
on('sensor', (s) => (sensorCh = s));
on('note', (n) => { const i = VOICES.indexOf(n?.voice); if (i >= 0) P[i].f.rip = 1; }); // a note ripples its player's ball

// frames only update state; drawing happens in the loop
let frame = null, frameAt = -1e9;
on('frame', (f) => {
  const now = performance.now(), gap = now - frameAt > STALE_MS;
  frame = f; frameAt = now;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], ch = f.ch?.[i];
    if (gap || !ch?.finger) { p.count = 0; p.max = 1; p.beat = false; } // fresh scale for a new finger
    if (!ch?.finger) continue;
    p.buf[p.head] = ch.ac;
    p.head = (p.head + 1) % N;
    p.count = Math.min(N, p.count + 1);
    let m = 1; // floor: a flat signal shouldn't divide by zero
    for (let k = 1; k <= p.count; k++) m = Math.max(m, Math.abs(p.buf[(p.head - k + N) % N]));
    p.max = m;
    if (ch.beat) p.beat = true; // latched, so a beat between two rAF ticks isn't lost
  }
});

// layout, recomputed on resize
let W = 0, H = 0, u = 1, dpr = 1, gen = 0; // gen counts resizes, so text is re-placed after one
function resize() {
  const b = cv.getBoundingClientRect();
  W = b.width; H = b.height; u = H / 100; dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  fluid?.resize(W, H, dpr); gen++;
  const colW = W / 4, tw = colW * .56;
  P.forEach((p, i) => { // trace gradients only depend on the column, so build them here
    p.cx = colW * (i + .5);
    const x0 = p.cx - tw / 2, g = p.trace = c.createLinearGradient(x0, 0, x0 + tw, 0);
    g.addColorStop(0, p.col + '00'); g.addColorStop(.6, p.col + 'b0'); g.addColorStop(1, p.col);
  });
}
new ResizeObserver(resize).observe(cv);

const UB = new Float32Array(15), US = new Float32Array(16), ULf = new Float32Array(4), UFl = new Float32Array(4);
const ready = [false, false, false, false], bumps = [false, false, false, false];
let st = { merged: false, upAt: null }, prog = 0, prev = 0, lastFade = -1;

function loop(ms) {
  requestAnimationFrame(loop);
  if (Math.min(devicePixelRatio || 1, 2) !== dpr) resize(); // moved to a screen with another pixel ratio
  const t = ms / 1000, dt = Math.min(.033, Math.max(0, t - prev)); prev = t; // time-based, so 60 Hz and 120 Hz look alike
  if (!W) return;
  const reduce = rm.matches, live = frame && ms - frameAt < STALE_MS;

  for (const p of P) {
    const ch = live ? frame.ch?.[p.i] : null, down = !!ch?.finger;
    p.ch = ch; p.down = down; ready[p.i] = down && ch.bpm > 0;
    p.pres += (+down - p.pres) * (1 - Math.exp(-dt / PRES_TAU));
    const beat = down && p.beat;
    p.beat = false; bumps[p.i] = beat;
    stepField(p.f, beat, dt);
  }
  st = mergeStep(st, ready, ms);
  const step_ = dt / (reduce ? .5 : SLIDE_S);
  prog = clamp01(prog + Math.min(step_, Math.max(-step_, +st.merged - prog)));
  const fade = reduce ? Math.abs(2 * prog - 1) : 1; // reduced motion: cross-fade between the two layouts, no slide

  const colW = W / 4, RA = Math.min(colW * ASSIGN_R_COL, ASSIGN_R_MAX * u), RS = ROW_R * u, RB = MERGED_R * u;
  const RW = RB * WINDOW_K, TXO = RS * WINDOW_K + 2.4 * u;   // window radius of the big one; text offset right of a row blob
  const big = reduce ? +(prog > .5) : ease(clamp01((prog - .35) / .65));
  for (const p of P) {
    const i = p.i, f = p.f;
    const m = reduce ? +(prog > .5) : ease(clamp01((prog - i * .07) / .79)); // the four leave one after another
    const cx = p.cx, bx = cx - 5 * u, x = lerp(cx, bx, m), y = lerp(37 * u, 74 * u, m), Rr = lerp(RA, RS, m);   // assign column centre -> row slot; y in u
    const top = lerp(13, 62, m) * u, bot = lerp(56, 81, m) * u, cy = Math.min(Math.max(y, top + Rr), bot - Rr), sc = lerp(.6, 1, p.pres);   // sc: body grows with presence
    UB.set([x * dpr, (H - cy) * dpr, Rr * sc * dpr], i * 3);
    US.set([reduce ? 0 : Math.max(f.F, 0), reduce ? 0 : Math.max(f.L, 0), reduce ? 0 : f.rip, p.pres], i * 4); ULf[i] = reduce ? f.lift : 0; UFl[i] = reduce ? 0 : f.fl;
    const tx = lerp(cx, bx + TXO, m), sh = `translate(${-50 * (1 - m)}%, -50%)`;
    // the DOM is only written when a value changes: an unchanged frame costs no style or layout work
    const bt = ready[i] ? String(Math.round(p.ch.bpm)) : '--';
    if (bt !== p.bt) { p.bpm.textContent = p.bt = bt; p.bpm.classList.toggle('off', !ready[i]); }
    const lt = (p.down ? `${p.v} · bpm` : `rest a finger on sensor ${i + 1}`) + (live && i === sensorCh ? ' · sensor' : '');
    if (lt !== p.lt) p.lab.textContent = p.lt = lt;
    if (m !== p.pm || gen !== p.gen) { // moved (slide) or resized
      p.pm = m; p.gen = gen;
      Object.assign(p.bpm.style, { left: `${tx}px`, top: `${lerp(62, 73, m) * u}px`, fontSize: `${lerp(9, 4.4, m) * u}px`, transform: sh });
      Object.assign(p.lab.style, { left: `${tx}px`, top: `${lerp(69, 76.8, m) * u}px`, fontSize: `${lerp(2.1, 1.7, m) * u}px`, transform: sh });
    }
    p.m = m;
  }
  const Rg = RB * big, cyB = Math.min(Math.max(38 * u, 13 * u + Rg), 62 * u - Rg);   // merged blob centre y, kept inside its band
  UB.set([W / 2 * dpr, (H - cyB) * dpr, big > .02 ? Rg * dpr : 0], 12);
  if (fade !== lastFade) text.style.opacity = lastFade = fade;
  fluid?.frame({ t, dt, fade, rm: reduce, blobs: UB, state: US, lift: ULf, flash: UFl,
    dye: prog > .05 ? { x: W / 2, y: 38 * u, cyB, RW, big, bumps } : null });

  c.clearRect(0, 0, W, H);
  drawTraces(fade);
  drawLane(c, { x: 0, y: 84 * u, w: W, h: 16 * u }, ms, u, dpr, COL);
}

// pulse traces (assigning state only): newest sample at the right, scaled by the channel's own max
function drawTraces(fade) {
  const tw = (W / 4) * .56, mid = 77 * u, amp = 3.2 * u;
  c.save();
  c.lineJoin = c.lineCap = 'round'; c.lineWidth = Math.max(1.5, .35 * u);
  for (const p of P) {
    const a = p.pres * (1 - p.m) * fade;
    if (a < .01 || p.count < 2) continue;
    const x1 = p.cx + tw / 2;
    c.globalAlpha = a; c.strokeStyle = p.trace;
    c.beginPath();
    for (let k = p.count - 1; k >= 0; k--) c.lineTo(x1 - (k / (N - 1)) * tw, mid - (p.buf[(p.head - 1 - k + N) % N] / p.max) * amp);
    c.stroke();
  }
  c.restore();
}

requestAnimationFrame(loop);
