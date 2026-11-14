import assert from 'node:assert/strict';
import { parseLine } from './serial.js';

assert.deepEqual(parseLine('1,2,3,4'), [1, 2, 3, 4]);
assert.deepEqual(parseLine('100000,0,262143,5\r'), [100000, 0, 262143, 5]);
assert.equal(parseLine('1,2,3'), null);       // too few
assert.equal(parseLine('1,2,,4'), null);      // empty field
assert.equal(parseLine('3,4\n1,2'), null);    // partial / garbage
assert.equal(parseLine(''), null);
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
assert.deepEqual(mapVoice('drums', ((15 << 6) | 1) << 2), { drum: 'snare', velocity: 1 });
assert.deepEqual(mapVoice('pad', 0), { notes: [57, 62, 67], velocity: 0.4, cutoff: 200 });
assert.deepEqual(mapVoice('bass', 0), { notes: [45], velocity: 0.4, cutoff: 200 });
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
  assert.deepEqual(Object.keys(got.ch[0]).sort(), ['ac', 'beat', 'bpm', 'finger']);
  assert.deepEqual(status, ['idle', 'running']);
}
console.log('contract ok');
