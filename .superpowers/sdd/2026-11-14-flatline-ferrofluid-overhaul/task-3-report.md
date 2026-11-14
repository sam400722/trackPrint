# Task 3 report: page shell

## Result
- Updated `web/index.html` with the flatline title, required canvases and overlays, primary Connect control, and preserved all existing behavior IDs and controls.
- Replaced `web/ui/style.css` with the approved black radial ground, Fraunces/Nunito controls, status indicator, text labels, and viewport-scaled layout tokens.
- Preserved the existing three local font-face rules, kit/select styling, disabled controls, hidden-state rules, screen-reader styling, performance-view behavior, and reduced-motion block.

## Checks
- Required removed-token grep: no output for `bg-a|bg-b|--wash|--serif|--sans|.seg` in `web/ui/style.css` or `web/index.html`.
- `cd web && node test.mjs`: passed; seven `ok` lines (serial, signal, mapping, heart, contract, lane, dynamics).
- `git diff --check`: passed.
- Browser screenshot was not captured here; controller owns the localhost:8001 screenshot review.

## Files changed
- `web/index.html`
- `web/ui/style.css`
- `.superpowers/sdd/2026-11-14-flatline-ferrofluid-overhaul/task-3-report.md` (this report)

## Concerns
- No functional hook changes found in `web/ui/ui.js`; `#stage` remains click-enabled for simulation routing.
- Visual screenshot review remains with the controller.

## Commit
`cb2da57` — `feat: flatline page shell, black ground and Fraunces controls`

## Reviewer fix
- Restored body typography with `font: 400 calc(2 * var(--u)) var(--ui)` so the Kit label inherits the UI font and viewport-scaled size.
- Removed-token grep output: no matches.
- `git diff --check`: passed.
