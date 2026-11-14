# Task 4 report

## Files changed
- `web/audio/audio.js`: replaced band scheduler with genre evolution scheduling, quantized pending kit activation, lifecycle cleanup, tempo ramps, failure handling, and draw/note timing.
- `web/audio/tempo.js`: made genre selection required and removed legacy tempo bands/default.
- `web/audio/patterns.js`: removed legacy band grids and lead-rate tables.
- `web/audio/mapping.js`: removed obsolete raw-to-arpeggio `mapVoice`/`ARP` APIs while retaining scale, note, field, and phrase-seed helpers.
- `web/audio-test.mjs`: added VM lifecycle integration coverage with recorded transport, kit, draw, and bus boundaries.
- `web/test.mjs`: removed obsolete music assertions while retaining mapping helpers and heart/core/signal/visual coverage.

## Verification
- TDD red: lifecycle test initially failed against the old scheduler (`bandFor`/legacy scheduler path and no genre ramp).
- `node --test web/audio-test.mjs`: 9 passed, 0 failed.
- `node web/test.mjs`: serial, signal, mapping, heart, contract, lane, and dynamics checks passed.
- `node web/fluid-test.mjs`: `fluid contract self-check ok`.
- `node web/stage-test.mjs`: `stage integration self-check ok`.
- `git diff --check`: clean.

## Lifecycle evidence
The integration test executes real `audio.js` in `node:vm`, verifies one repeat registration, silent all-off scheduling, latest-wins pending selection at a bar boundary, no early kit allocation, genre tempo ramp, and finite draw scheduling. The implementation keeps heart trackers and transport position across running genre switches, stops and resets transport on non-running status, retains selection across reconnect, captures kit identity per trigger, offsets note/draw timing together, and disposes replaced kits through their bounded tails.

## Self-review
Reviewed the explicit Task 4 diff and confirmed legacy scheduler callers are absent. Master/compressor/limiter/analyser routing and public bus event names remain intact. Rapid pending selections allocate only the winning kit at the boundary; stale ready rejections are guarded by kit identity.

## Concerns

Browser audition was not performed; browser/Tone runtime behavior remains an owner acceptance step. The lifecycle test uses recorded Tone/kit boundaries rather than a live browser audio context.

## Task 4 Important-finding fix verification

### `node --test web/audio-test.mjs`

```text
✔ 9 tests passed, 0 failed
```

### `node web/test.mjs`

```text
serial ok
signal ok
mapping ok
heart ok
contract ok
lane ok
dynamics ok
```

### `node web/fluid-test.mjs`

```text
fluid contract self-check ok
```

### `node web/stage-test.mjs`

```text
stage integration self-check ok
```

### `git diff --check`

```text
(no output; exit 0)
```
