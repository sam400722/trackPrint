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
{
  // simFill with a route: the connected sensor's value moves there, the rest are simulated
  const out = [];
  let to = 2;
  const fill = simFill((r) => out.push(r), () => to);
  for (let i = 0; i < 50; i++) fill([123456, 0, 0, 0]);
  assert.ok(out.every((r) => r[2] === 123456 && r[1] > 99000 && r[3] > 99000 && r[0] !== 123456));
  to = 3;
  fill([1000, 0, 0, 0]);                 // finger off still routes (reads low, not 0)
  assert.equal(out.at(-1)[3], 1000);
  fill([0, 0, 0, 0]);                    // no sensor at all: the routed voice reads 0
  assert.equal(out.at(-1)[3], 0);
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
assert.deepEqual(mapVoice('drums', ((15 << 6) | 1) << 2), { velocity: 1 }); // patterns pick the drum
assert.deepEqual(mapVoice('pad', 0), { notes: [57, 62, 67], velocity: 0.4, cutoff: 200 });  // A3 D4 G4
assert.deepEqual(mapVoice('bass', 0), { notes: [45], velocity: 0.4, cutoff: 200 });         // A2
assert.deepEqual(mapVoice('bass', 7 << 2).notes, [mapVoice('bass', 2 << 2).notes[0]]);      // degree a % 5
assert.deepEqual(mapVoice('lead', 0).notes, [69, 74, 79, 81]);                              // A4 D5 G5 A5
assert.deepEqual(mapVoice('lead', 6 << 12).notes, mapVoice('lead', 1 << 12).notes);         // root d % 5
{
  // Every note any voice can play is in the scale, whatever the raw bits.
  const { SCALE, ROOT } = await import('./audio/mapping.js');
  const inScale = (m) => SCALE.includes((((m - ROOT) % 12) + 12) % 12);
  for (let raw = 0; raw < 1 << 16; raw += 7) {
    for (const v of ['bass', 'lead', 'pad']) {
      const p = mapVoice(v, raw);
      assert.ok(p.notes.every(inScale), `${v} ${p.notes} off-scale for raw ${raw}`);
      assert.ok(p.velocity >= 0.4 && p.velocity <= 1 && p.cutoff >= 200 && p.cutoff <= 2450);
    }
    assert.ok(Math.max(...mapVoice('lead', raw).notes) <= 93); // arp tops out at A6
  }
}
console.log('mapping ok');

import { songBpm, band, createTempo, TEMPO_DEFAULT } from './audio/tempo.js';
import { createHeart, HR_DEFAULT } from './audio/heart.js';
import { leadLevel, LEAD_STEPS, DRUM_PATTERNS, BASS_PATTERNS, isOff8th } from './audio/patterns.js';

{
  // songBpm: 50 -> 100, 110 -> 180, clamped outside
  assert.equal(songBpm(50), 100);
  assert.equal(songBpm(110), 180);
  assert.equal(songBpm(80), 140);
  assert.equal(songBpm(30), 100);
  assert.equal(songBpm(150), 180);

  // band edges and hysteresis
  assert.equal(band(124), 'slow');
  assert.equal(band(125), 'mid');
  assert.equal(band(155), 'mid');
  assert.equal(band(156), 'fast');
  let b = 'slow';
  for (const bpm of [124, 126, 124, 126, 127]) assert.equal((b = band(bpm, b)), 'slow'); // no flapping at 125 +- 1
  assert.equal((b = band(128, b)), 'mid');
  for (const bpm of [124, 126, 123, 122.5]) assert.equal((b = band(bpm, b)), 'mid');
  assert.equal(band(121, b), 'slow');
  assert.equal(band(158, 'mid'), 'mid');
  assert.equal(band(159, 'mid'), 'fast');
  assert.equal(band(153, 'fast'), 'fast');
  assert.equal(band(152, 'fast'), 'mid');

  // tempo follower
  const tempo = createTempo();
  const h = (on, settled, hr) => ({ on, settled, hr, press: 0.5, breath: 0 });
  assert.equal(tempo(h(false, false, 75)), TEMPO_DEFAULT);
  assert.equal(tempo(h(true, false, 72)), TEMPO_DEFAULT);          // holds 90 until settled
  assert.equal(tempo(h(true, true, 72)), songBpm(72));             // lock
  assert.equal(tempo(h(true, true, 72.5)), songBpm(72));           // +0.67 BPM jitter ignored
  assert.equal(tempo(h(true, true, 73)), songBpm(72));             // +1.33 still ignored
  assert.equal(tempo(h(true, true, 74)), songBpm(74));             // +2.67 follows
  assert.equal(tempo(h(false, false, 75)), TEMPO_DEFAULT);         // release
  assert.equal(tempo(h(true, true, 90)), songBpm(90));             // re-lock after landing again

  // heart: breath follows a +-6 BPM breathing sine on a 70 BPM heart; press tracks amp
  const heart = createHeart(50);
  let t = 0, nextBeat = 0, s, prevBeat = 0, amp = 300, pressBefore, pressAfter;
  const swing = [];
  for (let i = 0; i < 50 * 60; i++, t += 0.02) {
    if (i === 50 * 50) amp = 450;                                  // press harder for the last 10 s
    const rateNow = 70 + 6 * Math.sin((2 * Math.PI * t) / 4);
    const beat = t >= nextBeat;
    let inst = 0;
    if (beat) { inst = prevBeat ? 60 / (t - prevBeat) : 0; prevBeat = t; nextBeat = t + 60 / rateNow; }
    s = heart({ finger: true, beat, bpm: i > 100 ? 70 : 0, amp, inst });
    if (beat && i > 50 * 20 && i < 50 * 50) swing.push([rateNow, s.breath]);
    if (i === 50 * 50 - 1) pressBefore = s.press;
    if (i === 50 * 51) pressAfter = s.press;          // 1 s after pressing harder
    if (i === 50) assert.ok(!s.settled && s.hr === HR_DEFAULT && s.breath === 0);
  }
  assert.ok(s.settled && s.hr === 70);
  const hi = Math.max(...swing.map(([, br]) => br)), lo = Math.min(...swing.map(([, br]) => br));
  assert.ok(hi > 0.4 && hi < 0.8 && lo < -0.4 && lo > -0.8, `breath range ${lo}..${hi}`);
  const corr = swing.reduce((a, [r, br]) => a + (r - 70) * br, 0);
  assert.ok(corr > 0, 'breath has the same sign as the rate swing');
  assert.ok(Math.abs(pressBefore - 0.5) < 0.05, `steady press ${pressBefore}`);
  assert.ok(pressAfter > 0.9, `press after pressing harder: ${pressAfter}`);
  assert.ok(s.press < pressAfter, 'press re-centres as the slow average adapts');
  assert.equal(heart({ finger: false }).on, false);
  assert.equal(heart({ finger: true, beat: false, bpm: 70, amp: 300, inst: 70 }).settled, false); // lift resets

  // lead arp step lookup and hysteresis
  assert.deepEqual([60, 64.9, 65, 74.9, 75, 85, 95, 120].map((hr) => LEAD_STEPS[leadLevel(hr)]),
    [16, 16, 8, 8, 4, 2, 1, 1]);
  assert.equal(leadLevel(66, 0), 0);  // needs 67 to leave 'whole'
  assert.equal(leadLevel(67, 0), 1);
  assert.equal(leadLevel(63.5, 1), 1); // needs < 63 to drop back
  assert.equal(leadLevel(62.9, 1), 0);
  assert.equal(leadLevel(100, 0), 4); // big jumps still land in one go

  // patterns are 16 steps; hats on the off-8ths are the half-velocity ones
  for (const p of [...Object.values(DRUM_PATTERNS).flatMap(Object.values), ...Object.values(BASS_PATTERNS)]) {
    assert.equal(p.length, 16);
  }
  assert.deepEqual([...Array(16).keys()].filter(isOff8th), [2, 6, 10, 14]);
}
console.log('heart ok');

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
