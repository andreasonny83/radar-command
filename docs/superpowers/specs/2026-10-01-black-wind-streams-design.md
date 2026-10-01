# Black wind streams — design

Approved in chat 2026-10-01. Left uncommitted (see CLAUDE.md). Builds on
`2026-09-30-wind-streams-design.md` (normal streams already shipped).

## Goal

From game day 3 a share of wind streams spawn **black**: a lethal variant.
A flying plane inside a black stream during its short *peak window* is
destroyed. That ends the shift and plays the crash animation.

## Rules

- **Spawn**: from game day 3 (`floor(elapsed / DAY_SECONDS) >= BLACK_WIND_FROM_DAY`,
  = 2) each new stream is black with probability `BLACK_WIND_SHARE` (1/3).
  Same cap, timers, forecast and phases as a normal stream. Days 1-2 never
  produce black streams.
- **Timeline of a black stream** (ages in seconds since forming began):
  forecast, forming (6 s, harmless), active (25 s: push and path loss as a
  normal stream, no kill), **peak** (lethal), active again, fading (3 s).
- **Peak window**: opens `BLACK_PEAK_DELAY` (8 s) into the active phase and
  lasts `BLACK_PEAK_SECONDS` (5 s). `BLACK_PEAK_WARN` (2 s) before it opens
  is a visible and audible build-up only (never lethal).
- **Kill rule**: while `isLethal(stream)`, any plane with `phase === "flying"`
  whose position is inside the stream rect dies. Always, no dice. Not only
  planes that enter during the window: one already inside dies too.
- **Immune**: departures (game-flown climbout), ground traffic, departing
  planes, same as normal wind.
- Collisions and landings keep using the true position. A plane that
  touches down in the same step the window is lethal is killed first
  (wind phase runs before landing).

## Code

- `config.ts`: `BLACK_WIND_FROM_DAY`, `BLACK_WIND_SHARE`, `BLACK_PEAK_DELAY`,
  `BLACK_PEAK_SECONDS`, `BLACK_PEAK_WARN`.
- `core/types.ts`: `WindStream.black: boolean`. `SimEvent.crash` becomes
  `{ type: "crash"; planeIds: number[]; at: Vec2; cause: "collision" | "wind" }`.
  New event `{ type: "blackWindPeak"; streamId }` fired when the build-up
  begins (drives the rumble cue and toast).
- `core/windStreams.ts`: roll `black` in `spawnStream`; `isLethal(stream)` and
  `isPeakWarning(stream)` phase helpers; `updateWind` returns the planes
  caught in a lethal stream (no mutation of game phase here).
- `core/simulation.ts`: after the wind step, if any plane was caught: set
  `phase = "gameover"`, emit `crash` (`cause: "wind"`, `at` = the plane's
  position), return early, same as a collision. Collision code builds the
  new `crash` shape with `cause: "collision"`.
- `render/windStreams.ts`: black variant. Charcoal smoke-wisp tile and dark
  fill, red-orange forming outline, darken and pulse through the peak
  warning, bright flash through the peak window.
- `render/sceneSync.ts` / `render/crash.ts`: reuse the existing crash effect
  for a single plane (already supports any source count); no new effect.
- `main.ts`: pass `event.planeIds` as before; the game-over headline reads the
  cause ("WIND SHEAR!" for a wind crash).
- `core/windStreams.ts` `streamWarningLevel(stream)`: red for a black stream,
  yellow for an ordinary one (replaces the day-based `warningLevel`). The
  `windForecast` event carries that level, so from day 3 the warnings are a
  mix of yellow and red.
- `ui/weatherAlerts.ts`: one strip line per level on the way (red first):
  "Red warning of extreme wind" / "Take action: extreme winds can destroy
  aircraft", and the yellow one as before. The red line stays up until the
  peak is over (`peakPending`).
- `ui/eventToasts.ts`: "Extreme wind peaking — get clear" on `blackWindPeak`.
  The player never sees the word "black": it is an internal name only.
- `audio/sfx.ts` (+ `mixer.ts` if needed): deeper rumble variant of the
  synthesised gust at `blackWindPeak`.
- Storybook: "Scene/Wind streams" black-variant story covering every phase
  and the peak; a one-plane crash story; refresh doc comments that name
  changed constants and files.

## Dev

`VITE_DEBUG_START_HOURS=48` or higher starts on day 3. Mocked runs are still
never submitted to the leaderboard.

## Not doing

Per-plane kill chance, new recordings, a separate black-stream cap or timer,
killing departures, tests (CLAUDE.md: ignore tests for now).
