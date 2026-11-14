#!/usr/bin/env node
// Replay flatline test logs (Save log in the web app) through the real beat detector and report
// bad reads and BPM quality per sensor, with the bad-read filter on and off.
//   node tools/analyze-log.mjs ~/Downloads/flatline-log-*.csv
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createChannel, FINGER_MIN } from '../web/signal.js';

const VOICES = ['drums', 'bass', 'lead', 'pad'];
const SAT = 262000, RATE = 50;
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');

function load(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const meta = lines.filter((l) => l.startsWith('#')).join('\n');
  const body = lines.filter((l) => l && !l.startsWith('#'));
  const head = body[0].split(',');
  const col = (name) => head.indexOf(name);
  const rows = body.slice(1).map((l) => l.split(',').map(Number));
  return { meta, rows, col };
}

// One replay of one channel. Returns per-sample outputs.
const replay = (raws, filter) => { const ch = createChannel(RATE, { filter }); return raws.map((r) => ch(r)); };

function score(raws, out) {
  const s = { fingerS: 0, presses: 0, shortGaps: 0, beats: 0, inst: [], firstBpmS: [], bpm: [] };
  let on = false, onAt = 0, offAt = -1e9, gotBpm = false;
  out.forEach((o, i) => {
    if (o.finger && !on) { on = true; onAt = i; gotBpm = false; s.presses++; if (i - offAt < RATE / 2) s.shortGaps++; }
    if (!o.finger && on) { on = false; offAt = i; }
    if (!o.finger) return;
    s.fingerS += 1 / RATE;
    if (o.bpm > 0) { s.bpm.push(o.bpm); if (!gotBpm) { gotBpm = true; s.firstBpmS.push((i - onAt) / RATE); } }
    if (o.beat) { s.beats++; if (o.inst > 0) s.inst.push(o.inst); }
  });
  // beat-to-beat quality: jitter between consecutive beats, and beats > 20% off the local median
  const d = s.inst.slice(1).map((x, k) => Math.abs(x - s.inst[k]));
  s.jitter = med(d);
  s.outliers = s.inst.filter((x, k) => { const m = med(s.inst.slice(Math.max(0, k - 2), k + 3)); return Math.abs(x - m) > 0.2 * m; }).length;
  return s;
}

function badReads(raws, out) {
  const t = { dropToZero: 0, dropLow: 0, saturated: 0, spike: 0, repeats: 0 };
  out.forEach((o, i) => {
    if (o.finger && i && raws[i] === raws[i - 1] && raws[i] >= FINGER_MIN) t.repeats++;
    if (!o.held) return;
    const r = raws[i];
    if (r === 0) t.dropToZero++; else if (r < FINGER_MIN) t.dropLow++; else if (r >= SAT) t.saturated++; else t.spike++;
  });
  return t;
}

for (const path of process.argv.slice(2)) {
  const { meta, rows, col } = load(path);
  const secs = rows.length / RATE;
  // logs name their simulated sensors; older logs only carry ?sim= in the page options
  const sim = (meta.match(/# simulated sensors: ([\d,]+)/)?.[1] ?? meta.match(/[?&]sim=([\d,]+)/)?.[1] ?? '').split(',').map((n) => +n - 1);
  const t = rows.map((r) => r[col('t_ms')]), gaps = t.slice(1).map((x, k) => x - t[k]);
  console.log(`\n== ${basename(path)}: ${rows.length} frames, ${f1(secs)} s, ${f1(rows.length / ((t.at(-1) - t[0]) / 1000))} frames/s`);
  console.log(`   ${meta.split('\n').filter((l) => /source|started/.test(l)).map((l) => l.slice(2)).join(' | ')}`);
  console.log(`   arrival gaps: median ${f1(med(gaps))} ms, 99th pct ${f1(pct(gaps, 0.99))} ms, ${gaps.filter((g) => g > 100).length} gaps over 100 ms (USB batching or a stall)`);
  VOICES.forEach((v, i) => {
    const raws = rows.map((r) => r[col(`raw${i + 1}`)]);
    const tag = `${i + 1} ${v}`.padEnd(8);
    if (raws.every((r) => r === 0)) return console.log(`   ${tag} no sensor (all 0)`);
    if (sim.includes(i)) return console.log(`   ${tag} simulated, skipped`);
    const fOn = replay(raws, true), fOff = replay(raws, false);
    const a = score(raws, fOff), b = score(raws, fOn), bad = badReads(raws, fOn);
    if (!a.fingerS && !b.fingerS) return console.log(`   ${tag} never a finger (raw median ${med(raws)})`);
    const nBad = bad.dropToZero + bad.dropLow + bad.saturated + bad.spike;
    console.log(`   ${tag} finger ${f1(b.fingerS)} s, raw median ${med(raws.filter((r) => r >= FINGER_MIN))}`);
    console.log(`            bad reads ${nBad} (${f1((100 * nBad) / Math.max(1, b.fingerS * RATE))}%): drop to 0 ${bad.dropToZero}, drop low ${bad.dropLow}, saturated ${bad.saturated}, spike ${bad.spike} | repeated values ${bad.repeats}`);
    for (const [name, s] of [['no filter', a], ['filter   ', b]]) {
      console.log(`            ${name}: presses ${s.presses} (${s.shortGaps} after a < 0.5 s gap = false lift), beats ${s.beats}, ` +
        `median BPM ${f1(med(s.bpm))}, beat-to-beat jitter ${f1(s.jitter)} BPM, outlier beats ${s.outliers}, first BPM after ${f1(med(s.firstBpmS))} s`);
    }
  });
}
