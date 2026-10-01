# Black Wind Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From game day 3 some wind streams spawn black; a flying plane inside one during its short peak window is destroyed, ending the shift with the crash animation.

**Architecture:** A `black` flag on `WindStream` plus `isLethal`/`isPeakWarning` phase helpers in `core/windStreams.ts`. `updateWind` returns the planes caught in a lethal stream; `simulation.ts` turns that into a `crash` event (now `planeIds: number[]` and a `cause`) and ends the game exactly as a collision does. Render, HUD, audio and Storybook layer on top; the existing `CrashEffect` already handles one plane.

**Tech Stack:** TypeScript (strict), Babylon.js, Tailwind HUD, Web Audio, Storybook (`@storybook/html-vite`), Vitest (scratch use only).

**Spec:** `docs/superpowers/specs/2026-10-01-black-wind-streams-design.md` (builds on `2026-09-30-wind-streams-design.md`).

## Global Constraints

- **Never commit or push** (CLAUDE.md). Every "commit" step in a skill template is replaced by "leave uncommitted". The final report lists changed files and a suggested commit message.
- Ignore the test suite (CLAUDE.md). The only test code in this plan is a **scratch** file in Task 1, deleted before the task ends. Do not touch `*.test.ts` files.
- `src/core/` stays pure: no DOM or Babylon imports.
- Match surrounding code: heavy comments, named constants in `src/config.ts`, `.ts` imports without extensions inside `src/`.
- Black streams only from game day 3: `floor(elapsed / DAY_SECONDS) >= BLACK_WIND_FROM_DAY` with `BLACK_WIND_FROM_DAY = 2`. Share `BLACK_WIND_SHARE = 1 / 3`.
- Peak window: opens `BLACK_PEAK_DELAY = 8` s into the active phase, lasts `BLACK_PEAK_SECONDS = 5` s; build-up `BLACK_PEAK_WARN = 2` s before it (never lethal).
- Kill rule: any plane with `phase === "flying"` inside the rect while lethal. Always. Departures (`climbout`) and ground planes are immune.
- Keep Storybook in sync: update affected stories and doc comments, render every changed story, report the Storybook updates in the summary.
- Kill every dev/Storybook/preview server and headless browser you start before finishing (user memory).

## Review Focus

Failure modes the spec implies; each has a scratch check in Task 1.

1. A plane already inside the stream when the window opens dies (not only planes entering during it).
2. A plane in a normal stream overlapping a lethal black one still dies (the existing `find` returns the first stream only).
3. A `climbout` departure and a landed plane inside a lethal stream survive.
4. Two planes in the lethal stream: one `crash` event listing both ids, `cause: "wind"`.
5. A black stream is harmless outside its window: during forming, early active, after the peak, and fading.

---

## File Structure

- Modify `src/config.ts`: five `BLACK_*` constants.
- Modify `src/core/types.ts`: `WindStream.black`, `CrashCause`, `crash` event shape, `blackWindPeak` event.
- Modify `src/core/windStreams.ts`: roll `black`, `isLethal`, `isPeakWarning`, `peakPending`, `updateWind` returns victims, emits `blackWindPeak`.
- Modify `src/core/simulation.ts`: wind kill ends the game; collision crash event gains `cause`.
- Modify `src/render/windStreams.ts`: black look, forming outline tint, flicker and peak flash.
- Modify `src/ui/weatherAlerts.ts`, `src/ui/eventToasts.ts`, `src/ui/hud.ts`, `src/main.ts`: black wording, toast, cause on the game-over title.
- Modify `src/audio/sfx.ts`, `src/audio/mixer.ts`, `src/audio/effects.stories.ts`: rumble cue and soundboard button.
- Modify `src/render/stories/windStreams.stories.ts` (and any story that builds a `WindStream` literal): `black` field, new `BlackWind` story, header docs.

---

### Task 1: Core rules, kill and crash event

**Files:**
- Modify: `src/config.ts` (after `WIND_TURN_RATE`, ~line 565)
- Modify: `src/core/types.ts` (`WindStream` ~line 407; `SimEvent` ~lines 418-441)
- Modify: `src/core/windStreams.ts`
- Modify: `src/core/simulation.ts` (header comment ~lines 8-10 and 103-147)
- Modify: every `WindStream` object literal flagged by `npm run typecheck` (known: three in `src/render/stories/windStreams.stories.ts`) by adding `black: false`.
- Scratch (delete at the end): `src/core/blackWind.scratch.test.ts`

**Interfaces:**
- Produces (used by Tasks 2-4):
  - `config.ts`: `BLACK_WIND_FROM_DAY`, `BLACK_WIND_SHARE`, `BLACK_PEAK_DELAY`, `BLACK_PEAK_SECONDS`, `BLACK_PEAK_WARN` (all `number`).
  - `types.ts`: `WindStream.black: boolean`; `export type CrashCause = "collision" | "wind"`; `SimEvent` `{ type: "crash"; planeIds: number[]; at: Vec2; cause: CrashCause }` and `{ type: "blackWindPeak"; streamId: number }`.
  - `windStreams.ts`: `isLethal(stream: WindStream): boolean`, `isPeakWarning(stream: WindStream): boolean`, `peakPending(stream: WindStream): boolean`, `updateWind(state, dt, rng, events): Plane[]`.

- [ ] **Step 1: Add the constants**

In `src/config.ts`, directly after `export const WIND_TURN_RATE = 2.1;` add:

```ts

/**
 * Black wind streams: a lethal variant of the stream (core/windStreams.ts).
 * Any flying plane inside one during its peak window is destroyed.
 */

/** First game day (0-based, so 2 is the third) on which a new stream may spawn black. */
export const BLACK_WIND_FROM_DAY = 2;

/** Chance a new stream is black, once it may be. */
export const BLACK_WIND_SHARE = 1 / 3;

/** Seconds into a black stream's active phase before its lethal peak opens. */
export const BLACK_PEAK_DELAY = 8;

/** Seconds the peak stays lethal. */
export const BLACK_PEAK_SECONDS = 5;

/**
 * Seconds before the peak opens that the build-up starts (the band
 * flickers, a rumble plays): a warning only, never lethal.
 */
export const BLACK_PEAK_WARN = 2;
```

- [ ] **Step 2: Types**

In `src/core/types.ts`:

(a) In `WindStream`, after the `age: number;` field add:

```ts
  /**
   * A black stream: also lethal to flying planes during its peak window
   * (see `isLethal` in core/windStreams.ts).
   */
  black: boolean;
```

(b) Above `export type SimEvent`, add:

```ts
/** What ended the shift: two planes colliding, or a black wind stream's peak. */
export type CrashCause = "collision" | "wind";
```

(c) Replace the `crash` member:

```ts
  | { type: "crash"; planeIds: [number, number]; at: Vec2 }
```
with
```ts
  | { type: "crash"; planeIds: number[]; at: Vec2; cause: CrashCause }
```

(d) Immediately before the `/** A plane flew into an active wind stream and lost its path. */` member, add:

```ts
  /** A black wind stream's build-up to its lethal peak began (the peak opens shortly). */
  | { type: "blackWindPeak"; streamId: number }
```

- [ ] **Step 3: Core rules in `src/core/windStreams.ts`**

(a) Extend the config import list with `BLACK_PEAK_DELAY, BLACK_PEAK_SECONDS, BLACK_PEAK_WARN, BLACK_WIND_FROM_DAY, BLACK_WIND_SHARE` (keep alphabetical order: they sort before `WIND_ACTIVE_SECONDS`).

(b) Update the header comment: after the paragraph ending "...(`Plane.windTurn`).", add:

```
 *
 * From the third game day some streams spawn black. A black stream does all
 * of the above, and in addition kills any flying plane inside it during its
 * peak window (`isLethal`): `BLACK_PEAK_DELAY` seconds into the active phase,
 * for `BLACK_PEAK_SECONDS`. `BLACK_PEAK_WARN` seconds before that the build-up
 * (`isPeakWarning`) is shown and heard, so the danger is never a surprise.
```

(c) After `windStrength`, add:

```ts
/** Stream age (seconds) at which a black stream's lethal peak opens. */
const PEAK_OPENS = WIND_FORM_SECONDS + BLACK_PEAK_DELAY;
/** Stream age at which the peak closes again. */
const PEAK_CLOSES = PEAK_OPENS + BLACK_PEAK_SECONDS;
/** Stream age at which the build-up to the peak starts. */
const PEAK_BUILDS = PEAK_OPENS - BLACK_PEAK_WARN;

/** Is `stream` a black one inside its lethal peak window? Flying planes in it die. */
export function isLethal(stream: WindStream): boolean {
  return stream.black && stream.age >= PEAK_OPENS && stream.age < PEAK_CLOSES;
}

/** Is `stream` a black one in the build-up just before its peak? Never lethal. */
export function isPeakWarning(stream: WindStream): boolean {
  return stream.black && stream.age >= PEAK_BUILDS && stream.age < PEAK_OPENS;
}

/**
 * Is `stream` a black one whose peak has not finished yet (forecast,
 * forming, active or in its peak)? The HUD keeps the black warning up for it.
 */
export function peakPending(stream: WindStream): boolean {
  return stream.black && stream.age < PEAK_CLOSES;
}
```

(d) Replace `spawnStream` with a version that rolls `black` (rolling only once black is allowed, so days 1-2 keep their old random sequence):

```ts
function spawnStream(state: GameState, rng: Rng): WindStream {
  const b = airspaceBounds(state.world);
  const center = { x: lerp(b.minX, b.maxX, rng()), y: lerp(b.minY, b.maxY, rng()) };
  const heading = rng() * Math.PI * 2;
  const mayBeBlack = Math.floor(state.elapsed / DAY_SECONDS) >= BLACK_WIND_FROM_DAY;
  return {
    id: state.nextStreamId++,
    rect: { center, heading, length: WIND_LENGTH, width: WIND_WIDTH },
    age: -WIND_FORECAST_SECONDS,
    black: mayBeBlack && rng() < BLACK_WIND_SHARE,
  };
}
```

Also extend its doc comment with: "From the third game day it may be a black one."

(e) Change `updateWind` to emit `blackWindPeak` and return the victims. Replace the signature line and doc, the aging loop, and the final line:

```ts
/**
 * Advance the streams by `dt` seconds (age them, start new ones, drop dead
 * ones) and apply them to the planes. Does nothing on the first game day.
 *
 * @returns the flying planes caught inside a black stream's lethal peak.
 *          The caller ends the game (core/simulation.ts); nothing here does.
 */
export function updateWind(state: GameState, dt: number, rng: Rng, events: SimEvent[]): Plane[] {
```

Inside the aging loop, after the `windActive` event block, add:

```ts
    if (stream.black && before !== null && stream.age - dt < PEAK_BUILDS && stream.age >= PEAK_BUILDS) {
      events.push({ type: "blackWindPeak", streamId: stream.id });
    }
```

Replace `for (const plane of state.planes) applyWind(plane, state, events);` with:

```ts
  // The lethal check is its own scan: a plane in a normal stream that
  // overlaps a lethal one is still caught (`applyWind` finds only one).
  const caught: Plane[] = [];
  for (const plane of state.planes) {
    applyWind(plane, state, events);
    if (
      plane.phase === "flying" &&
      state.streams.some((s) => isLethal(s) && pointInRect(plane.pos, s.rect))
    ) {
      caught.push(plane);
    }
  }
  return caught;
```

- [ ] **Step 4: End the game in `src/core/simulation.ts`**

(a) In the header, replace the "2. wind" entry text so it reads:

```
 *   2. wind    – wind streams age and form (from the second game day on); a
 *                plane that flew into an active one loses its path and is
 *                pushed along (core/windStreams.ts). A flying plane caught in
 *                a black stream's peak is destroyed: the game ends here
```

(b) Replace `updateWind(state, dt, rng, events);` (step 2) with:

```ts
  const caught = updateWind(state, dt, rng, events);
  if (caught.length > 0) {
    // A black wind stream's peak: the planes in it are wrecked, same
    // ending as a collision. Leave them in place for the cinematic.
    state.phase = "gameover";
    events.push({
      type: "crash",
      planeIds: caught.map((p) => p.id),
      at: { x: caught[0]!.pos.x, y: caught[0]!.pos.y },
      cause: "wind",
    });
    return events;
  }
```

(c) In the collision block, add `cause: "collision",` after the `at: {...},` property of the `crash` event.

- [ ] **Step 5: Fix literals and typecheck**

Run: `npm run typecheck`
Expected: errors only for `WindStream` literals missing `black`. Add `black: false,` to each (three in `src/render/stories/windStreams.stories.ts`, plus any others reported; check `src/ui/hud.stories.ts` too). Re-run until clean.

- [ ] **Step 6: Scratch checks**

Create `src/core/blackWind.scratch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BLACK_PEAK_DELAY, WIND_FORM_SECONDS, WIND_LENGTH, WIND_WIDTH } from "../config";
import { createPlane } from "./plane";
import { step } from "./simulation";
import { createGameState } from "./state";
import type { GameState, Plane, WindStream } from "./types";
import { updateWind } from "./windStreams";

const OPEN = WIND_FORM_SECONDS + BLACK_PEAK_DELAY;

function setup(age: number, black = true) {
  const state: GameState = createGameState();
  state.phase = "playing";
  state.elapsed = 800; // third game day
  state.spawnTimer = -1e9;
  state.departureTimer = -1e9;
  state.windTimer = 1e9;
  const at = { x: state.world.width / 2, y: state.world.height / 2 };
  const stream = (id: number, b: boolean, a: number): WindStream => ({
    id,
    black: b,
    age: a,
    rect: { center: { ...at }, heading: 0, length: WIND_LENGTH, width: WIND_WIDTH },
  });
  state.streams = [stream(1, black, age)];
  const plane = (id: number): Plane => {
    const p = createPlane(id, "red", { ...at }, 0);
    p.canDepart = false;
    return p;
  };
  return { state, plane, stream };
}

describe("black wind (scratch)", () => {
  it("1. kills a plane already inside when the window opens", () => {
    const { state, plane } = setup(OPEN - 0.1);
    state.planes = [plane(1)];
    expect(updateWind(state, 0, Math.random, [])).toEqual([]);
    state.streams[0]!.age = OPEN + 0.1;
    expect(updateWind(state, 0, Math.random, []).map((p) => p.id)).toEqual([1]);
  });

  it("2. kills through an overlapping normal stream", () => {
    const { state, plane, stream } = setup(OPEN + 1);
    state.streams = [stream(2, false, WIND_FORM_SECONDS + 1), ...state.streams];
    state.planes = [plane(1)];
    expect(updateWind(state, 0, Math.random, [])).toHaveLength(1);
  });

  it("3. spares climbout and landed planes", () => {
    const { state, plane } = setup(OPEN + 1);
    const a = plane(1);
    a.phase = "climbout";
    const b = plane(2);
    b.phase = "landed";
    state.planes = [a, b];
    expect(updateWind(state, 0, Math.random, [])).toEqual([]);
  });

  it("4. one crash event lists every victim", () => {
    const { state, plane } = setup(OPEN + 1);
    state.planes = [plane(1), plane(2)];
    // Two planes on one spot would also collide; the wind phase runs first.
    const events = step(state, 0.01);
    const crash = events.find((e) => e.type === "crash");
    expect(crash).toMatchObject({ cause: "wind", planeIds: [1, 2] });
    expect(state.phase).toBe("gameover");
  });

  it("5. harmless outside the window", () => {
    for (const age of [1, WIND_FORM_SECONDS + 1, OPEN - 0.5, OPEN + 5.5, 33]) {
      const { state, plane } = setup(age);
      state.planes = [plane(1)];
      expect(updateWind(state, 0, Math.random, []), `age ${age}`).toEqual([]);
    }
    const { state, plane } = setup(OPEN + 1, false);
    state.planes = [plane(1)];
    expect(updateWind(state, 0, Math.random, [])).toEqual([]);
  });

  it("announces the build-up once", () => {
    const { state } = setup(OPEN - 2.1);
    const events: import("./types").SimEvent[] = [];
    updateWind(state, 0.2, Math.random, events);
    updateWind(state, 0.2, Math.random, events);
    expect(events.filter((e) => e.type === "blackWindPeak")).toHaveLength(1);
  });
});
```

Run: `npx vitest run src/core/blackWind.scratch.test.ts`
Expected: all PASS. If "announces the build-up once" fails, check the `stream.age - dt < PEAK_BUILDS` condition in Step 3(e).

- [ ] **Step 7: Clean up and verify**

Run: `rm src/core/blackWind.scratch.test.ts && npm run typecheck && npm run lint`
Expected: both clean. Leave everything uncommitted.

---

### Task 2: Black stream rendering

**Files:**
- Modify: `src/render/windStreams.ts`

**Interfaces:**
- Consumes: `isLethal`, `isPeakWarning` from `../core/windStreams` (Task 1); `WindStream.black`.
- Produces: black bands drawn by the existing `WindStreamsView.sync`; no new public API.

- [ ] **Step 1: Header and constants**

Extend the header comment with a paragraph before "Each band is a ground strip...":

```
 * A black stream (`WindStream.black`) is drawn in near-black smoke with a
 * red-orange forming outline. In the 2 s build-up before its lethal peak
 * the band flickers between black and red-orange; through the peak itself
 * it stays red-orange, so the danger window is easy to read.
```

After `export const WIND_COLOR = ...;` add:

```ts
/** Colour of a black stream: near-black with a violet cast, so it still reads on night grass. */
export const BLACK_WIND_COLOR = "#17121f";
/** Colour of a black stream's forming outline, and of its flicker and peak. */
export const BLACK_WIND_ALERT_COLOR = "#ff4a2e";
/** Flickers per second through the build-up to the peak. */
const PEAK_FLICKER_RATE = 5;
```

- [ ] **Step 2: Material colour parameter**

Change `makeMaterial` to take the colour:

```ts
function makeMaterial(
  scene: Scene,
  name: string,
  texture: DynamicTexture,
  color = WIND_COLOR,
): StandardMaterial {
```
and use `Color3.FromHexString(color)` for `mat.emissiveColor`.

Update the import to `import { isLethal, isPeakWarning, windPhase, windStrength } from "../core/windStreams";`.

- [ ] **Step 3: Black materials in `WindStreamsView`**

Add fields:

```ts
  private readonly blackFormingMat: StandardMaterial;
  private readonly blackFrontMat: StandardMaterial;
  private readonly blackBackMat: StandardMaterial;
  /** The red-orange the band takes through the build-up flicker and the peak. */
  private readonly peakMat: StandardMaterial;
```

In the constructor, after the three existing materials:

```ts
    this.blackFormingMat = makeMaterial(scene, "blackWindForming", this.forming, BLACK_WIND_ALERT_COLOR);
    this.blackFrontMat = makeMaterial(scene, "blackWindFront", this.frontTex, BLACK_WIND_COLOR);
    this.blackBackMat = makeMaterial(scene, "blackWindBack", this.backTex, BLACK_WIND_COLOR);
    this.peakMat = makeMaterial(scene, "blackWindPeak", this.frontTex, BLACK_WIND_ALERT_COLOR);
```

- [ ] **Step 4: Pick materials in `sync`**

In the forming branch, replace `front.material = this.formingMat;` with:

```ts
        front.material = stream.black ? this.blackFormingMat : this.formingMat;
```

In the final `else` branch, replace the two material assignments with:

```ts
        // Black streams flicker red-orange through the build-up and stay
        // red-orange through the lethal peak; otherwise near-black.
        const flicker =
          isPeakWarning(stream) && Math.sin(time * PEAK_FLICKER_RATE * Math.PI * 2) > 0;
        const alarm = isLethal(stream) || flicker;
        front.material = stream.black
          ? alarm
            ? this.peakMat
            : this.blackFrontMat
          : this.frontMat;
        back.material = stream.black ? this.blackBackMat : this.backMat;
```

- [ ] **Step 5: Dispose**

In `dispose()`, extend the material and texture loops:

```ts
    for (const mat of [
      this.formingMat,
      this.frontMat,
      this.backMat,
      this.blackFormingMat,
      this.blackFrontMat,
      this.blackBackMat,
      this.peakMat,
    ]) {
      mat.dispose();
    }
```
(textures are shared, so that loop is unchanged).

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean. Visual check comes with the story in Task 4.

---

### Task 3: HUD, toast, audio and game-over wording

**Files:**
- Modify: `src/ui/weatherAlerts.ts`
- Modify: `src/ui/eventToasts.ts`
- Modify: `src/ui/hud.ts` (interface ~line 104; `showGameOver` ~line 495)
- Modify: `src/main.ts` (crash case ~line 443; `offerSubmit` ~line 142)
- Modify: `src/audio/sfx.ts` (`LEVELS` ~line 156; after `windGust` ~line 357)
- Modify: `src/audio/mixer.ts` (`onSimEvent` ~line 257)
- Modify: `src/audio/effects.stories.ts` (soundboard, near line 232)

**Interfaces:**
- Consumes: `peakPending` (Task 1), `CrashCause` and the `blackWindPeak` / `crash.cause` event fields (Task 1).
- Produces: `windAlert(level, black?)`, `Hud.showGameOver(breakdown, name?, cause?)`, `SfxBus.blackWindRumble()` (the sfx class in `audio/sfx.ts`; use its real class name).

- [ ] **Step 1: Weather alert**

In `src/ui/weatherAlerts.ts`, import `peakPending` alongside `warningLevel, windPhase`. Replace `windAlert` and the wind block of `weatherAlerts`:

```ts
/** The warning for wind at `level`; `black` when a lethal black stream is on the way. */
export function windAlert(level: WarningLevel, black = false): WeatherAlert {
  if (black) {
    return {
      id: `wind-black-${level}`,
      level,
      headline: `${levelName(level)} warning of black wind`,
      advice: `${ACTION[level]}: black wind streams destroy aircraft at their peak`,
    };
  }
  return {
    id: `wind-${level}`,
    level,
    headline: `${levelName(level)} warning of wind`,
    advice: `${ACTION[level]}: strong winds may erase flight paths`,
  };
}
```

```ts
  // Wind: from the forecast until the first stream turns active. A black
  // stream keeps the (black) warning up until its lethal peak is over.
  const blackComing = state.streams.some(peakPending);
  const windComing = state.streams.some((s) => {
    const phase = windPhase(s);
    return phase === "forecast" || phase === "forming";
  });
  if (blackComing || windComing) alerts.push(windAlert(warningLevel(state.elapsed), blackComing));
```

Update the file header sentence "Only wind streams so far" to mention black wind.

- [ ] **Step 2: Toast**

In `src/ui/eventToasts.ts` import `WARNING_HEX` with `COLOR_HEX` from `../config`, and add before `default:`:

```ts
    // The build-up to a black wind stream's lethal peak (core/windStreams.ts).
    case "blackWindPeak":
      return { text: "Black wind peaking — get clear", color: WARNING_HEX.red };
```

- [ ] **Step 3: Game-over title by cause**

In `src/ui/hud.ts`: import `CrashCause` as a type from `../core/types` (extend the existing type import if present). In the `Hud` interface change

```ts
  showGameOver(breakdown: ScoreBreakdown, name?: string): void;
```
to
```ts
  showGameOver(breakdown: ScoreBreakdown, name?: string, cause?: CrashCause): void;
```
(add to its doc: "`cause` picks the headline: CRASH! for a collision, BLACK WIND! for a black wind stream.") In the implementation change the signature to `showGameOver(b, name = "", cause = "collision")` and the title line to:

```ts
      title.textContent = cause === "wind" ? "BLACK WIND!" : "CRASH!";
```

In `src/main.ts`: import `CrashCause` type; near `let gameOverIn` add

```ts
/** What ended the shift, for the game-over headline (set by the `crash` event). */
let crashCause: CrashCause = "collision";
```
In `case "crash":` add `crashCause = event.cause;` before `const site = ...`. In `offerSubmit` change to `hud.showGameOver(breakdown, savedName(), crashCause);`.

- [ ] **Step 4: Rumble sound**

In `src/audio/sfx.ts` add `blackWind: 0.22,` to `LEVELS` after `windGust: 0.16,`. After the `windGust` method add (use the same class that owns `windGust`):

```ts
  /**
   * The build-up to a black wind stream's lethal peak (`blackWindPeak`): a
   * low noise swell over a falling sub tone, lasting just past the 2 s
   * build-up (`BLACK_PEAK_WARN`). Synthesised and not panned: it is the weather.
   */
  blackWindRumble(): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const dur = 3.5;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 220;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(LEVELS.blackWind, t + dur * 0.55);
    env.gain.linearRampToValueAtTime(0, t + dur);
    this.noiseSource(t, dur).connect(low).connect(env).connect(this.out);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + dur);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + dur);
  }
```

In `src/audio/mixer.ts` `onSimEvent`, add before `default:`:

```ts
      case "blackWindPeak":
        this.graph?.sfx.blackWindRumble();
        break;
```

- [ ] **Step 5: Soundboard button**

Read `src/audio/effects.stories.ts` around the wind entries (~line 232, where `windForecast` is fired). Add a sibling button/entry in the same style that calls `audio.onSimEvent({ type: "blackWindPeak", streamId: 1 }, pan)`, labelled "Black wind peak". Update the story's doc comment if it lists the wind effects.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean. Existing callers of `showGameOver(b)` (stories) still compile thanks to the optional parameters.

---

### Task 4: Storybook story, docs and end-to-end verification

**Files:**
- Modify: `src/render/stories/windStreams.stories.ts`
- Modify (only if they name changed things): `src/render/stories/gameplay.stories.ts` doc comments

**Interfaces:**
- Consumes: everything above. Adds the story `Scene/Wind streams/BlackWind`.

- [ ] **Step 1: Imports and header**

In `windStreams.stories.ts` extend the config import with `BLACK_PEAK_DELAY, BLACK_PEAK_WARN, PLANE_SPEED`. Update the header comment: add a bullet

```
 *   - BlackWind: a black stream builds to its lethal peak (flickering red-orange, with
 *               the "Black wind peaking" toast and rumble) and a plane flying into it is
 *               destroyed: crash cinematic, then the scene replays. `sound` plays the rumble.
```
and extend the tuning-loop paragraph with `BLACK_*` in config.ts, `BLACK_WIND_COLOR` / `BLACK_WIND_ALERT_COLOR` / `PEAK_FLICKER_RATE` in render/windStreams.ts, and `blackWindRumble` in audio/sfx.ts.

- [ ] **Step 2: Add the story**

Insert before the `// Live` section divider:

```ts
// ---------------------------------------------------------------------------
// BlackWind
// ---------------------------------------------------------------------------

interface BlackWindArgs {
  sound: boolean;
  /** Seconds after the crash before the scene restarts. */
  replayAfter: number;
  timeScale: number;
}

/** A plane flies into a black stream as its peak opens: build-up, then the crash. */
export const BlackWind: StoryObj<BlackWindArgs> = {
  argTypes: {
    replayAfter: { control: { type: "range", min: 6, max: 40, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 3, step: 0.05 } },
  },
  args: { sound: false, replayAfter: 14, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, 0, 1.3);
      dragToPan(stage, cam.controller);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      const { show, alerts } = toaster(stage);
      const audio = storyAudio(stage, args.sound);
      const mid = { x: state.world.width / 2, y: state.world.height / 2 };
      /** Seconds the plane flies before it reaches the stream's edge. */
      const APPROACH = 4;

      const stageScene = () => {
        cam.controller.release();
        state.phase = "playing";
        state.spawnTimer = -1e9; // nothing arrives: only the staged plane
        state.departureTimer = -1e9;
        state.windTimer = 1e9; // no more streams
        state.elapsed = 800; // past the first days, for the wind level
        // A black stream across the plane's way, 2 s into its active
        // phase: the build-up starts as the plane reaches it and the peak
        // opens two seconds after.
        const stream: WindStream = {
          id: 1,
          black: true,
          age: WIND_FORM_SECONDS + BLACK_PEAK_DELAY - BLACK_PEAK_WARN - APPROACH,
          rect: {
            center: { ...mid },
            heading: Math.PI / 2,
            length: WIND_LENGTH,
            width: WIND_WIDTH,
          },
        };
        state.streams = [stream];
        state.nextStreamId = 2;
        // Heading east, so it enters the band (width WIND_WIDTH across x)
        // `APPROACH` seconds in.
        const plane = createPlane(
          state.nextPlaneId++,
          "red",
          { x: mid.x - WIND_WIDTH / 2 - PLANE_SPEED * APPROACH, y: mid.y },
          0,
        );
        plane.canDepart = false;
        state.planes = [plane];
      };
      stageScene();

      let time = 0;
      /** Seconds since the crash, or null before it. */
      let sinceCrash: number | null = null;
      return (dt) => {
        time += dt;
        for (const event of step(state, dt)) {
          show(event);
          audio?.onSimEvent(event, (id) => sync.panFor(id));
          if (event.type === "crash") {
            const site = sync.crash(event.planeIds);
            if (site) cam.controller.focusOn(site);
            sinceCrash = 0;
          }
        }
        if (sinceCrash !== null) {
          sinceCrash += dt;
          if (sinceCrash >= args.replayAfter) {
            // New plane id clears the wreckage; fly it all again.
            sinceCrash = null;
            stageScene();
          }
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        alerts(state);
        if (audio) for (const cue of sync.takeAudioCues()) audio.cue(cue);
      };
    }, args.timeScale),
};
```

Timing note: the stream starts at age 8, so it enters its build-up (age 12) just as the plane, `APPROACH` seconds out, reaches the band's edge, and the peak opens at age 14 while the plane is inside. The `age` expression is tied to `APPROACH`, so changing it keeps the timing right.

- [ ] **Step 3: Fix other doc comments**

Search story/doc comments naming `showGameOver`, the crash event shape, or "two planes collide" in `gameplay.stories.ts`; update only wording the change made false. Do not edit stories that need no change.

- [ ] **Step 4: Static checks**

Run: `npm run typecheck && npm run lint && npx prettier --check $(git diff --name-only | grep '\.ts$')`
Expected: clean. If prettier complains, run `npx prettier --write` on those files only.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Render the stories**

Start Storybook (`npm run storybook`, background). For each story id below open `iframe.html?id=<id>` with the chrome-devtools MCP, wait, screenshot, and list console messages; there must be no errors or page errors:

- `scene-wind-streams--black-wind` (confirm: black band, flicker red-orange about 2 s before the peak, "Black wind peaking — get clear" toast, plane destroyed with the fireball, camera orbit, scene replays after `replayAfter`)
- `scene-wind-streams--path-loss`, `scene-wind-streams--live` (normal streams unchanged)
- `scene-gameplay--crash` (two-plane crash still fine; use the actual id shown in the sidebar if different)
- `audio-effects--*` soundboard story (renders; new button present)
- the HUD story that shows the weather strip (`hud.stories.ts`; renders)

- [ ] **Step 6: Game check at day 3**

Set `VITE_DEBUG_START_HOURS=48` in `.env` temporarily (or the dev environment), run `npm run dev`, play until a black stream appears, confirm warning strip text, flicker, toast, and the "BLACK WIND!" game-over headline after flying a plane into it. Revert the `.env` change.

- [ ] **Step 7: Clean up**

Stop Storybook, the dev server, and the headless browser. Leave everything uncommitted.

- [ ] **Step 8: Report**

Tell the user the work is ready; list changed files; mention the Storybook updates (new `BlackWind` story, `black: false` on existing literals, header docs, soundboard button); suggest this commit message:

```
feat: black wind streams that destroy planes at their peak
```

---

## Self-Review

- **Spec coverage:** spawn rule (T1.3d); timeline and peak window helpers (T1.3c); kill rule incl. overlapping streams and immunity (T1.3e + scratch 1-3); crash event generalisation and early return (T1.2, T1.4); `blackWindPeak` (T1.3e, T3.2, T3.4); render variant (T2); weather alert and toasts (T3.1-2); game-over cause (T3.3); rumble and soundboard (T3.4-5); Storybook and dev (T4). Spec's "game-over text reads the cause" is the title, "BLACK WIND!".
- **Placeholders:** none. The only judgement left is naming the real `sfx` class and the soundboard entry style, both pointed at existing code.
- **Type consistency:** `isLethal`, `isPeakWarning`, `peakPending`, `updateWind(...): Plane[]`, `CrashCause`, `crashCause`, `blackWindRumble`, `blackWindPeak` are spelled the same wherever used.
