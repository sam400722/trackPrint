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
