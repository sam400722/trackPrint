# flatline visuals: design direction

Decisions for [Part B: Visuals](../plans/2026-11-14-trackprint-visuals.md). The current mockup is [`2026-11-14-trackprint-ferrofluid-mockups.html`](2026-11-14-trackprint-ferrofluid-mockups.html), ported by [the flatline overhaul plan](../plans/2026-11-14-flatline-ferrofluid-overhaul.md). It supersedes the earlier "organic stage" direction (mockup **E** in [`2026-11-14-trackprint-visuals-mockups.html`](2026-11-14-trackprint-visuals-mockups.html)). The site is named **flatline**; files, repo and Pi service keep `trackprint`.

## Direction: black chrome ferrofluid in backlit windows

Each player is a glossy near-black ferrofluid ball in front of a round window glowing in that player's colour. A live BPM, a pulse trace and a record of the notes being played carry the information.

## Tokens (B1)

| Token | Value | Use |
|---|---|---|
| `--bg` → `--bg2` | `#070708`, `#17181c` | near-black ground with a faint radial lift |
| `--text` | `#f3f2ee` | title, BPM numbers |
| `--muted` | `rgb(243 242 238 / .56)` | status line, captions, empty states |
| `--line` | `rgb(243 242 238 / .16)` | control outlines, lane hairline, dim `--` |
| `--drums` | `#ff3b1f` | red |
| `--bass` | `#1f6bff` | blue |
| `--lead` | `#ffd400` | yellow |
| `--pad` | `#ff2d87` | pink |
| `--other` | `#9fe6c4` | fallback for any voice name the UI doesn't know |

Type: **Fraunces** (roman for BPM numerals, italic for title, labels and empty states) and **Nunito** (controls, status). Self-hosted as woff2 in `web/ui/fonts/`, because the demo may run offline.

## Layout (B2), 16:9, everything sized from `u` = 1vh so it scales to a projector

- **Header** (10vh) overlays a full-height stage: `flatline` in Fraunces italic on the left; Connect sensors (filled), Simulate, Performance view, kit `<select>` and a status dot + line on the right.
- **Assigning**: four balls in four columns, each above a large BPM, a label (`drums · bpm`) and a pulse trace.
- **Merged**: when all four players have a finger down and a BPM, the four slide into a bottom row (ball, BPM and label side by side) and one large ball forms in the centre. A finger up for 2 s splits it back.
- **Notes lane** in the bottom 16vh, in both states.
- `#gl` (WebGL2, `web/ui/fluid.js`) draws the balls and windows; `#stage` (2D) draws traces and the lane; BPM and labels are DOM in `#text`. One `requestAnimationFrame` loop in `web/ui/stage.js`.

## Voice panels (B3)

- **Ball**: a raymarched black-chrome sphere. On each beat a crown of sharp spikes rises (an underdamped spring, `web/ui/dynamics.js`) and sinks back to a smooth dome between beats. The window behind it glows in the voice colour and flashes on the beat.
- **Trace**: a 200-sample ring buffer, scaled by its own max, gradient stroke fading toward the oldest sample. Assigning state only.
- **BPM**: rounded, or a dim `--` while it's 0.
- **No finger**: a small grey still ball in a dim window, a dim `--`, the label *rest a finger on sensor N*, and no trace.

## Music (B4)

| Voice | In the notes lane | On the stage |
|---|---|---|
| drums | ring at the lane floor: kick large, snare medium, hat small, unknown drum medium | the ball ripples |
| bass, lead | dot at height = pitch (`notes[0]`), size = `velocity` | the ball ripples |
| lead | consecutive notes joined by a soft curve, so the melody draws a line | |
| pad | rounded capsule spanning the chord's lowest to highest note | the ball ripples |
| unknown voice | dot in `--other` | none |

Drum ripple rings and the pad wash are gone. The merged window is lit by a slow four-colour dye simulation (stable fluids), stirred on each player's beat. The analyser draws `wave` only, as a faint ribbon behind the lane.

## States (B5)

- **Idle**: four grey balls and one line: *Connect the sensors, or press Simulate to hear a demo.*
- **Unsupported browser**: Connect is disabled, with the line *Use Chrome or Edge to connect sensors. Simulate still works.*
- **Disconnected / error**: a neutral banner under the header (never red) with a Reconnect button. A cancelled port picker reads *No port chosen. Connect sensors to try again.*
- **Reduced motion**: no spikes and no slide; the layouts cross-fade, the dye window is still, and brightness lifts briefly on the beat.
- **No WebGL2 or float render targets**: a plain message; text, traces and lane still work.
- **Performance view**: a button, plus the `F` key, enters fullscreen and hides the header; the cursor hides after 2 s idle; `Esc` exits.
- **Screen readers**: a visually hidden list (voice, finger on/off, BPM) updated once per second. It isn't `aria-live`, to avoid flooding.
