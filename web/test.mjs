import assert from 'node:assert/strict';
import { parseLine, simFill } from './serial.js';

assert.deepEqual(parseLine('1,2,3,4'), [1, 2, 3, 4]);
assert.deepEqual(parseLine('100000,0,262143,5\r'), [100000, 0, 262143, 5]);
assert.equal(parseLine('1,2,3'), null);       // too few
assert.equal(parseLine('1,2,,4'), null);      // empty field
assert.equal(parseLine('3,4\n1,2'), null);    // partial / garbage
assert.equal(parseLine(''), null);
{
  // simFill: zeros (missing sensors) become simulated pulses, real values pass through
  const out = [];
  const fill = simFill((r) => out.push(r));
  for (let i = 0; i < 50; i++) fill([123456, 0, 0, 7]);
  assert.ok(out.every((r) => r[0] === 123456 && r[3] === 7));
  assert.ok(out.every((r) => r[1] > 99000 && r[1] < 101000 && r[2] > 99000));
  assert.ok(new Set(out.map((r) => r[1])).size > 10); // it actually pulses
}
console.log('serial ok');

import { createChannel } from './signal.js';

{
  // 72 BPM synthetic pulse with deterministic noise, 20 s at 50 Hz
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 100;
  const ch = createChannel(50);
  let beats = 0, s;
  for (let i = 0; i < 50 * 20; i++) {
    s = ch(Math.round(100000 - 400 * Math.sin((2 * Math.PI * 1.2 * i) / 50) + noise()));
    if (i >= 50 * 10 && s.beat) beats++;
  }
  assert.ok(s.finger);
  assert.ok(Math.abs(s.bpm - 72) < 3, `bpm ${s.bpm}`);
  assert.ok(Math.abs(s.inst - 72) < 8, `inst ${s.inst}`); // unsmoothed, so looser
  assert.ok(s.amp > 100 && s.amp < 600, `amp ${s.amp}`);  // pulse is +-400
  assert.ok(beats >= 11 && beats <= 13, `beats in last 10 s: ${beats}`); // expect 12
}
{
  // no finger: never beats, bpm stays 0
  const ch = createChannel(50);
  for (let i = 0; i < 200; i++) {
    const s = ch(1000);
    assert.ok(!s.finger && !s.beat && s.bpm === 0);
  }
}
console.log('signal ok');

import { fields, note, mapVoice } from './audio/mapping.js';

assert.deepEqual(fields((10 << 10) | (6 << 6) | (5 << 3) | 3, [3, 3, 4, 4]), [3, 5, 6, 10]);
assert.equal(note(0, 0), 45);   // A2
assert.equal(note(5, 0), 57);   // wraps to next octave: A3
assert.equal(note(7, 1), 74);   // index 7 = octave+1, degree 2 (D)
// raw = fields a=1, b=0, c=15, d=0, shifted past the 2 skipped low bits
assert.deepEqual(mapVoice('drums', ((15 << 6) | 1) << 2), { drum: 'hat', velocity: 1 });
assert.deepEqual(mapVoice('drums', 2 << 2).drum, 'snare');
assert.deepEqual([...Array(8).keys()].map((a) => mapVoice('drums', a << 2).drum),
  ['kick', 'hat', 'snare', 'hat', 'kick', 'clap', 'openhat', 'tom']);
assert.deepEqual(mapVoice('pad', 0), { notes: [57, 62, 67, 72], velocity: 0.4, cutoff: 200 }); // A3 D4 G4 C5
assert.deepEqual(mapVoice('bass', 0), { notes: [33], velocity: 0.4, cutoff: 200 });  // A1
assert.deepEqual(mapVoice('bass', 7 << 2).notes, [50]);                               // top: D3
{
  // Every note any voice can play is in the scale, whatever the raw bits.
  const { SCALE, ROOT, tempoFrom } = await import('./audio/mapping.js');
  const inScale = (m) => SCALE.includes((((m - ROOT) % 12) + 12) % 12);
  for (let raw = 0; raw < 1 << 16; raw += 7) {
    for (const v of ['bass', 'lead', 'pad']) {
      const p = mapVoice(v, raw);
      assert.ok(p.notes.every(inScale), `${v} ${p.notes} off-scale for raw ${raw}`);
      assert.ok(p.velocity >= 0.4 && p.velocity <= 1 && p.cutoff >= 200 && p.cutoff <= 2450);
    }
  }
  const ch = (finger, bpm) => ({ finger, bpm, ac: 0, beat: false });
  assert.equal(tempoFrom([ch(true, 70), ch(true, 80), ch(false, 0), ch(true, 0)]), 75); // ignores off and unread
  assert.equal(tempoFrom([ch(false, 0), ch(false, 0)]), null);
  assert.equal(tempoFrom([ch(true, 40)]), 60);
  assert.equal(tempoFrom([ch(true, 190)]), 140);
}
console.log('mapping ok');

import { on } from './bus.js';
import { start } from './core.js';

{
  let got = null;
  const status = [];
  on('frame', (d) => (got = d));
  on('status', (s) => status.push(s)); // sticky: replays 'idle' right away
  await start((onFrame) => { onFrame([100000, 0, 0, 0]); return async () => {}; });
  assert.deepEqual(got.raws, [100000, 0, 0, 0]);
  assert.equal(got.ch.length, 4);
  assert.ok(got.ch[0].finger && !got.ch[1].finger);
  assert.deepEqual(Object.keys(got.ch[0]).sort(), ['ac', 'amp', 'beat', 'bpm', 'finger', 'inst']);
  assert.deepEqual(status, ['idle', 'running']);
}
{
  // overlapping starts are serialized; resolvers are held by hand
  const log = [];
  on('status', (s) => log.push(s));
  on('frame', () => log.push('frame'));
  const defer = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
  const tick = () => new Promise((r) => setImmediate(r)); // let queued jobs run to their next await
  const noop = async () => {};

  // (a) B waits for A's source and A's stop; A's frames/onClose are silent
  log.length = 0;
  const aSrc = defer(), aStopped = defer();
  let aFrame, aClose, aStops = 0, bCalled = false;
  const pa = start((f, c) => { aFrame = f; aClose = c; return aSrc.p; });
  await tick();                    // A is now inside its source
  const pb = start(async () => { bCalled = true; return noop; });
  await tick();
  assert.ok(!bCalled);
  aSrc.resolve(() => { aStops++; return aStopped.p; });
  await tick();
  assert.equal(aStops, 1);
  assert.ok(!bCalled);             // A's stop still in flight
  aStopped.resolve();
  await Promise.all([pa, pb]);
  assert.ok(bCalled);
  aFrame([1, 2, 3, 4]);
  aClose();
  assert.deepEqual(log, ['running']);

  // (b) B and C arrive while a stop is pending: one stop call, B never opens, C waits
  const hold = defer();
  let stops = 0, bOpened = false, cOpened = false;
  await start(async () => () => { stops++; return hold.p; });
  const pb2 = start(async () => { bOpened = true; return noop; });
  const pc2 = start(async () => { cOpened = true; return noop; });
  await tick();
  assert.equal(stops, 1);
  assert.ok(!cOpened);
  hold.resolve();
  await Promise.all([pb2, pc2]);
  assert.equal(stops, 1);
  assert.ok(!bOpened && cOpened);

  // (c) superseded failures stay quiet: source rejects / previous stop rejects
  log.length = 0;
  const dSrc = defer();
  const pd = start(() => dSrc.p);
  await tick();                    // D is inside its source
  const pe = start(async () => noop);
  dSrc.reject(new Error('late source'));
  await Promise.all([pd, pe]);
  const fStop = defer();
  await start(async () => () => fStop.p);
  const pf = start(async () => noop);
  await tick();                    // F is awaiting the held stop
  const pg = start(async () => noop);
  fStop.reject(new Error('late stop'));
  await Promise.all([pf, pg]);
  assert.deepEqual(log.filter((x) => x.startsWith('error')), []);
}
console.log('contract ok');

import { ring, pitch01 } from './ui/lane.js';

{
  assert.equal(pitch01(0), 0);                 // clamped low
  assert.equal(pitch01(200), 1);               // clamped high
  assert.ok(pitch01(60) > 0 && pitch01(60) < pitch01(72) && pitch01(72) < 1);
  const r = ring(4);
  for (let i = 1; i <= 6; i++) r.add(i * 1000).v = i; // 6 into 4 slots: oldest two overwritten
  assert.equal(r.live(6000, 1e9), 4);
  assert.deepEqual([0, 1, 2, 3].map((k) => r.at(k).v), [6, 5, 4, 3]); // newest first
  assert.equal(r.live(7000, 2500), 2);         // 6000 and 5000 are within 2.5 s
  assert.equal(r.live(7000, 1e9), 2);          // pruned for good
  r.add(8000);
  assert.equal(r.live(8000, 1e9), 3);
}
console.log('lane ok');
