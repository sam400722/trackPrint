import assert from 'node:assert/strict';
import test from 'node:test';
import { HEART_OFF } from './audio/heart.js';
import { GENRES } from './audio/patterns.js';
import { createTempo, songBpm } from './audio/tempo.js';

const names = ['French house', 'UK garage', 'Ambient', 'Russian hardbass'];

test('genre names, tempo ranges, defaults, phrase lengths, and swing', () => {
  assert.deepEqual(Object.keys(GENRES), names);
  for (const [name, lo, hi, def, bars] of [
    ['French house', 112, 128, 120, 4],
    ['UK garage', 128, 138, 132, 4],
    ['Ambient', 60, 90, 72, 8],
    ['Russian hardbass', 145, 165, 150, 4],
  ]) {
    assert.equal(songBpm(30, name), lo);
    assert.equal(songBpm(80, name), (lo + hi) / 2);
    assert.equal(songBpm(150, name), hi);
    assert.equal(createTempo(name)(HEART_OFF), def);
    assert.equal(GENRES[name].phraseBars, bars);
  }
  assert.equal(GENRES['UK garage'].swing, 0.30);
});

test('genre grids are valid and variants change musical content', () => {
  for (const [name, genre] of Object.entries(GENRES)) {
    for (const voice of ['drums', 'bass', 'lead', 'pad']) {
      const variants = genre.patterns[voice];
      assert.ok(variants.length >= 3, `${name} ${voice} variants`);
      for (const grid of variants) {
        const cells = voice === 'drums' ? Object.values(grid).flat() : grid;
        if (voice === 'drums') {
          for (const drumGrid of Object.values(grid)) {
            assert.equal(drumGrid.length, 16, `${name} ${voice} grid length`);
            assert.ok(drumGrid.every((cell) => typeof cell === 'boolean'));
          }
        } else {
          assert.equal(grid.length, 16, `${name} ${voice} grid length`);
        }
        for (const cell of cells) {
          if (voice !== 'drums') {
            if (cell !== null) {
            const degrees = voice === 'pad' ? cell.degrees : [cell.degree];
            assert.ok(degrees.every(Number.isInteger));
            assert.ok(Number.isInteger(cell.octave));
            assert.ok(Number.isFinite(cell.gate) && cell.gate > 0);
            assert.ok(Number.isFinite(cell.velocity) && cell.velocity >= 0 && cell.velocity <= 1);
            }
          }
        }
      }
      assert.ok(new Set(variants.map((grid) => JSON.stringify(grid))).size > 1, `${name} ${voice} differs`);
    }
  }
});

test('genre identity and ambient density constraints', () => {
  const house = GENRES['French house'].patterns.drums[0];
  assert.deepEqual(house.kick, [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false]);
  assert.deepEqual(GENRES['Russian hardbass'].patterns.bass[0].map((v) => !!v), [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false]);
  assert.notDeepEqual(GENRES['UK garage'].patterns.drums[0].kick, house.kick);
  for (const grid of GENRES.Ambient.patterns.lead) {
    assert.ok(grid.filter(Boolean).length <= 2);
  }
  for (const grid of GENRES.Ambient.patterns.pad) {
    assert.ok(grid.filter(Boolean).length <= 1);
  }
  for (const grid of GENRES.Ambient.patterns.drums) {
    assert.ok(Object.values(grid).reduce((n, v) => n + v.filter(Boolean).length, 0) <= 4);
  }
  for (const grid of GENRES.Ambient.patterns.bass) {
    assert.ok(grid.filter(Boolean).length <= 2);
  }
});

test('genre tempo follower locks, ignores jitter, follows movement, and releases', () => {
  const tempo = createTempo('Ambient');
  const heart = (on, settled, hr) => ({ on, settled, hr });
  assert.equal(tempo(HEART_OFF), 72);
  assert.equal(tempo(heart(true, false, 72)), 72);
  assert.equal(tempo(heart(true, true, 72)), songBpm(72, 'Ambient'));
  assert.equal(tempo(heart(true, true, 72.5)), songBpm(72, 'Ambient'));
  assert.equal(tempo(heart(true, true, 73)), songBpm(72, 'Ambient'));
  assert.equal(tempo(heart(true, true, 78)), songBpm(78, 'Ambient'));
  assert.equal(tempo(HEART_OFF), 72);
});
