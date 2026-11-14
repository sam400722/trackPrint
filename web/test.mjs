import assert from 'node:assert/strict';
import { parseLine } from './serial.js';

assert.deepEqual(parseLine('1,2,3,4'), [1, 2, 3, 4]);
assert.deepEqual(parseLine('100000,0,262143,5\r'), [100000, 0, 262143, 5]);
assert.equal(parseLine('1,2,3'), null);       // too few
assert.equal(parseLine('1,2,,4'), null);      // empty field
assert.equal(parseLine('3,4\n1,2'), null);    // partial / garbage
assert.equal(parseLine(''), null);
console.log('serial ok');
