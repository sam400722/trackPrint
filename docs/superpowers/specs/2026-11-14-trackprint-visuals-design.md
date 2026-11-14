# trackPrint visuals: design direction

Decisions for [Part B: Visuals](../plans/2026-11-14-trackprint-visuals.md). Live mockups: [`2026-11-14-trackprint-visuals-mockups.html`](2026-11-14-trackprint-visuals-mockups.html). Open it in a browser. The chosen direction is mockup **E**.

## Direction: "Organic stage" (hybrid of A and C)

The overall feel comes from C (organic): breathing shapes, deep night gradient, soft glow, serif italics. A (clinical monitor) adds the information people need: a live BPM per player, a pulse trace per player, and a record of the notes being played. Choices beyond this were left to the implementer and are reversible.

## Tokens (B1)

| Token | Value | Use |
|---|---|---|
| `--bg-a` → `--bg-b` | `#0b1430` → `#1d1238` | diagonal background gradient |
| `--text` | `#f4ecff` | title, BPM numbers |
| `--muted` | `rgb(244 236 255 / .55)` | status line, captions, empty states |
| `--drums` | `#ff9e7a` | peach |
| `--bass` | `#7ad1ff` | sky |
| `--lead` | `#ffe07a` | butter |
| `--pad` | `#c79bff` | lavender |
| `--other` | `#9fe6c4` | fallback for any voice name the UI doesn't know |

Pad wash hues rotate by chord root: `#c79bff`, `#ff9ed8`, `#9bb7ff`.

Type: **Fraunces** (roman for BPM numerals, italic for title, voice names and empty states) and **Nunito** 400/600 (controls, status). Self-host only those faces as woff2 in `web/ui/fonts/`, because the demo may run offline.

## Layout (B2), 16:9, everything sized in `vh` so it scales to a projector

- **Header** (~12vh): `trackPrint` in Fraunces italic on the left. On the right: Connect sensors, Simulate, mode (two-option radio group), kit `<select>`, and a status line in muted Nunito. Controls are pill-outlined text buttons with a 2px `--text` focus ring.
- **Stage** (~60vh): four columns, one per voice in `VOICES` order. Each column holds the breathing shape, a large BPM (Fraunces ~10vh), the label `drums · bpm`, and a soft trace under it.
- **Notes lane** (bottom ~23vh): the last 5 s of `note` events, newest at the right, with the `wave` analyser as a faint ribbon behind it and the caption *what you hear*.
- The stage and lane are one full-size `<canvas>` drawn in a single `requestAnimationFrame` loop. The header, banners and controls are DOM.

## Voice panels (B3)

- **Shape**: a blob outlined by two slow sine harmonics. Its radius follows the smoothed |`ac`|, and it swells about 20% on `beat`, decaying over roughly 150 ms. Fill is a radial gradient in the voice colour with a glow that flares on the beat.
- **Trace**: a 200-sample ring buffer, scaled by its own max, drawn with round joins and a gradient stroke that fades out toward the oldest sample.
- **BPM**: rounded, or `--` while it's 0.
- **No finger**: the shape becomes a dashed outline, the BPM `--` dims, the label reads *rest a finger on sensor N*, and there's no trace.

## Music (B4)

| Voice | In the notes lane | On the stage |
|---|---|---|
| drums | ring at the lane floor: kick large, snare medium, hat small, unknown drum medium | ripple rings out from the drums shape, sized by `velocity` |
| bass, lead | dot at height = pitch (`notes[0]`), size = `velocity` | none |
| lead | consecutive notes joined by a soft curve, so the melody draws a line | none |
| pad | rounded capsule spanning the chord's lowest to highest note | full-screen radial colour wash in the chord's hue, fading over ~7 s |
| unknown voice | dot in `--other` | none |

The analyser draws `wave` only. `fft` isn't used: the lane already shows pitch.

## States (B5)

- **Idle**: four dashed shapes and one line in the stage: *Connect the sensors, or press Simulate to hear a demo.*
- **Unsupported browser**: Connect is disabled, with the line *Use Chrome or Edge to connect sensors. Simulate still works.*
- **Disconnected / error**: a soft lavender banner under the header (never red) with a Reconnect button. A cancelled port picker reads *No port chosen. Connect sensors to try again.*
- **Reduced motion**: no ripple rings and no glow flare. The beat swell becomes a brief opacity lift, and the wash fades twice as slowly.
- **Performance view**: a button, plus the `F` key, enters fullscreen and hides the header; the cursor hides after 2 s idle; `Esc` exits.
- **Screen readers**: a visually hidden list (voice, finger on/off, BPM) updated once per second. It isn't `aria-live`, to avoid flooding.
