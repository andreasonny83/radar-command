# Demo mode — design

Date: 2026-10-01 · Status: approved; §1 corrected at plan time (see note there)

## Goal

A **Demo** mode on the start screen: the game plays itself and the user only
watches. A demo run can never reach the leaderboard.

## Decisions (from brainstorming)

- Real sim, real rules, real progression and visuals. No recording or replay.
- An **autopilot** flies the demo. It tries not to crash, but crashes
  happen rarely and for real: on average once per **5 to 7 game days** of play
  (`DAY_SECONDS` = 360; measured, see the lapse rate below).
- On a crash the normal cinematic plays, then a new demo shift starts by
  itself. The user leaves with the EXIT DEMO button. Entry is a button on
  the start screen only; no keyboard shortcut.
- Not in scope: demo-specific camera direction, difficulty options, saving
  demo stats, server changes.

## 1. Autopilot — `src/core/autopilot/` (pure, no DOM/Babylon)

```ts
interface Autopilot {
  /* private: mistake clock, blind spot, per-plane cooldowns */
}
function createAutopilot(rng: Rng, options?: { meanMistakeSeconds?: number }): Autopilot;
function autopilotStep(pilot: Autopilot, state: GameState, dt: number): void;
```

Called from the main loop before each sim sub-step, only in demo mode.
Mutates planes through the **same functions a player uses**
(`core/path.ts`), so every landing is one the rules allow.

> **Correction made at plan time.** The first draft said a plane held back
> is "left pathless; avoidance keeps it apart". That is only true outside
> the airspace: inside it a pathless plane is not steered and can collide
> (core/collision.ts `isInPlay`). So the autopilot never leaves a steerable
> plane inside the airspace (or about to enter it) without a path; it holds
> planes there with explicit detour/orbit paths. Outside the airspace bare
> is safe (the game keeps planes apart), so a plane with no safe route
> there is left, or made, bare.

**Plan by prediction.** Every candidate path is judged on a _predicted
track_: a ghost copy of the plane flown with the real `updatePlane` for
`DEMO_TRACK_HORIZON` seconds, sampled every `DEMO_TRACK_STEP` (the same
trick `anchorPath` already uses for its dry run). Tracks of all other
airborne planes (their own current paths, departures' climb-out routes
included) are predicted the same way. A candidate is valid when:

1. (arrivals) `anchorPath` accepts it on the ghost: runway open and not
   closed by a departure, final leg flyable;
2. its track stays `DEMO_SEPARATION` away from every other track;
3. its track avoids black wind streams in their peak window plus build-up
   (core/windStreams.ts, new `peakAhead`), with a margin;
4. (anchored) its landing time is at least `DEMO_LANDING_GAP` s from any
   other anchored approach to the same runway.

Per replan cycle (`DEMO_REPLAN_INTERVAL`), for each steerable plane
(`isSteerable`, violet departures excluded), in order anchored-first then by
id, the autopilot replans only when needed: the plane has no path, its
track conflicts with a track it must yield to, its track meets a lethal
stream, or it is not yet anchored and a retry is due. Yielding: an
unanchored plane yields to an anchored one; between equals the higher id
yields; everyone yields to a departure (not steerable).

Candidate order (first valid wins; none valid: the best clearance that is
not in a lethal stream): straight final (`DEMO_FINAL_LENGTH`), a longer
final, dog-legs either side, then an orbit either side followed by the long
final. If the runway is closed (nothing anchors) the plane gets an orbit
as a hold, unanchored, and is retried.

Departures are automatic (core/departures.ts); the autopilot only keeps
arrivals clear of them, from lift-off on (their climb-out route is
predicted like any other).

### Rare mistakes

Mistakes must be real or the replan loop (which re-checks every plane every
cycle) would repair any slip within a second. So a mistake is a **blind
spot**: for `DEMO_BLIND_SECONDS` the autopilot cannot see one plane. It
ignores it in every separation check (as "other" and as itself), so it may
route traffic across it, and nothing is scripted. The sim decides whether
that ends in a collision, a go-around or nothing.

`pilot.mistakeIn` (sim-seconds) is drawn from an exponential distribution
with mean `DEMO_MEAN_DAYS_BETWEEN_MISTAKES` game days (`config.ts`). When it
reaches 0, `chooseMistake(candidates, rng)` picks the plane (or declines,
and it retries in a few seconds). Not every blind spot ends in a crash, so
the mean is calibrated with the soak runs. Measured: about 1 lapse in 11
ends in a crash, and without lapses the autopilot crashes about once per
35 game days, so a lapse every half game day gives a crash every 5 to 7
game days. Wind is not a mistake source (the baseline avoids it).

What counts as a mistake is isolated in the small function `chooseMistake`
(`core/autopilot/mistakes.ts`) so it can be tuned without touching the
planner. The plan ships a working default and asks the user to write or
adjust its body.

## 2. Mode wiring — `src/main.ts`

- New module state `demo: boolean`. `beginShift(isDemo)` sets it; the
  START button and Enter/Space start a normal shift (`demo: false`); only
  the WATCH DEMO button passes `demo: true`.
- Leaderboard ban, three independent guards:
  1. `runToken = null` in demo (no `startRun()` call): the server has no
     token to verify, so it would reject a submission anyway.
  2. `offerSubmit` and `submitRun` return early when `demo`.
  3. The HUD never shows the submit form in demo (see §3).
- Game loop: in demo, `autopilotStep` runs before each sim
  sub-step. A new `Autopilot` is created per shift.
- Crash in demo: cinematic as today, then after `CRASH_OVERLAY_DELAY` show
  toast "Demo crashed, restarting…" and call `beginShift(true)`
  after `DEMO_RESTART_DELAY` seconds (config, default 3). No game-over panel.
- `DEBUG_START_HOURS` is ignored in demo (a made-up shift is no demo).
- Pause, speed, camera, follow, sound, help stay available.

## 3. Input and UI

- `input/pointer.ts`: gets a `canRoute` hook (like the existing phase
  check): in demo a press never grabs a plane, so a drag only pans.
- Entry is the start screen only, with **no keyboard shortcut**:
  `ui/hudMarkup.ts` overlay gets a **WATCH DEMO** button beside START SHIFT
  and LEADERBOARD. The overlay is shared with the game-over screen, so
  `showGameOver` hides the button (it shows on the title state only).
- In shift, a **DEMO** badge with an **EXIT DEMO** button (the only way
  out; it is a normal focusable button, blurred after click like the others).
- `ui/hud.ts`: `onDemo` / `onExitDemo` callbacks, `setDemo(on)` toggling the
  badge and button; `showGameOver` is never called in demo.
- `input/shortcuts.ts` is **unchanged**: no new action, no help-panel row.
  The existing keys keep their meaning in a demo (Esc/P/Space pause, Enter
  ignored mid-shift); the pause/speed/camera keys all still work.
- Exit demo → phase back to `start`, title overlay, leaderboard button works
  as normal (viewing the board is fine; only submitting is blocked).
- Licensing panel and audio scenes unchanged (demo uses the `playing` scene).

## 4. Config (`src/config.ts`)

`DEMO_MEAN_DAYS_BETWEEN_MISTAKES`, `DEMO_RESTART_DELAY`, plus autopilot
planner constants (final-approach length, minimum landing spacing, retry
step), each with a doc comment.

## 5. Storybook

- `HUD/…` start overlay story: WATCH DEMO button; a new story state with the
  DEMO badge and EXIT DEMO button.
- A gameplay story playing the autopilot live, with a short mistake mean so
  a crash is easy to see.
- Verify: `npm run typecheck`, render every story and check for
  console/page errors.

## Testing

`CLAUDE.md` says to ignore the old suite, so only the new
`src/core/autopilot/autopilot.test.ts` (headless soak and behaviour runs) is
added and run. Verification is
typecheck, lint, Storybook and a browser run: let a demo play at 3× past one
game day with no crash, confirm no `/api/run` or `/api/scores` request is
made in demo, and force a mistake (short mean) to check the crash → restart
flow.

## Risks

- Autopilot quality is the hard part: it must look competent as traffic and
  runways ramp up. Tune with the live story before settling constants.
- The autopilot can plan a path the sim later breaks (wind, a departure
  closing the runway). It re-plans pathless planes each tick; a plane
  pushed off its path becomes pathless and is re-planned.
