# Wind streams — design

Approved in chat 2026-09-30. Left uncommitted (see CLAUDE.md).

## Goal

After the first full 24 h game day (`DAY_SECONDS` = 360 s of `state.elapsed`)
a second difficulty layer appears: visible wind streams that push airborne
arrivals off course and erase the path the player drew.

## Rules

- **Level**: `windDay = floor(elapsed / DAY_SECONDS)`. Day 1 has no wind.
  Max concurrent streams = `min(WIND_MAX_STREAMS, windDay)` (1 on day 2,
  then +1 per day, capped at 3).
- **Lifecycle** of a stream: `forming` (6 s warning, visible, harmless) →
  `active` (25 s) → `fading` (3 s) → removed. A new one spawns after a random
  15-25 s gap while below the cap; the first 8 s after the wind begins.
- **Shape**: an oriented rect (~50 × 12 world units). The wind blows along
  the rect's heading. Placed uniformly inside the airspace bounds,
  runways included (accepted risk; the warning is the fairness valve).
- **Effect** on a `flying` plane inside an `active` or `fading` stream:
  - drift: `WIND_DRIFT` (3.5 u/s, half of cruise) along the wind, scaled by
    the stream's strength (1 while active, fading ramps to 0);
  - a small sinusoidal heading shove (`WIND_TURN`), zero-mean so the plane
    wobbles rather than circles;
  - **path erased on entry**: the moment a plane goes from outside to inside
    an `active` stream (or a `forming` one turns active under it) its path is
    cleared, `pathAnchored` unlocked (a locked final approach is wiped too)
    and `pathVersion` bumped. The player may redraw inside; drift still
    applies. Leaving and re-entering erases again.
  - immune: departures (climbout, game-flown), ground traffic, departing
    planes leaving the map.
- Collisions and landings keep using the true position.
- Events: `windForming`, `windActive`, `pathLost`.

## Code

- `src/core/windStreams.ts` (new): types helpers, `updateWind(state, dt, rng,
  events)`, phase/strength helpers, `windLevel`.
- `types.ts`: `WindStream`, `GameState.streams/windTimer/nextStreamId`,
  `Plane.windStreamId/wind/windTurn`, three new `SimEvent`s.
- `state.ts`: init/reset the fields.
- `plane.ts`: drift in `moveForward` for `updateFlying`, `windTurn` added to
  the steering target.
- `simulation.ts`: new step phase "wind" between spawn and move.
- `config.ts`: `WIND_*` constants; `DEBUG_START_HOURS`.
- `render/windStreams.ts` (new; not `render/wind.ts`, which is cosmetic
  plane turbulence): ground band with a scrolling chevron texture, faint
  dashed outline while forming, fades out. Owned by `SceneSync`.
- `render/sceneSync.ts`: sync streams each frame, extra chop for planes in wind.
- `ui/eventToasts.ts`: "Wind stream forming", "Path lost — wind".
- `audio/sfx.ts` + `mixer.ts`: synthesised gust cue on `windForming`/`pathLost`.
- Storybook: "Scene/Wind streams" story; gameplay story and docs updated.

## Dev start-time mock

`VITE_DEBUG_START_HOURS` (`.env`, documented in `.env.example`), exposed as
`DEBUG_START_HOURS`; honoured only in `import.meta.env.DEV`. One game hour =
`DAY_SECONDS / 24` = 15 s. A value above 0 starts a shift with
`elapsed = hours × 15` and `landed` = the highest unlock threshold (all
runways open, departures running, full-size airspace). All-or-nothing for
runways. Mocked runs are never submitted to the leaderboard; `main.ts` frames
every open airport on start.

## Not doing

No tests (CLAUDE.md: ignore tests for now). No drifting bands, no
per-hour partial unlocks, no new recordings.
