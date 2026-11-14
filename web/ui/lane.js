// Notes lane: the last 5 s of `note` events (newest at the right) over a faint
// `wave` ribbon, captioned "what you hear". stage.js calls drawLane from its loop.
// Touches no DOM at import, so web/test.mjs can import the helpers in Node.
import { on } from '../bus.js';

const SPAN = 5000;              // ms of history across the lane
const LO = 40, HI = 108;        // ponytail: MIDI range mapped to lane height, clamped; today's notes are ~45–103
const DRUM = new Map([['kick', 1.4], ['snare', 1], ['hat', 0.6]]); // ponytail: ring size per drum; unknown = 1 (medium)
const DOT = [0.45, 0.6];        // ponytail: dot radius in vh = DOT[0] + DOT[1] * velocity

export const pitch01 = (m) => Math.min(1, Math.max(0, (m - LO) / (HI - LO)));

// Fixed-size ring of reusable records, newest first. live() drops records older than ms.
export function ring(size) {
  const slots = Array.from({ length: size }, () => ({ t: 0 }));
  let head = 0, count = 0;
  const at = (k) => slots[(head - k + size) % size];
  return {
    at, // 0 = newest
    add(t) { head = (head + 1) % size; count = Math.min(size, count + 1); const s = slots[head]; s.t = t; return s; },
    live(now, ms) { let k = 0; while (k < count && now - at(k).t <= ms) k++; return (count = k); },
  };
}

const notes = ring(256); // ponytail: ~15 notes/s in bits mode → ~75 live; overflow just drops the oldest
on('note', (n) => {
  const s = notes.add(performance.now()); // note fires when heard, so stamp now
  s.voice = n.voice; s.drum = n.drum;
  s.vel = typeof n.velocity === 'number' ? n.velocity : 0.7;
  s.lo = s.hi = s.root = NaN;
  if (Array.isArray(n.notes) && n.notes.length) {
    s.root = n.notes[0]; s.lo = Infinity; s.hi = -Infinity;
    for (const m of n.notes) { s.lo = Math.min(s.lo, m); s.hi = Math.max(s.hi, m); }
  }
});

let wave = null;
on('analyser', (a) => { wave = a?.wave ?? null; });

// per-frame geometry, module-level so X/Y aren't new closures every frame
let x0 = 0, w = 0, ly = 0, lh = 0, at = 0, capU = 0, capFont = '';
const X = (t) => x0 + w - ((at - t) / SPAN) * w;
const Y = (m) => ly + lh * 0.78 - (m === m ? pitch01(m) : 0.5) * lh * 0.62; // NaN pitch → middle

// col: { [voice]: hex, other, text, muted, serif }
export function drawLane(c, r, now, u, dpr, col) {
  x0 = r.x + 4 * u; w = r.w - 8 * u; ly = r.y; lh = r.h; at = now;
  const floor = ly + lh - 2.5 * u;
  c.save();
  c.lineJoin = c.lineCap = 'round';

  c.globalAlpha = 1; c.strokeStyle = col.line; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x0, ly - 1.5 * u); c.lineTo(x0 + w, ly - 1.5 * u); c.stroke();

  const d = wave?.getValue?.(); // reuses Tone's buffer: no allocation
  if (d?.length > 1) {
    const mid = r.y + r.h / 2, amp = r.h * 0.45;
    c.beginPath();
    for (let k = 0; k < d.length; k++) c.lineTo(x0 + (k / (d.length - 1)) * w, mid - d[k] * amp);
    c.strokeStyle = col.text;
    c.globalAlpha = 0.07; c.lineWidth = 1.2 * u; c.stroke(); // soft body of the ribbon
    c.globalAlpha = 0.2; c.lineWidth = Math.max(1, 0.2 * u); c.stroke();
  }

  const n = notes.live(now, SPAN);
  c.globalAlpha = 0.5; c.strokeStyle = col.lead; c.lineWidth = Math.max(1.5, 0.22 * u);
  c.beginPath(); // lead melody, oldest → newest, soft curve between consecutive notes
  let px = NaN, py = 0;
  for (let k = n - 1; k >= 0; k--) {
    const s = notes.at(k);
    if (s.voice !== 'lead' || s.root !== s.root) continue;
    const x = X(s.t), y = Y(s.root);
    if (px === px) c.quadraticCurveTo((px + x) / 2, py, x, y); else c.moveTo(x, y);
    px = x; py = y;
  }
  c.stroke();

  c.shadowBlur = 0;
  for (let k = n - 1; k >= 0; k--) {
    const s = notes.at(k), x = X(s.t), hue = col.v[s.voice] ?? col.other, rad = (DOT[0] + DOT[1] * s.vel) * u;
    c.globalAlpha = 1 - (now - s.t) / SPAN;
    c.beginPath();
    if (s.voice === 'drums') {
      c.arc(x, floor, rad * (DRUM.get(s.drum) ?? 1), 0, 2 * Math.PI);
      c.strokeStyle = hue; c.lineWidth = Math.max(1.5, 0.22 * u); c.stroke();
    } else if (s.voice === 'pad' && s.lo === s.lo) {
      c.globalAlpha *= 0.7;
      const y1 = Y(s.hi);
      c.roundRect(x - 0.7 * u, y1, 1.4 * u, Y(s.lo) - y1, 0.7 * u);
      c.fillStyle = hue; c.fill();
    } else {
      c.arc(x, Y(s.root), rad, 0, 2 * Math.PI);
      c.fillStyle = hue; c.fill();
    }
  }

  if (capU !== u) { capU = u; capFont = `italic ${1.7 * u}px ${col.serif}`; }
  c.globalAlpha = 1;
  c.font = capFont; c.fillStyle = col.muted; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText('what you hear', x0, ly + 1.2 * u);
  c.restore();
}
