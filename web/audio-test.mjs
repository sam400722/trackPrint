import assert from 'node:assert/strict';
import test from 'node:test';
import { HEART_OFF } from './audio/heart.js';
import { GENRES } from './audio/patterns.js';
import { createTempo, songBpm } from './audio/tempo.js';
import { phraseSeed, SCALE, ROOT } from './audio/mapping.js';
import { createEvolution } from './audio/evolution.js';

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

const settled = (press = 0.5, breath = 0) => ({ on: true, settled: true, hr: 75, press, breath });
const clone = (value) => structuredClone(value);
const runBars = (name, { bars, raws, hearts }) => {
  const engine = createEvolution(name);
  const out = Array.from({ length: bars }, () => []);
  const steps = bars * 16;
  for (let step = 0; step < steps; step++) {
    const events = engine.next({ raws, hearts: hearts.map(clone), step, stepSeconds: 0.125 });
    out[Math.floor(step / 16)].push(events);
  }
  return out;
};

test('phrase seed is deterministic and includes settled pressure and breath', () => {
  const heart = settled(0.5, 0);
  assert.equal(phraseSeed(0x12345678, heart), phraseSeed(0x12345678, clone(heart)));
  assert.equal(phraseSeed(0x12345678, HEART_OFF), 0);
  assert.notEqual(phraseSeed(0x12345678, settled(0.9, 0)), phraseSeed(0x12345678, heart));
  assert.notEqual(phraseSeed(0x12345678, settled(0.5, 0.8)), phraseSeed(0x12345678, heart));
});

test('phrase evolution is reproducible, neutral while unsettled, and bounded', () => {
  const input = {
    bars: 24,
    raws: [0x1234, 0x5678, 0x9abc, 0xdef0],
    hearts: [settled(0.6, 0.1), settled(0.4, -0.2), settled(0.8, 0), settled(0.5, 0.3)],
  };
  assert.deepEqual(runBars('UK garage', input), runBars('UK garage', input));
  assert.deepEqual(
    createEvolution('Ambient').next({
      raws: [0, 0, 0, 0], hearts: Array(4).fill(HEART_OFF), step: 0, stepSeconds: 0.125,
    }),
    [],
  );
  for (const name of Object.keys(GENRES)) {
    const bars = runBars(name, input);
    const phraseBars = GENRES[name].phraseBars;
    assert.ok(bars.slice(phraseBars, phraseBars * 2).flat(2).length > 0);
    const first = JSON.stringify(bars.slice(0, phraseBars));
    const second = JSON.stringify(bars.slice(phraseBars, phraseBars * 2));
    assert.notEqual(first, second, `${name} should evolve between phrases`);
    for (const events of bars.flat()) {
      for (const event of events) {
        assert.ok(event.offset >= 0 && event.offset < 0.125);
        assert.ok(Number.isFinite(event.offset));
        assert.ok(event.params.velocity >= 0 && event.params.velocity <= 1);
        if (event.voice !== 'drums') {
          assert.ok(event.params.duration > 0 && Number.isFinite(event.params.duration));
          for (const midi of event.params.notes) {
            assert.ok(SCALE.includes((((midi - ROOT) % 12) + 12) % 12));
            if (event.voice === 'bass') assert.ok(midi >= 33 && midi <= 64);
            if (event.voice === 'lead') assert.ok(midi >= 57 && midi <= 93);
            if (event.voice === 'pad') assert.ok(midi >= 45 && midi <= 88);
          }
        }
      }
    }
  }
});
