# trackPrint: biometric-to-music device

## Context
Four MAX30102 heart-rate sensors feed a microcontroller. The data goes to a laptop over USB serial. In the browser, Tone.js turns each sensor's signal into one voice of an electronic band: drums, bass, lead and pad. The sensors may be worn by four people or by one person (either must work). Whether beats trigger notes or raw bits alone drive the music is undecided, so the design keeps that choice swappable.

Decisions made in brainstorming:
- Signal: undecided, so firmware streams RAW samples only. Beat detection and bit mapping live in the browser.
- Link: USB serial (Uno or Leonardo; both work, default Uno).
- Synth: Tone.js in the browser, reading serial directly with the Web Serial API (Chrome/Edge). No Node bridge.
- Voices: ch0 drums, ch1 bass, ch2 lead, ch3 pad.
- Not used: Pi Zero W2 (no Wi-Fi needed).

## Hardware
- 4x MAX30102 -> TCA9548A I2C multiplexer (channels 0-3) -> Uno SDA/SCL. The MAX30102's I2C address is fixed (0x57), so the mux is mandatory.
- Power the mux and sensors from the 3.3V pin and pull SDA/SCL up to 3.3V. I2C is open-drain, so this is safe with the Uno's 5V logic. Check each breakout's onboard pull-ups.
- Uno resets when the serial port opens (1-2 s delay, acceptable). A Leonardo avoids this but needs a wait-for-DTR line in setup.

## Firmware: `firmware/trackprint/trackprint.ino`
- Uses the SparkFun MAX3010x library. For each tick (50 Hz): select mux channel, read the newest IR sample, repeat for 4 channels.
- Prints one CSV line per tick: `ir0,ir1,ir2,ir3\n` at 115200 baud (~2 KB/s, well under the serial limit).
- No processing on the device. A missing sensor prints 0.

## Browser app: `web/` (no build step, Tone.js from a CDN, served with `python3 -m http.server`)
- `serial.js`: Web Serial connect + line parser -> emits `{ch: [4 raw ints]}` per tick. Also exposes a **simulator source** with the same interface (four fake pulses at different BPMs plus noise), so the app can be developed with no hardware.
- `signal.js`: per channel, DC removal and band-pass filter (~0.7-3.5 Hz), finger-present check (raw IR below a threshold means voice muted), and beat detection (rising-edge threshold with refractory period). Emits `beat(ch, bpm)`.
- `mapping.js`: the swappable core. It chops the raw 18-bit value into bit fields (for example 3+3+4+4 bits) and maps each field to a voice parameter: note index in a fixed scale, filter cutoff, velocity, effect send. Two modes behind one interface: `beats` (beats trigger, bits shape) and `bits` (internal clock steps, bits decide). Notes are quantized to one global key and scale so it always sounds musical.
- `voices.js`: Tone.js instruments. Drums use MembraneSynth plus NoiseSynth for kick, snare and hat. Bass uses MonoSynth. Lead uses Synth with vibrato. Pad uses PolySynth with a slow filter. Each has `trigger(params)`.
- `index.html` and `main.js`: Connect and Simulate buttons, mode toggle, and four small live meters (signal, BPM, finger-on).

## Team split
Two teammates build the browser app in parallel after a shared foundation (firmware, `serial.js`, `signal.js`, and a working stub of everything).
- `bus.js`: the contract. A native `EventTarget` with `emit`/`on` and a fixed event table (`frame`, `status`, `connect`, `simulate`, `mode`, `kit`, `kits`, `analyser`, `note`). Audio and UI never import each other.
- `core.js` (shared): sources → `signal.js` → `frame` events; handles `connect`/`simulate`; emits `status`.
- `audio/` (sound teammate): `mapping.js`, `kits.js` (the voices above, as switchable kits), `audio.js` (mode gate, master chain, analysers; emits `note`).
- `ui/` and `index.html` (visuals teammate): controls, states, aesthetic, and visuals driven by `frame`, `note` and `analyser`.
- Plans: `docs/superpowers/plans/2026-11-14-trackprint.md` (overview, contract, branching) plus the foundation, sound and visuals plans.

## Error handling
- Serial disconnect: show status, voices go silent.
- Finger off: that voice mutes and the others continue.
- Bad or partial CSV line: drop it.

## Testing
- `web/test.mjs` (plain Node `assert`, no framework): beat detector finds the expected BPM on a synthetic pulse, and the bit-chunker returns the expected fields for known inputs.
- Hardware check: the Arduino serial monitor shows 4 changing IR values, and each drops to ~0 when its finger is removed.
- End-to-end: the simulator plays all four voices without hardware. Then use real sensors with the serial source.

## Verification
1. Flash the firmware and watch the CSV in the serial monitor (4 live channels).
2. `cd web && python3 -m http.server`, open in Chrome, press Simulate and confirm all four voices play.
3. Press Connect, select the Arduino port, put fingers on and confirm the meters and beats respond.
4. `node web/test.mjs` passes.

## Open items (deferred on purpose)
- Beats vs raw-bit triggering: try both with the mode toggle and keep what sounds better.
- Scale, key and tempo feel: tuned by ear after the first sound.
