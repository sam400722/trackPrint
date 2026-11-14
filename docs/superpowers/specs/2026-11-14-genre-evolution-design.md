# Four genres and signal-driven musical evolution

Status: accepted for planning on 2026-11-14; the owner requested a self-contained
implementation plan for another LLM using subagent-driven development on a new
branch. Implementation and listening validation have not started.

## Intent

The current pulse, lofi, and ambient kits change instruments and effects while
sharing rhythms, pitch mapping, and ascending lead phrases. Switching them feels
too similar. Replace them with four recognizable musical identities: Daft Punk
inspired French house, UK garage, ambient, and Russian hardbass.

The owner chose a hybrid of continuous sound changes and phrase-level variation.
The experience should feel like body signals becoming an evolving piece of music.
Kit selection is the only creative control; the player does not need to learn
gestures, deliberately change their heart rate, or operate additional controls.
Existing connection, simulation, and single-sensor routing controls remain.

## Approaches

1. Direct sensor control: immediate changes to sound and activity. Responsive,
   but can feel twitchy and asks the player to operate the sensors as controls.
2. Phrase-level evolution only: readings choose musical variations at boundaries.
   Coherent and varied, but lacks an immediate connection to the sound.
3. Hybrid, selected by the owner: smooth continuous timbre and dynamics, plus
   sensor-influenced phrase choices within the selected genre. This supplies an
   evolving composition without making the player manage it.

Instrument-only presets cannot meet the request: genres also need different
rhythms, articulation, voicings, and phrase shapes.

## Goals and limits

- Four kits sound recognizably different with the same sensor recording.
- Each active sensor contributes variation to its own voice over time.
- Repeated motifs provide continuity; variations sound intentional and stay in
  the selected genre. Avoid unrelated notes chosen afresh on every step.
- Preserve finger presence gating, sensor calibration, simulation, signal
  processing, audio unlock, and existing audiovisual events.
- Reuse Tone.js and existing voice builders; no new dependencies or sample
  downloads. Instrumental genre inspiration, without recorded vocals or songs.
- No new sliders, variation modes, per-voice genre selection, or recording tools.

## Genre palettes

These are proposed implementation choices, rather than additional owner requests.

| Kit | Rhythm and phrasing | Instrument character | Tempo range / default |
| --- | --- | --- | --- |
| French house | Four-on-the-floor kick, offbeat hats, repeating syncopated bass, short chord stabs and hooks | Rounded synth bass, filtered chords, bright restrained lead, rhythmic volume pumping | 112–128 / 120 BPM |
| UK garage | Swung two-step rhythm, shuffled hats, displaced kicks, syncopated bass and short answering phrases | Sub-weighted bass, clipped chord stabs, short bell-like lead, tight drums | 128–138 / 132 BPM |
| Ambient | Sparse percussion, long bass swells, sustained chords, widely spaced melodic fragments | Soft attacks, airy textures, long but bounded echoes and reverb | 60–90 / 72 BPM |
| Hardbass | Driving four-on-the-floor kick, offbeat donk bass, repeated short riffs, occasional phrase-ending fills | Sharp resonant donk bass, forceful drums, bright concise lead and short chords | 145–165 / 150 BPM |

House pumping follows the musical grid, including when the drum sensor is absent;
it does not require a new audio routing or sidechain subsystem. UK garage swing
delays selected subdivisions locally; it must not shift the other kits' clock.
Genre identity must also survive listening to individual voices.

## Sensor contribution

Keep the current channel roles: drums, bass, lead, and pad/chords. Use the existing
heart features and raw samples. All fingers may report similar heart rates;
independent voice evolution must also use each channel's amplitude history and
sample-derived phrase seed, not require independent heart rates.

| Sensor / voice | Continuous, smoothed influence | Phrase-level influence |
| --- | --- | --- |
| Drums | Accent strength and percussion brightness | Hat density, alternate kick placement, restrained fills |
| Bass | Filter or FM character, modest saturation and dynamics | Genre-specific bass motif, note length, occasional octave movement |
| Lead | Brightness, articulation, modest echo emphasis | Motif contour, register, rests, call-and-response variants |
| Pad/chords | Filter movement and texture / effect balance | Compatible chord voicing, inversion, and sustained versus stabbed phrasing |

`press` currently means pulse amplitude relative to the finger's recent average,
not calibrated finger pressure. `breath` is an estimate from beat-interval changes,
not a measured breathing rate. Treat both as bounded musical modulation sources,
with neutral defaults while unsettled; do not promise intentional pressure or
breathing control. Keep outlier rejection and the four-beat settling period.

Drum heart rate still influences the single shared tempo, smoothly mapped into
the selected genre's range. With that finger absent or unsettled, use the genre
default. Genre-specific ranges deliberately replace the existing universal
100–180 BPM mapping so ambient stays spacious and hardbass stays energetic.

## Evolution rules

- Retain a 16th-note scheduling grid and a shared harmonic root / compatible
  pitch collection. Start from the existing A-root pentatonic material, with
  genre-specific voicings and motifs; expanded harmony is not required.
- Snapshot each voice's signal features and sample-derived seed at musical
  boundaries. A small deterministic choice function combines them with phrase
  position; the same input sequence produces the same musical decisions.
- Use four-bar phrases for house, garage, and hardbass, and eight-bar phrases
  for ambient. Repeat a motif within a phrase, with small alternate bars; permit
  restrained fills only at phrase endings. Avoid mandatory constant escalation.
- Allow at most one major phrase-choice change per active voice per phrase.
  Stable inputs can still evolve as phrase position advances. Signals bias the
  choices; a free-running randomizer must not replace sensor influence.
- Bound every voice's note range, density, velocity, modulation, and effect
  feedback. Faster hearts must not turn ambient into a dense arpeggio.
- Smooth continuous modulation so amplitude noise does not cause audible jumps.
  Pitch and rhythm choices change at boundaries, not on every noisy sample.
- Share harmonic context across voices. Independent choices must not produce
  incompatible keys or unrelated chord changes.

## Lifecycle and compatibility

- No active fingers means no new notes. Lifting a finger stops new events for
  that voice and releases the pad as today; bounded existing note/effect tails
  can finish. Other active voices continue without a restart.
- A returning finger joins the current grid using neutral features until settled;
  its next full phrase choice happens at the next phrase boundary.
- Kit selection takes effect at the next bar while running, immediately while
  idle. Preserve heart trackers and transport position; reset genre phrase state
  and glide to the new tempo mapping. The latest selection wins if changed again
  before the boundary. Release and dispose the old kit after its bounded tail.
- Stop, disconnect, and error clear pending kit switches and evolution state;
  retain the selected kit for the next session. No duplicate callbacks or nodes
  should accumulate on repeated switching.
- Continue emitting actual audible notes through the existing `note` event and
  analyser outputs. Swing offsets must be reflected in note-event timing.
- Replace the dropdown contents with the four genre names, French house first.
  Use existing UI population via `kits`; no bus, firmware, Pi, or serial changes.

## Implementation scope

Expected changes reach `web/audio/kits.js` (voice presets / modulation),
`patterns.js` (genre rhythms and phrases), `mapping.js` (compatible motif and
voicing choices), `tempo.js` (genre tempo bounds), and `audio.js` (scheduling,
evolution state, and kit lifecycle). Add one small pure evolution module only
if it makes the state testable without importing Tone.js. Reuse existing helpers.
Update `web/test.mjs` and the README's kit / sensor explanation. Touch UI code
only if its existing dropdown population needs it; preserve public bus contracts.
The implementation plan will enumerate callers and affected existing assertions.

## Verification and acceptance

- Pure checks: all genre patterns have valid lengths; swings preserve event
  ordering; choices are reproducible, bounded, and harmonically compatible;
  repeated phrases vary without losing their motif; each sensor can affect its
  own voice; unsettled / off inputs remain finite and neutral.
- Check genre tempo endpoints, defaults, smoothing, and switching behavior.
  Update existing mapping / pattern tests for intentional behavior changes and
  retain signal, serial, core, and visual contract coverage.
- Browser checks: use the same simulated session for all four genres. Audition
  each voice alone and all four together, listen across at least three phrases,
  check audible swing, lack of clicks / runaway echoes / severe level jumps,
  finger lift / return, and repeated rapid kit switches. Confirm no console errors.
- Run existing core, fluid, and stage self-checks. Real sensor listening remains
  an owner acceptance step if hardware is unavailable; simulation cannot establish
  that physiological variation is sufficiently expressive on real fingers.

## Left to the builder

Choose exact note grids, motif tables, synth parameters, smoothing constants,
bounded modulation depths, and minimal pure state representation through listening
and the checks above. Keep the four genre identities, sensor ownership, phrase
timing, lifecycle rules, and single creative control fixed.
