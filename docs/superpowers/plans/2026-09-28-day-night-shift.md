# Day/Night Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every shift runs through a looping time of day (08:00 start, 8 real minutes per 24 h). The sky, sun/moon and shadows change, and night lights, music, ambience and a HUD clock follow. Gameplay rules are unchanged.

**Architecture:**
- A pure clock in `src/core/daytime.ts` turns `state.elapsed` into hours, sun/moon arcs and a `night` value (0 = day … 1 = night).
- `src/render/dayCycle.ts` blends a keyframe palette (`src/render/dayTuning.ts`) onto the scene's existing lights.
- `SceneSync.setNight(n)` passes `night` on to fake night lights. There are no new Babylon lights: only emissive meshes, additive "light pool" discs, and one shared glow layer (`src/render/glow.ts`) that lights scenery only at night.
- `main.ts` hands the same number to audio (`GameAudio.setNight`) and the HUD (`hud.setClock`).

**Tech Stack:** TypeScript (strict), Babylon.js 9 (`@babylonjs/core` deep imports), Web Audio, Tailwind v4 HUD, Storybook (`@storybook/html-vite`), Vite.

**Spec:** `docs/superpowers/specs/2026-09-28-day-night-shift-design.md`

## Global Constraints

- **Never commit or push.** Leave every change uncommitted. There are no commit steps; each task ends with "leave uncommitted".
- **Ignore tests.** `CLAUDE.md` says the suite is incomplete. Write no Vitest tests. Verify with `npm run typecheck`, `npm run lint`, Storybook renders and in-game checks.
- `src/core/` stays pure: no DOM or Babylon imports. All Babylon code stays in `src/render/` / `src/input/`.
- Babylon imports are ES deep imports (e.g. `@babylonjs/core/Layers/glowLayer`), never the barrel.
- Every per-frame update is `dt`-driven.
- Code is heavily commented, in the surrounding style (file header block, JSDoc on exports, `//` comments explaining *why*).
- The day look at noon is unchanged: the noon keyframe equals today's `scene.ts` constants to the nearest 1/255.
- `DAY_SECONDS = 480`, `SHIFT_START_HOUR = 8`. Night is full from 22:00 to 04:00, with smoothstep ramps 19:00–22:00 and 04:00–07:00.
- **Readability floor:** at full night, plane liveries, runway colours, paths and rings stay as readable as by day.
- Kill every dev / Storybook / preview server and headless browser at the end (user memory).

## Review Focus

1. **New shift started after dark:** it fast-forwards through dawn to 08:00 in ≈1–1.5 s along the shorter way round the clock. It never snaps and never replays a whole day. Pinned in Task 3, Step 5.
2. **Scenery built or spawned while it's already night:** a boat that spawns at night, a runway opened (rebuilt) at night, or a new plane at night must show its night lights at once, not wait for the next on/off transition. Pinned in Tasks 6, 8, 9 and 10 (the "built at night" checks).
3. **`setNight` called before audio exists** (the audio graph is only built on the first click; stories and a future "continue shift" can set night first): once audio starts, the music must start in the night loop and the terminal dimmed. `GameAudio` must replay the stored `night` into the graph it creates. Pinned in Task 11, Steps 5–6 (the story calls `setNight` *before* `unlock`).
4. **Pause at night:** the clock, lights and fast-forward all freeze with `state.elapsed`. Resuming carries on from the same hour. Pinned in Task 3, Step 5.
5. **Stories that never create a `DayCycle`** (every existing Babylon story): they must look exactly as today. `night` defaults to 0, so night-only glow, pools and lamps stay hidden. Pinned in Task 5, Step 7 and Task 13.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/core/daytime.ts` | create | Pure clock: `clockHours`, `sunArc`, `moonArc`, `nightFactor`, `wrapHours`. |
| `src/render/dayTuning.ts` | create | `DayKeyframe` type, `DAY_KEYFRAMES`, live-tuning override (`dayPalette` / `setDayPalette`). |
| `src/render/dayCycle.ts` | create | `DayCycle`: blends the palette, drives fill/key/shadows/clear colour, fast-forward. |
| `src/render/glow.ts` | create | `SceneGlow`: the one glow layer per scene; night-only meshes glow × `night`. |
| `src/render/nightLights.ts` | create | Helpers: lamp and pool materials, `setNightLevel`, `createPoolMesh`. |
| `src/render/scene.ts` | modify | Export `SUN_DIRECTION`, `SUN_DISTANCE`; return `fill` and `key` in `SceneContext`. |
| `src/render/meshes.ts` | modify | Use `SceneGlow`; add `setNight` (livery and colour self-light). |
| `src/render/sceneSync.ts` | modify | `setNight` fan-out; plane landing-light beams. |
| `src/render/runway.ts`, `airfield.ts`, `bridges.ts`, `airportGrounds.ts` | modify | Night glow on lights, stand floodlight pools, warm glass. |
| `src/render/landscape.ts` | modify | `setNight` fan-out, night water. |
| `src/render/countryside.ts` | modify | Lit windows (per-house thresholds), street lamps and pools. |
| `src/render/cars.ts` | modify | Head/tail lights and road beams. |
| `src/render/boats.ts` | modify | Masthead/cabin lanterns. |
| `src/render/stories/stage.ts` | modify | Expose `fill` / `key`; reset the day palette per story. |
| `src/render/stories/dayCycle.stories.ts` | create | "Tuning/Time of day": `Cycle` + one story per keyframe with a snippet panel. |
| `src/audio/music.ts`, `ambience.ts`, `mixer.ts` | modify | Night progression with hysteresis, sparser piano, dimmer terminal, longer PA gaps, `setNight`. |
| `src/audio/music.stories.ts` | modify | `night` toggle. |
| `src/ui/hudMarkup.ts`, `hud.ts` | modify | Clock chip + `setClock` + `formatClock`. |
| `src/ui/hudMarkup.stories.ts`, `hud.stories.ts` | modify | Clock in the score-panel story; `hours` arg + `Night` screen. |
| `src/main.ts` | modify | Create `DayCycle`, per-frame wiring, body background, debug handle. |
| `src/style.css` | modify | Comment only (body colour now also set at runtime). |
| `CLAUDE.md` | modify | Mention the new files and story. |

---

## Phase 1: clock, sky, sun/moon

### Task 1: Pure clock (`src/core/daytime.ts`)

**Files:**
- Create: `src/core/daytime.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DAY_SECONDS: number` (480), `SHIFT_START_HOUR: number` (8)
  - `interface SkyArc { height: number; sweep: number }`
  - `clockHours(elapsed: number): number` (0 ≤ h < 24)
  - `wrapHours(delta: number): number` (signed, in [-12, 12))
  - `sunArc(hours: number): SkyArc`, `moonArc(hours: number): SkyArc`
  - `nightFactor(hours: number): number` (0..1)

- [ ] **Step 1: Create the file**

```ts
/**
 * Time of day for a shift: the pure clock behind the day/night cycle.
 *
 * The clock is derived from `GameState.elapsed` (never stored), so it
 * resets with every new shift and stands still whenever the sim does
 * (paused, game over). No DOM, no Babylon: the render layer
 * (render/dayCycle.ts) turns these numbers into light, the audio and HUD
 * read the same `nightFactor`.
 *
 * Hours run 0 ≤ h < 24. A shift opens at `SHIFT_START_HOUR` and one full
 * 24 h loop takes `DAY_SECONDS` of play (20 s per game hour):
 *
 *   0:00 → 08:00 · 3:40 → 19:00 dusk begins · 4:40 → 22:00 full night
 *   7:40 → 07:00 day again · 8:00 → 08:00 (repeats)
 */

/** Real seconds of play per 24 h loop. */
export const DAY_SECONDS = 480;

/** Hour every shift (and the start screen) opens at. */
export const SHIFT_START_HOUR = 8;

/** Sun up / down (hours). Noon, the top of the arc, is halfway: 13:00. */
const SUNRISE = 6.5;
const SUNSET = 19.5;

/** Night ramps (hours): dusk fades in, dawn fades out. Full night between. */
const DUSK_START = 19;
const DUSK_END = 22;
const DAWN_START = 4;
const DAWN_END = 7;

/** The moon rides the same arc 12 h later, this much lower. */
const MOON_HEIGHT = 0.6;

/**
 * Where a sky light sits on its daily arc, independent of the scene's axes
 * (render/dayCycle.ts maps it onto a light direction):
 * - `height`: 1 at the top of the arc, 0 on the horizon, < 0 below it;
 * - `sweep`:  -1 at rise, 0 at the top, 1 at set (beyond ±1 below the
 *             horizon).
 */
export interface SkyArc {
  height: number;
  sweep: number;
}

/** Time of day (hours, 0 ≤ h < 24) after `elapsed` seconds of a shift. */
export function clockHours(elapsed: number): number {
  const h = SHIFT_START_HOUR + (elapsed / DAY_SECONDS) * 24;
  return ((h % 24) + 24) % 24;
}

/**
 * Signed shortest way round the clock for an hour difference, in
 * [-12, 12): e.g. 22:00 → 02:00 is +4, not -20.
 */
export function wrapHours(delta: number): number {
  return ((((delta + 12) % 24) + 24) % 24) - 12;
}

/** The sun's place on its arc at `hours`. */
export function sunArc(hours: number): SkyArc {
  const noon = (SUNRISE + SUNSET) / 2;
  const half = (SUNSET - SUNRISE) / 2;
  const sweep = wrapHours(hours - noon) / half;
  // Cosine arc: 1 at noon, 0 at rise and set, negative through the night.
  return { height: Math.cos((sweep * Math.PI) / 2), sweep };
}

/** The moon's place: the sun's arc 12 h on, kept low. */
export function moonArc(hours: number): SkyArc {
  const s = sunArc(hours + 12);
  return { height: s.height * MOON_HEIGHT, sweep: s.sweep };
}

/** 0..1 ease with zero slope at both ends (no visible kink in the fade). */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * How dark it is: 0 = full day, 1 = full night (22:00–04:00, a quarter of
 * the loop), smooth ramps through dusk (19–22) and dawn (04–07). Drives
 * night lights, music, ambience and the HUD icon.
 */
export function nightFactor(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  if (h >= DUSK_END || h < DAWN_START) return 1;
  if (h >= DUSK_START) return smoothstep((h - DUSK_START) / (DUSK_END - DUSK_START));
  if (h < DAWN_END) return 1 - smoothstep((h - DAWN_START) / (DAWN_END - DAWN_START));
  return 0;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Sanity-check the numbers in Node** (throwaway, nothing saved)

Run:
```bash
npx tsx -e 'import("./src/core/daytime.ts").then(d => console.log(d.clockHours(0), d.clockHours(220), d.clockHours(280), d.nightFactor(8), d.nightFactor(23), d.nightFactor(20.5).toFixed(2), d.wrapHours(8 - 2), d.wrapHours(8 - 22), d.sunArc(13).height, d.sunArc(6.5).height.toFixed(3)))'
```
Expected: `8 19 22 0 1 0.50 6 10 1 0.000`. (If `tsx` is missing, run `npx --yes tsx …`.)

- [ ] **Step 4: Leave uncommitted.**

---

### Task 2: Palette + `DayCycle`

**Files:**
- Modify: `src/render/scene.ts` (export constants, return lights)
- Create: `src/render/dayTuning.ts`
- Create: `src/render/dayCycle.ts`

**Interfaces:**
- Consumes (Task 1): `clockHours`, `sunArc`, `moonArc`, `nightFactor`, `wrapHours`, `SHIFT_START_HOUR`.
- Produces:
  - `scene.ts`: `export const SUN_DIRECTION: Vector3`, `export const SUN_DISTANCE: number`, and `SceneContext` gains `fill: HemisphericLight; key: DirectionalLight`.
  - `dayTuning.ts`: `interface DayKeyframe`, `DAY_KEYFRAMES`, `dayPalette(): readonly DayKeyframe[]`, `setDayPalette(p?: readonly DayKeyframe[]): void`.
  - `dayCycle.ts`: `class DayCycle` with `constructor(ctx: DayCycleLights)`, `update(elapsed: number, dt: number): void`, `setHours(hours: number): void`, readonly-ish fields `hours: number`, `night: number`, `clearColor: string`. `interface DayCycleLights { scene: Scene; fill: HemisphericLight; key: DirectionalLight; shadows: ShadowGenerator }`.

- [ ] **Step 1: `scene.ts`: export the sun constants and return the lights**

In `src/render/scene.ts`:
- Change `const SUN_DIRECTION = …` to `export const SUN_DIRECTION = …`.
- Change `const SUN_DISTANCE = 150;` to `export const SUN_DISTANCE = 150;`.
- Replace the file header with:

```ts
/**
 * Babylon engine + scene bootstrap: renderer, clear colour, lights and the
 * shared shadow generator.
 *
 * The lights are created here with the noon look (these constants are the
 * noon keyframe in dayTuning.ts). In the game, render/dayCycle.ts then moves
 * them through the day; stories that don't create a `DayCycle` keep this
 * noon look.
 */
```

- Extend the interface and the return:

```ts
export interface SceneContext {
  engine: Engine;
  scene: Scene;
  /** Shared generator: register anything that should cast a shadow. */
  shadows: ShadowGenerator;
  /** Sky fill light (render/dayCycle.ts retints it through the day). */
  fill: HemisphericLight;
  /** Sun / moon: the shadow-casting key light (moved by render/dayCycle.ts). */
  key: DirectionalLight;
}
```

and change `return { engine, scene, shadows };` to `return { engine, scene, shadows, fill, key };`.

- [ ] **Step 2: Create `src/render/dayTuning.ts`**

```ts
/**
 * Time-of-day palette: how the scene is lit at key hours of the day. Purely
 * visual (render/dayCycle.ts blends it); the sim never reads it.
 *
 * `DAY_KEYFRAMES` are blended linearly between neighbours, wrapping round
 * midnight. "morning", "noon" and "afternoon" share the noon values, so the
 * working day holds the classic look and only the sun moves; the colour
 * shifts happen at dawn and dusk.
 *
 * Tuning loop (like flightTuning.ts): open "Tuning/Time of day" in
 * Storybook, pick a keyframe story, tweak its controls, copy the snippet
 * from the panel and paste it over `DAY_KEYFRAMES` below.
 *
 * Night keyframes stay a deep blue, never black: planes, paths and runway
 * colours must read as well at 02:00 as at noon (the readability floor,
 * see MeshFactory.setNight).
 */

/** How the scene is lit at `hour`. Colours are "#rrggbb". */
export interface DayKeyframe {
  /** Name shown in the tuning story and the snippet. */
  name: string;
  /** Hour of day this look is exact at (0 ≤ hour < 24). */
  hour: number;
  /** Scene clear colour: the darkened grass past the map edge. */
  clear: string;
  /** Hemispheric fill: sky colour from above… */
  fillColor: string;
  /** …and the bounce from the ground below. */
  fillGround: string;
  fillIntensity: number;
  /** Key light (sun by day, moon by night) colour and strength. */
  keyColor: string;
  keyIntensity: number;
  /** Shadow darkness: 0 = black, 1 = no shadow. */
  shadowDarkness: number;
}

/** Hand-tuned palette, sorted by hour. The noon rows match scene.ts. */
export const DAY_KEYFRAMES: readonly DayKeyframe[] = [
  { name: "lateNight", hour: 3, clear: "#0e1a1c", fillColor: "#5b6f9e", fillGround: "#1c2a26", fillIntensity: 0.34, keyColor: "#9fb4e8", keyIntensity: 0.18, shadowDarkness: 0.6 },
  { name: "predawn", hour: 5, clear: "#16201f", fillColor: "#6f78a8", fillGround: "#232f28", fillIntensity: 0.36, keyColor: "#9fb4e8", keyIntensity: 0, shadowDarkness: 1 },
  { name: "dawn", hour: 6.5, clear: "#2a3d22", fillColor: "#f0c4c8", fillGround: "#3a4a30", fillIntensity: 0.5, keyColor: "#ffb070", keyIntensity: 0.55, shadowDarkness: 0.45 },
  { name: "morning", hour: 8.5, clear: "#2f5222", fillColor: "#f2f7ff", fillGround: "#405933", fillIntensity: 0.65, keyColor: "#fff2d9", keyIntensity: 0.75, shadowDarkness: 0.25 },
  { name: "noon", hour: 13, clear: "#2f5222", fillColor: "#f2f7ff", fillGround: "#405933", fillIntensity: 0.65, keyColor: "#fff2d9", keyIntensity: 0.75, shadowDarkness: 0.25 },
  { name: "afternoon", hour: 16.5, clear: "#2f5222", fillColor: "#f2f7ff", fillGround: "#405933", fillIntensity: 0.65, keyColor: "#fff2d9", keyIntensity: 0.75, shadowDarkness: 0.25 },
  { name: "dusk", hour: 19.5, clear: "#2b3f20", fillColor: "#f2b8a0", fillGround: "#3b4730", fillIntensity: 0.5, keyColor: "#ff9a4a", keyIntensity: 0.45, shadowDarkness: 0.4 },
  { name: "blueHour", hour: 21, clear: "#14221f", fillColor: "#6a7cb8", fillGround: "#22302a", fillIntensity: 0.4, keyColor: "#ffb070", keyIntensity: 0, shadowDarkness: 1 },
  { name: "night", hour: 23, clear: "#0e1a1c", fillColor: "#5b6f9e", fillGround: "#1c2a26", fillIntensity: 0.34, keyColor: "#9fb4e8", keyIntensity: 0.18, shadowDarkness: 0.6 },
];

/** Palette in use: `DAY_KEYFRAMES`, or a story's live-edited copy. */
let active: readonly DayKeyframe[] = DAY_KEYFRAMES;

/** The palette `DayCycle` blends. */
export function dayPalette(): readonly DayKeyframe[] {
  return active;
}

/**
 * Swap the palette (the tuning story's live edits). No argument restores
 * `DAY_KEYFRAMES`; stage.ts does that for every other story.
 */
export function setDayPalette(palette: readonly DayKeyframe[] = DAY_KEYFRAMES): void {
  active = [...palette].sort((a, b) => a.hour - b.hour);
}
```

Prettier will reflow the long rows; run `npm run format` at the end of the task.

- [ ] **Step 3: Create `src/render/dayCycle.ts`**

```ts
/**
 * Day/night lighting: moves the scene's lights through the time of day.
 *
 * Each frame `update` reads the clock (core/daytime.ts, from
 * `state.elapsed`), blends the palette (dayTuning.ts) at that hour and
 * applies it to the lights scene.ts built: fill colour and strength, key
 * colour, strength and direction, shadow darkness and the clear colour.
 *
 * The key light is the sun from 05:00 to 21:00 and the moon otherwise. The
 * palette takes the key's intensity to 0 at both hand-overs (the "predawn"
 * and "blueHour" keyframes), so the jump in shadow direction never shows.
 *
 * Night lights (runway glow, windows, headlights…) are not here: SceneSync
 * fans `night` out to them (see `SceneSync.setNight`).
 */
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import {
  clockHours,
  moonArc,
  nightFactor,
  SHIFT_START_HOUR,
  sunArc,
  wrapHours,
  type SkyArc,
} from "../core/daytime";
import { dayPalette, type DayKeyframe } from "./dayTuning";
import { SUN_DIRECTION, SUN_DISTANCE } from "./scene";

/**
 * The noon sun's bearing and height, from scene.ts's `SUN_DIRECTION`, so
 * the sun at 13:00 shines exactly as it always has.
 */
const NOON_AZIMUTH = Math.atan2(-SUN_DIRECTION.z, -SUN_DIRECTION.x);
const NOON_ELEVATION = Math.asin(-SUN_DIRECTION.y);

/** How far the sun swings either side of its noon bearing, rise to set (radians). */
const AZIMUTH_SWING = 1.25;

/**
 * Lowest key-light elevation (radians, ≈ 25°). Lower, and shadows stretch
 * into long streaks that break the fixed shadow frustum (fitShadowsToWorld).
 */
const MIN_ELEVATION = 0.44;

/** Hours between which the key light is the sun; the moon otherwise. */
const SUN_FROM = 5;
const SUN_UNTIL = 21;

/**
 * Speed of the catch-up when the clock jumps (a new shift started after
 * dark goes back to 08:00): game hours per real second. 6 h/s crosses a
 * 02:00 → 08:00 dawn in one second.
 */
const FAST_FORWARD = 6;

/** Clock jumps smaller than this (hours) are ordinary frame ticks: no catch-up. */
const JUMP_HOURS = 0.25;

/** The lights a DayCycle drives (all from scene.ts's `createScene`). */
export interface DayCycleLights {
  scene: Scene;
  fill: HemisphericLight;
  key: DirectionalLight;
  shadows: ShadowGenerator;
}

/** A keyframe with its colours parsed once, not every frame. */
interface ParsedKeyframe {
  hour: number;
  clear: Color3;
  fillColor: Color3;
  fillGround: Color3;
  fillIntensity: number;
  keyColor: Color3;
  keyIntensity: number;
  shadowDarkness: number;
}

function parse(k: DayKeyframe): ParsedKeyframe {
  return {
    hour: k.hour,
    clear: Color3.FromHexString(k.clear),
    fillColor: Color3.FromHexString(k.fillColor),
    fillGround: Color3.FromHexString(k.fillGround),
    fillIntensity: k.fillIntensity,
    keyColor: Color3.FromHexString(k.keyColor),
    keyIntensity: k.keyIntensity,
    shadowDarkness: k.shadowDarkness,
  };
}

export class DayCycle {
  /** Time of day shown now (hours, 0 ≤ h < 24), after any catch-up. */
  hours = SHIFT_START_HOUR;
  /** How dark it is: 0 day … 1 night (core/daytime.ts `nightFactor`). */
  night = 0;
  /** Clear colour as "#rrggbb" (main.ts mirrors it onto the page body). */
  clearColor = "";

  /** Parsed copy of the palette, rebuilt when the palette object changes. */
  private source: readonly DayKeyframe[] | null = null;
  private frames: ParsedKeyframe[] = [];
  private readonly clear = new Color3();

  constructor(private readonly lights: DayCycleLights) {
    this.apply();
  }

  /**
   * Follow the shift clock. `dt` is real frame time: a jump in the clock
   * (new shift after dark) is caught up at `FAST_FORWARD` along the
   * shorter way round, so 02:00 → 08:00 plays a quick dawn instead of
   * snapping.
   */
  update(elapsed: number, dt: number): void {
    const target = clockHours(elapsed);
    const delta = wrapHours(target - this.hours);
    if (Math.abs(delta) <= JUMP_HOURS) {
      this.hours = target;
    } else {
      const step = Math.min(Math.abs(delta), FAST_FORWARD * dt);
      this.hours = (((this.hours + Math.sign(delta) * step) % 24) + 24) % 24;
    }
    this.apply();
  }

  /** Jump straight to `hours` (tuning story). */
  setHours(hours: number): void {
    this.hours = ((hours % 24) + 24) % 24;
    this.apply();
  }

  /** Light the scene for `this.hours`. */
  private apply(): void {
    const { scene, fill, key, shadows } = this.lights;
    const h = this.hours;
    this.night = nightFactor(h);

    // Neighbouring keyframes and how far between them we are.
    const frames = this.parsed();
    let prev = frames[frames.length - 1]!;
    let next = frames[0]!;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i]!.hour <= h) {
        prev = frames[i]!;
        next = frames[(i + 1) % frames.length]!;
      }
    }
    const span = (next.hour - prev.hour + 24) % 24 || 24;
    const t = ((h - prev.hour + 24) % 24) / span;
    const mix = (a: number, b: number) => a + (b - a) * t;

    Color3.LerpToRef(prev.clear, next.clear, t, this.clear);
    scene.clearColor.set(this.clear.r, this.clear.g, this.clear.b, 1);
    this.clearColor = this.clear.toHexString();
    Color3.LerpToRef(prev.fillColor, next.fillColor, t, fill.diffuse);
    Color3.LerpToRef(prev.fillGround, next.fillGround, t, fill.groundColor);
    fill.intensity = mix(prev.fillIntensity, next.fillIntensity);
    Color3.LerpToRef(prev.keyColor, next.keyColor, t, key.diffuse);
    key.intensity = mix(prev.keyIntensity, next.keyIntensity);
    shadows.darkness = mix(prev.shadowDarkness, next.shadowDarkness);

    // Key direction: along the sun's (or moon's) arc, never lower than
    // MIN_ELEVATION. The light sits back along its ray, like scene.ts.
    const arc: SkyArc = h >= SUN_FROM && h < SUN_UNTIL ? sunArc(h) : moonArc(h);
    const elevation = Math.max(MIN_ELEVATION, NOON_ELEVATION * arc.height);
    const azimuth = NOON_AZIMUTH + arc.sweep * AZIMUTH_SWING;
    const c = Math.cos(elevation);
    key.direction.set(-c * Math.cos(azimuth), -Math.sin(elevation), -c * Math.sin(azimuth));
    key.direction.scaleToRef(-SUN_DISTANCE, key.position);
  }

  private parsed(): ParsedKeyframe[] {
    const palette = dayPalette();
    if (palette !== this.source) {
      this.source = palette;
      this.frames = [...palette].sort((a, b) => a.hour - b.hour).map(parse);
    }
    return this.frames;
  }
}
```

Check the noon identity mentally. At 13:00, `sweep = 0` and `height = 1`, so `elevation = NOON_ELEVATION` and `azimuth = NOON_AZIMUTH`. Then `direction = (-cos(el)cos(az), -sin(el), -cos(el)sin(az))`, which reproduces `SUN_DIRECTION`. That works because `NOON_AZIMUTH = atan2(-dir.z, -dir.x)` and `NOON_ELEVATION = asin(-dir.y)` for a normalized `dir`.

- [ ] **Step 4: Typecheck + lint + format**

Run: `npm run format && npm run typecheck && npm run lint`
Expected: all exit 0.

- [ ] **Step 5: Leave uncommitted.**

---

### Task 3: Wire `DayCycle` into the game and the Storybook stage

**Files:**
- Modify: `src/main.ts` (≈ lines 30–40 setup; the render loop ≈ 264–302; the dev handle ≈ 306)
- Modify: `src/render/stories/stage.ts`
- Modify: `src/style.css` (comment on line 10)

**Interfaces:**
- Consumes: `DayCycle` (Task 2), `SceneContext.fill` / `.key`, `setDayPalette`.
- Produces: `Stage` gains `fill: HemisphericLight; key: DirectionalLight`. `window.__game.dayCycle` exists in dev.

- [ ] **Step 1: `main.ts`: create the cycle**

Change `const { engine, scene, shadows } = createScene(canvas);` to:

```ts
const { engine, scene, shadows, fill, key } = createScene(canvas);
```

After `const sceneSync = new SceneSync(…);` add:

```ts
// Time of day: moves the sun/moon, sky fill and shadows through the shift
// (render/dayCycle.ts); the same `night` value drives the night lights,
// the music and ambience, and the HUD clock (render loop below).
const dayCycle = new DayCycle({ scene, fill, key, shadows });
/** Page background last written (mirrors the scene clear colour). */
let bodyColor = "";
```

Add the import `import { DayCycle } from "./render/dayCycle";` next to the other `./render/*` imports.

- [ ] **Step 2: `main.ts`: per-frame update**

In `engine.runRenderLoop`, directly before `sceneSync.setHighlighted(pointer.refreshHover());`, insert:

```ts
  // Time of day follows the sim clock (frozen while paused or after a
  // crash); `dt` is real time so a new shift's catch-up still plays.
  dayCycle.update(state.elapsed, dt);
  // The page behind the canvas matches the edge-of-map colour at any hour.
  if (dayCycle.clearColor !== bodyColor) {
    bodyColor = dayCycle.clearColor;
    document.body.style.backgroundColor = bodyColor;
  }
```

- [ ] **Step 3: `main.ts`: debug handle**

Change the dev-only handle to include the cycle:

```ts
  (window as unknown as { __game: unknown }).__game = {
    state,
    cameraController,
    audio,
    sceneSync,
    dayCycle,
  };
```

(Keep the existing fields exactly; only add `dayCycle`.)

- [ ] **Step 4: `stage.ts`: expose the lights and reset the palette**

- Add to `interface Stage`, after `shadows`:

```ts
  /** Sky fill and key (sun) lights, for stories that run a DayCycle. */
  fill: HemisphericLight;
  key: DirectionalLight;
```

- Add the imports `import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";`, `import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";` and `import { setDayPalette } from "../dayTuning";`.
- In `mountStage`, right after `setFlightTuning();`, add:

```ts
  // Same for the time-of-day palette (Tuning/Time of day edits it live).
  setDayPalette();
```

- Change `const { engine, scene, shadows } = createScene(canvas);` to `const { engine, scene, shadows, fill, key } = createScene(canvas);`, and add `fill, key,` to the `stage` object literal.

- In `src/style.css` line 10, change the comment to: `/* edge-of-map grass at noon; main.ts retints it with the time of day */`.

- [ ] **Step 5: Verify in the game** (Review Focus 1 and 4)

Run `npm run typecheck && npm run lint` (expect exit 0). Then start `npm run dev` in the background and open `http://localhost:5173` with the Playwright MCP browser. Click START and run these checks with `browser_evaluate`:

1. `__game.dayCycle.hours` ≈ 8 and `__game.dayCycle.night === 0`. Take a screenshot: it looks like today's game.
2. `__game.state.elapsed = 220`, wait 1 s: hours ≈ 19.0 (dusk), with a warm light in the screenshot.
3. `__game.state.elapsed = 300`, wait 1 s: `night === 1`, with a deep-blue scene in the screenshot.
4. **Pause (Review Focus 4):** press P, read `hours`, wait 3 s, read again: unchanged. Press P again: it advances.
5. **New shift after dark (Review Focus 1):** set `__game.state.elapsed = 360` (02:00) and wait 1 s. Then set `__game.state.elapsed = 0` (as a new shift does) and sample `__game.dayCycle.hours` every 100 ms for 2 s. Expected: it rises 2 → 8 within ≈1 s through dawn, never jumps straight to 8, and never goes down through 1, 0, 23….
6. Screenshot check: the shadow direction doesn't jump at 21:00 or 05:00. Set `elapsed` to 259, 260 and 261 (20:57–21:03) and compare screenshots: the shadows are faint to invisible there.

- [ ] **Step 6: Leave uncommitted.** Keep the dev server running for the next tasks, or stop it (it must be stopped by Task 13).

---

### Task 4: "Tuning/Time of day" story

**Files:**
- Create: `src/render/stories/dayCycle.stories.ts`

**Interfaces:**
- Consumes: `mountStage`, `gameCamera`, `Stage` (stage.ts); `DayCycle`; `DAY_KEYFRAMES`, `setDayPalette`, `DayKeyframe`; `SceneSync`, `MeshFactory`; `createGameState`; `startGame`, `step` (core/simulation).
- Produces: story ids `tuning-time-of-day--cycle` and `tuning-time-of-day--<keyframe>` (e.g. `--dawn`, `--night`). Task 5 adds one line (`sync.setNight(day.night)`) to `frameWith` below.

- [ ] **Step 1: Create the story file**

```ts
/**
 * Time of day (render/dayCycle.ts, palette in render/dayTuning.ts) on the
 * real game scene: airport, village, roads with cars, the river with boats
 * and live traffic, lit for any hour.
 *
 * - "Cycle" plays the day at `hoursPerSecond` from `startHour` (untick
 *   `play` to hold an hour).
 * - One story per keyframe ("Dawn", "Night"…) holds that keyframe's hour
 *   with a control for every value. The panel shows the whole palette with
 *   your edits: copy it and paste it over `DAY_KEYFRAMES` in dayTuning.ts.
 *
 * Night lights, music and HUD follow `night` in the game; here the scene's
 * night lights follow it too (via SceneSync.setNight).
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { startGame, step } from "../../core/simulation";
import { createGameState } from "../../core/state";
import type { GameState } from "../../core/types";
import { DayCycle } from "../dayCycle";
import { DAY_KEYFRAMES, setDayPalette, type DayKeyframe } from "../dayTuning";
import { MeshFactory } from "../meshes";
import { SceneSync } from "../sceneSync";
import { gameCamera, mountStage, type Stage } from "./stage";

/** Live traffic that never stops: a crash just starts a new shift. */
function keepFlying(state: GameState, dt: number): void {
  step(state, dt);
  if (state.phase === "gameover") startGame(state);
}

/**
 * Build the scene and return a frame function that lights it for the hour
 * `hourAt(time)` returns.
 */
function frameWith(stage: Stage, hourAt: (time: number) => number) {
  const cam = gameCamera(stage);
  const state = createGameState(stage.aspect());
  const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
  sync.rebuildWorld(state);
  startGame(state);
  const day = new DayCycle(stage);
  return (dt: number, time: number) => {
    keepFlying(state, dt);
    day.setHours(hourAt(time));
    cam.frame(dt, time);
    sync.syncPlanes(state, time);
  };
}

/** Small top-left readout of the hour shown. */
function hourBadge(stage: Stage): (hours: number) => void {
  const el = document.createElement("div");
  el.className =
    "pointer-events-none absolute top-4 left-4 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1 font-mono text-sm text-slate-200";
  stage.root.append(el);
  return (h) => {
    const m = Math.floor(h * 60) % 1440;
    el.textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
}

const meta: Meta = { title: "Tuning/Time of day" };
export default meta;

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

interface CycleArgs {
  /** Hour the story opens at. */
  startHour: number;
  /** Advance the clock (off: hold `startHour`). */
  play: boolean;
  /** Game hours per real second (the game runs at 0.05: 20 s per hour). */
  hoursPerSecond: number;
}

export const Cycle: StoryObj<CycleArgs> = {
  argTypes: {
    startHour: { control: { type: "range", min: 0, max: 23.75, step: 0.25 } },
    hoursPerSecond: { control: { type: "range", min: 0.05, max: 3, step: 0.05 } },
  },
  args: { startHour: 17, play: true, hoursPerSecond: 0.5 },
  render: (args) =>
    mountStage((stage) => {
      const show = hourBadge(stage);
      const hourAt = (time: number) =>
        (args.startHour + (args.play ? time * args.hoursPerSecond : 0)) % 24;
      const frame = frameWith(stage, hourAt);
      return (dt, time) => {
        frame(dt, time);
        show(hourAt(time));
      };
    }),
};

// ---------------------------------------------------------------------------
// One story per keyframe
// ---------------------------------------------------------------------------

type KeyframeArgs = Omit<DayKeyframe, "name" | "hour">;

/** A keyframe as source, one line, in dayTuning.ts's style. */
function keyframeSource(k: DayKeyframe): string {
  const fields = Object.entries(k).map(([f, v]) => `${f}: ${JSON.stringify(v)}`);
  return `  { ${fields.join(", ")} },`;
}

/** Top-right panel: the whole palette as source, with a copy button. */
function snippetPanel(stage: Stage, palette: readonly DayKeyframe[]): void {
  const snippet = `export const DAY_KEYFRAMES: readonly DayKeyframe[] = [\n${palette
    .map(keyframeSource)
    .join("\n")}\n];`;
  const panel = document.createElement("div");
  panel.className =
    "absolute top-4 right-4 max-h-[80%] w-[34rem] overflow-auto rounded-xl border border-slate-700 bg-slate-900/90 p-3 text-xs text-slate-200 shadow-lg";
  const note = document.createElement("p");
  note.className = "mb-2 text-slate-400";
  note.textContent = "Paste over DAY_KEYFRAMES in src/render/dayTuning.ts.";
  const copy = document.createElement("button");
  copy.className = "hud-button mb-2 w-auto px-3 text-xs";
  copy.textContent = "Copy palette";
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(snippet).then(
      () => (copy.textContent = "Copied"),
      () => (copy.textContent = "Copy failed: select the text"),
    );
  });
  const pre = document.createElement("pre");
  pre.className = "font-mono whitespace-pre select-text";
  pre.textContent = snippet;
  panel.append(note, copy, pre);
  stage.root.append(panel);
}

/** Colour controls only accept full "#rrggbb"; keep the original otherwise. */
function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function keyframeStory(name: string): StoryObj<KeyframeArgs> {
  const base = DAY_KEYFRAMES.find((k) => k.name === name)!;
  // Explicit copy (noUnusedLocals rules out destructuring name/hour away).
  const values: KeyframeArgs = {
    clear: base.clear,
    fillColor: base.fillColor,
    fillGround: base.fillGround,
    fillIntensity: base.fillIntensity,
    keyColor: base.keyColor,
    keyIntensity: base.keyIntensity,
    shadowDarkness: base.shadowDarkness,
  };
  const colour = { control: "color" } as const;
  const unit = { control: { type: "range", min: 0, max: 1, step: 0.01 } } as const;
  return {
    name: `${name} (${base.hour}:00)`,
    argTypes: {
      clear: colour,
      fillColor: colour,
      fillGround: colour,
      keyColor: colour,
      fillIntensity: unit,
      keyIntensity: unit,
      shadowDarkness: unit,
    },
    args: values,
    render: (args) =>
      mountStage((stage) => {
        const edited: DayKeyframe = {
          ...args,
          name,
          hour: base.hour,
          clear: hexOr(args.clear, base.clear),
          fillColor: hexOr(args.fillColor, base.fillColor),
          fillGround: hexOr(args.fillGround, base.fillGround),
          keyColor: hexOr(args.keyColor, base.keyColor),
        };
        const palette = DAY_KEYFRAMES.map((k) => (k.name === name ? edited : k));
        // After mountStage's own reset (it runs before `build`).
        setDayPalette(palette);
        snippetPanel(stage, palette);
        hourBadge(stage)(base.hour);
        return frameWith(stage, () => base.hour);
      }),
  };
}

export const LateNight = keyframeStory("lateNight");
export const Predawn = keyframeStory("predawn");
export const Dawn = keyframeStory("dawn");
export const Morning = keyframeStory("morning");
export const Noon = keyframeStory("noon");
export const Afternoon = keyframeStory("afternoon");
export const Dusk = keyframeStory("dusk");
export const BlueHour = keyframeStory("blueHour");
export const Night = keyframeStory("night");
```

Note: `new DayCycle(stage)` works because `Stage` has `scene`, `fill`, `key` and `shadows` (Task 3), which structurally satisfy `DayCycleLights`.

- [ ] **Step 2: Typecheck, lint, format**

Run: `npm run format && npm run typecheck && npm run lint`
Expected: exit 0.

- [ ] **Step 3: Render the stories**

Start `npm run storybook` (port 6006) in the background. With the Playwright MCP browser, open each of:
- `iframe.html?id=tuning-time-of-day--cycle`
- `--late-night`, `--predawn`, `--dawn`, `--morning`, `--noon`, `--afternoon`, `--dusk`, `--blue-hour`, `--night`

For each, wait 2 s, then check `browser_console_messages`: no errors. Screenshot `--noon` and `--night`: noon matches the game's day look, night is deep blue (not black) with planes still clearly coloured. In `--dawn`, change `keyColor` in the Controls panel: the light changes live and the snippet updates.

- [ ] **Step 4: Leave uncommitted.**

---

## Phase 2: night lights

### Task 5: Shared glow, night-light helpers, readability floor, `SceneSync.setNight`

**Files:**
- Create: `src/render/glow.ts`
- Create: `src/render/nightLights.ts`
- Modify: `src/render/meshes.ts` (constructor glow; `material()`; `disposeAircraft`; new `setNight`)
- Modify: `src/render/sceneSync.ts` (field `night`, method `setNight`)
- Modify: `src/main.ts` (call `sceneSync.setNight`)
- Modify: `src/render/stories/dayCycle.stories.ts` (one line)

**Interfaces:**
- Produces:
  - `glow.ts`: `class SceneGlow { static for(scene: Scene): SceneGlow; add(mesh: Mesh, nightOnly?: boolean): void; remove(mesh: Mesh): void; setNight(n: number): void; readonly layer: GlowLayer }`
  - `nightLights.ts`: `lampMaterial(name: string, hex: string, scene: Scene): StandardMaterial`, `poolMaterial(name: string, hex: string, scene: Scene): StandardMaterial`, `setNightLevel(mat: StandardMaterial, level: number): void`, `createPoolMesh(name: string, scene: Scene): Mesh`, `litNow(mat: StandardMaterial): boolean`
  - `MeshFactory.setNight(n: number): void`
  - `SceneSync.setNight(n: number): void` (Tasks 6–10 add lines to it)

- [ ] **Step 1: Create `src/render/glow.ts`**

```ts
/**
 * The scene's one glow layer: soft halos round small bright lights.
 *
 * Aircraft lights (nav, strobe, beacon) glow at any hour. Scenery lights
 * (runway and taxi lights, lamps, headlights, lanterns) are added as
 * "night-only": their halo is scaled by `night`, so by day they look
 * exactly as they always have and after dark they bloom. One layer keeps
 * it to a single extra render pass however many lights there are.
 *
 * Shared per scene (`SceneGlow.for`), so any renderer can add its lights
 * without the layer being passed around.
 */
import "@babylonjs/core/Layers/effectLayerSceneComponent"; // side effect: effect layer rendering
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** Halo strength by day, and how much more it gets at full night. */
const DAY_INTENSITY = 1.1;
const NIGHT_BOOST = 0.5;

const glows = new WeakMap<Scene, SceneGlow>();

export class SceneGlow {
  readonly layer: GlowLayer;
  private night = 0;
  /** `uniqueId`s of meshes whose halo scales with `night`. */
  private readonly nightOnly = new Set<number>();

  private constructor(scene: Scene) {
    // Exclude by default: with an empty include list (no planes yet) the
    // layer would otherwise make every emissive surface glow.
    this.layer = new GlowLayer("lights-glow", scene, {
      mainTextureRatio: 0.5,
      blurKernelSize: 24,
      excludeByDefault: true,
    });
    this.layer.intensity = DAY_INTENSITY;
    // The layer's default is emissive × alpha; night-only lights also
    // scale by `night`.
    this.layer.customEmissiveColorSelector = (mesh, _subMesh, material, result) => {
      const e = (material as StandardMaterial).emissiveColor;
      if (!e) {
        result.set(0, 0, 0, material.alpha);
        return;
      }
      const k = this.nightOnly.has(mesh.uniqueId) ? this.night : 1;
      result.set(e.r * k, e.g * k, e.b * k, material.alpha);
    };
  }

  /** The glow for `scene`, created on first use. */
  static for(scene: Scene): SceneGlow {
    let glow = glows.get(scene);
    if (!glow) {
      glow = new SceneGlow(scene);
      glows.set(scene, glow);
    }
    return glow;
  }

  /**
   * Give `mesh` a halo; `nightOnly` scales it by `night`. The mesh is
   * dropped from the layer when it's disposed (the layer keeps ids of
   * included meshes and wouldn't drop them itself).
   */
  add(mesh: Mesh, nightOnly = false): void {
    this.layer.addIncludedOnlyMesh(mesh);
    if (nightOnly) this.nightOnly.add(mesh.uniqueId);
    mesh.onDisposeObservable.addOnce(() => this.remove(mesh));
  }

  remove(mesh: Mesh): void {
    this.layer.removeIncludedOnlyMesh(mesh);
    this.nightOnly.delete(mesh.uniqueId);
  }

  /** 0 day … 1 night: night-only halos fade in, every halo gets a bit stronger. */
  setNight(n: number): void {
    this.night = n;
    this.layer.intensity = DAY_INTENSITY + NIGHT_BOOST * n;
  }
}
```

- [ ] **Step 2: Create `src/render/nightLights.ts`**

```ts
/**
 * Building blocks for fake night lights. Real Babylon lights are out:
 * StandardMaterial lights at most 4 per mesh by default and dozens of point
 * lights would cost the frame rate. Instead:
 *
 * - lamps: small unlit emissive meshes (bulbs, windows, lanterns), faded
 *   in with the material's alpha;
 * - pools: flat additive discs lying on the ground, bright in the middle
 *   and fading to nothing at the rim, which read as light cast on the
 *   ground (floodlights, headlight beams, street-lamp pools).
 *
 * Both are driven by one number, `setNightLevel(material, level)`. At 0
 * every mesh using the material is hidden, so the day costs nothing.
 */
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

/** Segments round a light pool's rim. */
const POOL_SEGMENTS = 20;

/** Unlit bulb / window / lantern in `hex`; off (alpha 0) until night. */
export function lampMaterial(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.FromHexString(hex);
  mat.alpha = 0;
  return mat;
}

/** Additive light cast on the ground, in `hex`; off until night. */
export function poolMaterial(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.FromHexString(hex);
  mat.alphaMode = Constants.ALPHA_ADD;
  // Pools overlap each other and the paint: never hide what's under them.
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.alpha = 0;
  return mat;
}

/**
 * Fade a lamp or pool material to `level` (0 off … 1 full). Meshes using it
 * are shown or hidden only when it crosses 0, so this is cheap every frame.
 */
export function setNightLevel(mat: StandardMaterial, level: number): void {
  const wasOn = mat.alpha > 0;
  mat.alpha = Math.max(0, Math.min(1, level));
  const on = mat.alpha > 0;
  if (on !== wasOn) for (const mesh of mat.getBindedMeshes()) mesh.isVisible = on;
}

/**
 * Is `mat` lit right now? For meshes built after the last `setNightLevel`
 * (a runway opened at night, a boat launched at night): set
 * `mesh.isVisible = litNow(mat)` so they don't wait for the next change.
 */
export function litNow(mat: StandardMaterial): boolean {
  return mat.alpha > 0;
}

/**
 * Unit light pool: a flat disc of radius 1 on y = 0, opaque in the middle,
 * fading to transparent at the rim (vertex alpha). Scale and place it with
 * the mesh transform or thin-instance matrices.
 */
export function createPoolMesh(name: string, scene: Scene): Mesh {
  const positions = [0, 0, 0];
  const colors = [1, 1, 1, 1];
  const normals = [0, 1, 0];
  const indices: number[] = [];
  for (let i = 0; i < POOL_SEGMENTS; i++) {
    const a = (i / POOL_SEGMENTS) * Math.PI * 2;
    positions.push(Math.cos(a), 0, Math.sin(a));
    colors.push(1, 1, 1, 0);
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < POOL_SEGMENTS; i++) {
    indices.push(0, 1 + ((i + 1) % POOL_SEGMENTS), 1 + i);
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.normals = normals;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  return mesh;
}
```

- [ ] **Step 3: `meshes.ts`: use `SceneGlow` and add the readability floor**

In `src/render/meshes.ts`:

1. Remove the imports of `effectLayerSceneComponent` and `GlowLayer`, and add `import { SceneGlow } from "./glow";`.
2. Change the field `private readonly glow: GlowLayer;` to:

```ts
  /** The scene's shared glow (render/glow.ts): halos round the aircraft lights. */
  private readonly glow: SceneGlow;
  /** 0 day … 1 night (see `setNight`). */
  private night = 0;
```

3. Replace the whole block from `// Exclude by default: …` to `this.glow.intensity = 1.1;` with:

```ts
    this.glow = SceneGlow.for(scene);
```

4. In `createAircraft`, change `for (const mesh of rig.lights) this.glow.addIncludedOnlyMesh(mesh);` to `for (const mesh of rig.lights) this.glow.add(mesh);`.
5. Replace `disposeAircraft`'s body with:

```ts
    // Children (and their glow entries, see SceneGlow.add) go with the root.
    rig.root.dispose();
```

6. In `material()`, inside `if (!mat) { … }`, after `this.colorMaterials.set(color, mat);`, add `this.tintColor(color, mat);`.
7. Add these constants above the class:

```ts
/**
 * Readability floor at night (see `MeshFactory.setNight`): self-light on
 * the aircraft livery (grey, multiplied by the vertex colours, so hues
 * stay saturated) and on the shared runway/plane colour materials.
 */
const LIVERY_GLOW_DAY = 0.08;
const LIVERY_GLOW_NIGHT = 0.45;
const COLOR_GLOW_DAY = 0.35;
const COLOR_GLOW_NIGHT = 0.7;
```

8. Change `makeMaterial`'s call in `material()` to pass `COLOR_GLOW_DAY` instead of the literal `0.35`.
9. Add these methods to the class, after `disposeAircraft`:

```ts
  /**
   * 0 day … 1 night. Brightens the glow and raises the self-light of the
   * liveries and the runway colours, so red, blue, yellow and violet read
   * as clearly at night as by day. Paths and rings are unlit already.
   */
  setNight(n: number): void {
    this.night = n;
    this.glow.setNight(n);
    const livery = LIVERY_GLOW_DAY + (LIVERY_GLOW_NIGHT - LIVERY_GLOW_DAY) * n;
    // `paint` is typed as Material in AircraftMaterials; it's the StandardMaterial built in makeAircraftMaterials.
    (this.aircraftMaterials.paint as StandardMaterial).emissiveColor.set(livery, livery, livery);
    for (const [color, mat] of this.colorMaterials) this.tintColor(color, mat);
  }

  /** Colour material self-light for the current `night`. */
  private tintColor(color: PlaneColor, mat: StandardMaterial): void {
    const glow = COLOR_GLOW_DAY + (COLOR_GLOW_NIGHT - COLOR_GLOW_DAY) * this.night;
    Color3.FromHexString(COLOR_HEX[color]).scaleToRef(glow, mat.emissiveColor);
  }
```

10. Update the header comment's first line to: `… the red "no landing" ring and X (runways live in runway.ts). Aircraft lights glow through the scene's shared glow (glow.ts).`

- [ ] **Step 4: `sceneSync.ts`: `setNight`**

Add a field after `private readonly scratch = new Vector3();`:

```ts
  /** 0 day … 1 night (see `setNight`). */
  private night = 0;
```

Add a method after `setHighlighted`:

```ts
  /**
   * How dark it is, 0 day … 1 night (render/dayCycle.ts): passed on to
   * everything with night lights. Cheap to call every frame: nothing
   * happens unless it changed.
   */
  setNight(n: number): void {
    if (n === this.night) return;
    this.night = n;
    this.factory.setNight(n);
  }
```

- [ ] **Step 5: Wire it**

- In `src/main.ts`, directly after the `bodyColor` block added in Task 3, insert `sceneSync.setNight(dayCycle.night);`.
- In `src/render/stories/dayCycle.stories.ts`, in `frameWith`'s returned function, after `day.setHours(hourAt(time));`, insert `sync.setNight(day.night);`.

- [ ] **Step 6: Typecheck, lint, format**

Run: `npm run format && npm run typecheck && npm run lint`
Expected: exit 0.

- [ ] **Step 7: Verify** (Review Focus 5)

- Storybook: open `iframe.html?id=scene-gameplay--landing` and `iframe.html?id=aircraft--…`. To get the exact aircraft id, run `curl -s localhost:6006/index.json | grep -o '"id":"[^"]*aircraft[^"]*"' | head`. Expected: no console errors, and nav/strobe halos exactly as before.
- `tuning-time-of-day--night`: plane liveries are clearly red/blue/yellow on the blue scene. Screenshot it.
- Game: `__game.state.elapsed = 300` makes plane liveries visibly self-lit.

- [ ] **Step 8: Leave uncommitted.**

---

### Task 6: Airport lights: runway/taxi/bridge/beacon glow, stand floodlights, warm glass

**Files:**
- Modify: `src/render/runway.ts` (`create`, after `const approach = …`)
- Modify: `src/render/airfield.ts` (constructor, `create`, new `setNight`)
- Modify: `src/render/bridges.ts` (barrier light creation ≈ line 252)
- Modify: `src/render/airportGrounds.ts` (tower beacon; glass; new `setNight`)
- Modify: `src/render/landscape.ts` (new `setNight`, `night` field)
- Modify: `src/render/sceneSync.ts` (`setNight` fan-out)

**Interfaces:**
- Consumes: `SceneGlow` (Task 5), `poolMaterial`, `createPoolMesh`, `setNightLevel`, `litNow`.
- Produces: `AirfieldFactory.setNight(n)`, `AirportGroundsFactory.setNight(n)`, `Landscape.setNight(n)` (Tasks 7–9 add lines to it).

- [ ] **Step 1: Runway lights glow at night**

In `runway.ts` `create()`, after `const approach = this.buildApproachLights(runway.color, L, W);`, add:

```ts
    // After dark the edge and approach lights bloom (render/glow.ts).
    const glow = SceneGlow.for(this.scene);
    glow.add(edgeLights, true);
    for (const light of approach) glow.add(light, true);
```

Add `import { SceneGlow } from "./glow";`. Update the header comment's lights sentence to mention that they bloom at night.

- [ ] **Step 2: Taxi lights glow + stand floodlight pools**

In `airfield.ts`:
- Imports: `import { SceneGlow } from "./glow";` and `import { createPoolMesh, litNow, poolMaterial, setNightLevel } from "./nightLights";`, plus `Matrix`, `Quaternion` and `Vector3` from `@babylonjs/core/Maths/math.vector` if they aren't already imported.
- Constants, after `LIGHT_Y`:

```ts
/** Floodlight pools on the stands at night: height (above the paint) and radius. */
const FLOOD_Y = PAINT_Y + 0.01;
const FLOOD_RADIUS = 2.4;
/** How bright a floodlight pool gets at full night (its material alpha). */
const FLOOD_STRENGTH = 0.45;
```

- Field + constructor line:

```ts
  /** Warm apron floodlight pools (render/nightLights.ts), lit at night. */
  private readonly flood: StandardMaterial;
```

and in the constructor: `this.flood = poolMaterial("standFlood", "#ffe2a8", scene);`.

- In `create`, inside the `for (const line of [taxiLine, connectorLine])` loop, change `if (lights) nodes.push(lights);` to:

```ts
      if (lights) {
        SceneGlow.for(this.scene).add(lights, true);
        nodes.push(lights);
      }
```

- In `create`, after the `for (const node of nodes) { … receiveShadows … }` loop and before the hangars line, add:

```ts
    // Apron floodlights: a pool of light on each stand after dark.
    const pools = createPoolMesh("standFlood", this.scene);
    pools.material = this.flood;
    const m = new Matrix();
    const scale = new Vector3(FLOOD_RADIUS, 1, FLOOD_RADIUS);
    const at = new Vector3();
    const matrices = new Float32Array(airfield.stands.length * 16);
    airfield.stands.forEach((stand, i) => {
      toScene(stand.pos, world, FLOOD_Y, at);
      Matrix.ComposeToRef(scale, Quaternion.Identity(), at, m);
      m.copyToArray(matrices, i * 16);
    });
    pools.thinInstanceSetBuffer("matrix", matrices, 16, true);
    pools.thinInstanceRefreshBoundingInfo(false);
    // Built at night (a runway opening after dark): lit straight away.
    pools.isVisible = litNow(this.flood);
    nodes.push(pools);
```

Also add `import "@babylonjs/core/Meshes/thinInstanceMesh";` if the file doesn't import it yet. Check with `grep -n thinInstanceMesh src/render/airfield.ts`.

- Method on `AirfieldFactory`:

```ts
  /** 0 day … 1 night: the stand floodlights fade in. */
  setNight(n: number): void {
    setNightLevel(this.flood, n * FLOOD_STRENGTH);
  }
```

- [ ] **Step 3: Bridge barrier lights and tower beacon glow**

- `bridges.ts`: after `lights.push(light);` add `SceneGlow.for(this.scene).add(light, true);` and import `SceneGlow`.
- `airportGrounds.ts` `tower()`: after the `const beacon = add(…)` statement, add `SceneGlow.for(this.scene).add(beacon, true);` and import `SceneGlow`.

- [ ] **Step 4: Warm lit glass at night**

In `airportGrounds.ts`, add constants near `BEACON_PERIOD`:

```ts
/** Tower cab and terminal glass: cool by day, warm lit interiors at night. */
const GLASS_DAY = new Color3(0.04, 0.1, 0.16);
const GLASS_NIGHT = new Color3(0.62, 0.46, 0.22);
```

- In the constructor, change `this.glass.emissiveColor = new Color3(0.04, 0.1, 0.16);` to `this.glass.emissiveColor = GLASS_DAY.clone();`.
- Add the method to `AirportGroundsFactory`:

```ts
  /** 0 day … 1 night: the tower cab and terminal light up from inside. */
  setNight(n: number): void {
    Color3.LerpToRef(GLASS_DAY, GLASS_NIGHT, n, this.glass.emissiveColor);
  }
```

- Header comment: add "; lit from inside at night" to the tower and terminal bullets.

- [ ] **Step 5: Landscape and SceneSync fan-out**

In `landscape.ts` add this method after `revealAirports` (the `night` field comes in Task 9, where `update` first reads it; `noUnusedLocals` would reject it earlier):

```ts
  /** 0 day … 1 night (SceneSync.setNight): passed on to the scenery. */
  setNight(n: number): void {
    this.airportFactory.setNight(n);
  }
```

In `sceneSync.ts` `setNight`, after `this.factory.setNight(n);` add:

```ts
    this.landscape.setNight(n);
    this.airfieldFactory.setNight(n);
```

- [ ] **Step 6: Typecheck, lint, format**

Run: `npm run format && npm run typecheck && npm run lint`
Expected: exit 0.

- [ ] **Step 7: Verify** (Review Focus 2: runway opened at night)

- `tuning-time-of-day--night`: runway edge and approach lights have halos, blue taxi lights glow, stands show warm pools, the tower cab and terminal glow warm, and the tower beacon has a halo. `--noon`: none of these (the runway lights look as before). No console errors.
- Game: START, then `__game.state.elapsed = 300`. Land planes (or set `__game.state.score` high enough to unlock blue: check `src/core/progression.ts` for the threshold). When the new runway reveals, its lights glow and its stand pools show immediately.

- [ ] **Step 8: Leave uncommitted.**

---

### Task 7: Village: lit windows, street lamps

**Files:**
- Modify: `src/render/countryside.ts` (`CountrysideView`, `CountrysideFactory.create`, `houses`, new `streetLamps`, `setNight`)
- Modify: `src/render/landscape.ts` (`setNight`; apply to a new view)

**Interfaces:**
- Consumes: `lampMaterial`, `poolMaterial`, `createPoolMesh`, `setNightLevel`, `litNow`, `SceneGlow`.
- Produces: `CountrysideFactory.setNight(n)`, `CountrysideView.setNight(n)`.

- [ ] **Step 1: Constants and imports**

In `countryside.ts`, import `VILLAGE_RADIUS` alongside `ROAD_WIDTH` from `../config`; import `SceneGlow` from `./glow`; and import `createPoolMesh, litNow, lampMaterial, poolMaterial, setNightLevel` from `./nightLights`. Add these constants after `HOUSE_SIZES`:

```ts
/** Window panes: dark glass when unlit, warm when someone's home. */
const WINDOW_DARK = Color3.FromHexString("#1a2230");
const WINDOW_LIT = Color3.FromHexString("#ffc86b");
/**
 * Each house switches its lights on at its own `night` level, from dusk
 * onwards; above 1 it stays dark all night (nobody home).
 */
const WINDOW_THRESHOLD_MIN = 0.08;
const WINDOW_THRESHOLD_RANGE = 1.05;

/** Street lamps along the village roads: spacing, bulb height, pool size. */
const LAMP_SPACING = 5;
const LAMP_HEIGHT = 1.25;
const LAMP_POOL_RADIUS = 1.6;
const LAMP_POOL_STRENGTH = 0.5;
```

- [ ] **Step 2: `CountrysideView` takes the windows**

Replace the `CountrysideView` class with:

```ts
/** Lit-window state for the village's thin-instanced panes. */
interface VillageWindows {
  mesh: Mesh;
  /** Per-instance "color" buffer (rgba), rewritten when lights change. */
  colors: Float32Array;
  /** Per-instance `night` level the pane lights up at. */
  thresholds: Float32Array;
}

/** Static countryside meshes, disposed together on a rebuild. */
export class CountrysideView {
  /** Last `night` step applied to the windows (-1 = none yet). */
  private windowStep = -1;

  constructor(
    private readonly meshes: Mesh[],
    private readonly windows: VillageWindows | null,
  ) {}

  /**
   * 0 day … 1 night: windows light up house by house. Recoloured only when
   * `n` moves a step (1/40), not every frame.
   */
  setNight(n: number): void {
    const w = this.windows;
    if (!w) return;
    w.mesh.isVisible = n > 0;
    const step = Math.round(n * 40);
    if (step === this.windowStep) return;
    this.windowStep = step;
    for (let i = 0; i < w.thresholds.length; i++) {
      const c = n > w.thresholds[i]! ? WINDOW_LIT : WINDOW_DARK;
      w.colors.set([c.r, c.g, c.b, 1], i * 4);
    }
    w.mesh.thinInstanceBufferUpdated("color");
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
  }
}
```

- [ ] **Step 3: Factory materials, windows and lamps**

Add fields to `CountrysideFactory`:

```ts
  /** Unlit panes (colour per instance), street-lamp bulbs and their pools. */
  private readonly windowMat: StandardMaterial;
  private readonly lampMat: StandardMaterial;
  private readonly lampPool: StandardMaterial;
  /** Current `night`, applied to views built later (see `create`). */
  private night = 0;
```

and in the constructor:

```ts
    this.windowMat = new StandardMaterial("villageWindows", scene);
    this.windowMat.disableLighting = true;
    this.windowMat.emissiveColor = Color3.White(); // × the instance colour
    this.lampMat = lampMaterial("streetLamp", "#ffe0a0", scene);
    this.lampPool = poolMaterial("streetLampPool", "#ffd890", scene);
```

- Change `houses()` to return windows too. Its signature becomes `private houses(houses: readonly House[], world: WorldSize): { meshes: Mesh[]; windows: VillageWindows | null }`. After the `for (const [mesh, mats, cols] of …)` loop inside `if (plain.length > 0)`, add:

```ts
      windows = this.windowPanes(plain, world);
      meshes.push(windows.mesh);
```

Declare `let windows: VillageWindows | null = null;` at the top of `houses()`, and return `{ meshes, windows }` at the end.

- Add the method:

```ts
  /**
   * Two panes per house (barns have none), each a thin box through the
   * house so it shows on both long walls: four windows. Hidden by day
   * (CountrysideView.setNight shows and colours them).
   */
  private windowPanes(houses: readonly House[], world: WorldSize): VillageWindows {
    const homes = houses.filter((h) => h.kind !== "barn");
    const mesh = CreateBox("villageWindows", { size: 1 }, this.scene);
    mesh.material = this.windowMat;
    mesh.isPickable = false;
    const matrices = new Float32Array(homes.length * 2 * 16);
    const colors = new Float32Array(homes.length * 2 * 4);
    const thresholds = new Float32Array(homes.length * 2);
    const rng = mulberry32(0x3d0ff);
    const m = new Matrix();
    const rot = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();
    homes.forEach((h, i) => {
      const size = HOUSE_SIZES[h.kind as Exclude<HouseKind, "church">];
      const d = headingVector(h.heading);
      Quaternion.RotationYawPitchRollToRef(headingToRotationY(h.heading), 0, 0, rot);
      scale.set(size.l * 0.18, size.h * 0.26, size.d + 0.04);
      const threshold = WINDOW_THRESHOLD_MIN + WINDOW_THRESHOLD_RANGE * rng();
      [-0.22, 0.22].forEach((along, k) => {
        const x = along * size.l;
        toScene({ x: h.pos.x + d.x * x, y: h.pos.y + d.y * x }, world, size.h * 0.55, pos);
        Matrix.ComposeToRef(scale, rot, pos, m);
        m.copyToArray(matrices, (i * 2 + k) * 16);
        thresholds[i * 2 + k] = threshold;
      });
    });
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.thinInstanceSetBuffer("color", colors, 4, false);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.isVisible = false;
    return { mesh, colors, thresholds };
  }

  /**
   * Street lamps every `LAMP_SPACING` along the roads within the village,
   * alternating sides: a bulb (glows at night) and a pool of light under
   * it. Both hidden by day.
   */
  private streetLamps(land: Countryside, world: WorldSize): Mesh[] {
    const village = land.village;
    if (!village) return [];
    const spots: Vec2[] = [];
    for (const road of land.roads) {
      let run = 0;
      let side = 1;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!;
        const b = road.points[i]!;
        run += Math.hypot(b.x - a.x, b.y - a.y);
        if (run < LAMP_SPACING) continue;
        run = 0;
        if (Math.hypot(b.x - village.x, b.y - village.y) > VILLAGE_RADIUS) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const off = (ROAD_WIDTH / 2 + 0.4) * side;
        spots.push({ x: b.x - ((b.y - a.y) / len) * off, y: b.y + ((b.x - a.x) / len) * off });
        side = -side;
      }
    }
    if (spots.length === 0) return [];
    const bulb = CreateBox("streetLampBulb", { size: 0.22 }, this.scene);
    bulb.material = this.lampMat;
    const pool = createPoolMesh("streetLampPool", this.scene);
    pool.material = this.lampPool;
    const bulbM = new Float32Array(spots.length * 16);
    const poolM = new Float32Array(spots.length * 16);
    const m = new Matrix();
    const pos = new Vector3();
    const one = Vector3.One();
    const poolScale = new Vector3(LAMP_POOL_RADIUS, 1, LAMP_POOL_RADIUS);
    spots.forEach((p, i) => {
      toScene(p, world, LAMP_HEIGHT, pos);
      Matrix.ComposeToRef(one, Quaternion.Identity(), pos, m);
      m.copyToArray(bulbM, i * 16);
      pos.y = ROAD_PAINT_Y + 0.006;
      Matrix.ComposeToRef(poolScale, Quaternion.Identity(), pos, m);
      m.copyToArray(poolM, i * 16);
    });
    for (const [mesh, mats, mat] of [
      [bulb, bulbM, this.lampMat],
      [pool, poolM, this.lampPool],
    ] as const) {
      mesh.thinInstanceSetBuffer("matrix", mats, 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.isPickable = false;
      mesh.isVisible = litNow(mat);
    }
    SceneGlow.for(this.scene).add(bulb, true);
    return [bulb, pool];
  }

  /** 0 day … 1 night: lamps fade in (windows are per view, see CountrysideView). */
  setNight(n: number): void {
    this.night = n;
    setNightLevel(this.lampMat, n);
    setNightLevel(this.lampPool, n * LAMP_POOL_STRENGTH);
  }
```

Make sure `Countryside`, `House`, `HouseKind` and `Vec2` are imported types (they are used already; add `Vec2` from `../core/types` if missing). `headingVector` and `mulberry32` are already imported from `../core/math`.

- In `create()`, replace `meshes.push(...this.houses(land.houses, world));` and the `return` with:

```ts
    const village = this.houses(land.houses, world);
    meshes.push(...village.meshes, ...this.streetLamps(land, world));
    for (const mesh of meshes) mesh.isPickable = false;
    const view = new CountrysideView(meshes, village.windows);
    // Built at night: windows lit straight away.
    view.setNight(this.night);
    return view;
```

(Remove the old `for (const mesh of meshes) mesh.isPickable = false;` line, since it's now inside the replacement.)

- Header comment: add a bullet: `- night:   lit windows (house by house from dusk), street lamps with pools of light (see nightLights.ts).`

- [ ] **Step 4: Landscape fan-out**

In `landscape.ts` `setNight`, add:

```ts
    this.countrysideFactory.setNight(n);
    this.countryside?.setNight(n);
```

- [ ] **Step 5: Typecheck, lint, format**

Run: `npm run format && npm run typecheck && npm run lint`
Expected: exit 0.

- [ ] **Step 6: Verify**

- `tuning-time-of-day--cycle` (startHour 18, hoursPerSecond 0.5): windows come on house by house from about 19:00, a few stay dark, and street lamps with pools appear. At 07:00 they go off.
- `scene-countryside--…` stories (get the ids from `index.json`): identical to before, with no windows in daylight and no console errors.

- [ ] **Step 7: Leave uncommitted.**

---

### Task 8: Cars: head/tail lights, road beams

**Files:**
- Modify: `src/render/cars.ts` (`CarFleet`)
- Modify: `src/render/landscape.ts` (`setNight`)

**Interfaces:**
- Consumes: `lampMaterial`, `poolMaterial`, `createPoolMesh`, `setNightLevel`, `SceneGlow`.
- Produces: `CarFleet.setNight(n)`.

- [ ] **Step 1: Light meshes**

In `cars.ts`, import `SceneGlow` and `createPoolMesh, lampMaterial, poolMaterial, setNightLevel` from `./nightLights`. Add these after `createCarMesh`:

```ts
/** Headlight / tail-light colours and the beam a car throws on the road. */
const HEADLIGHT = "#fff4d6";
const TAILLIGHT = "#ff3030";
const BEAM = "#ffe9b0";
/** Beam pool: how far ahead of the car's centre, its size, its brightness. */
const BEAM_AHEAD = 1.3;
const BEAM_LENGTH = 1.1;
const BEAM_WIDTH = 0.45;
const BEAM_STRENGTH = 0.55;

/** A pair of small lamps at `x` along the car (front +0.51, back −0.51). */
function lampPair(name: string, x: number, scene: Scene): Mesh {
  const lamps = [-1, 1].map((side) => {
    const lamp = CreateBox(`${name}-${side}`, { width: 0.04, height: 0.08, depth: 0.12 }, scene);
    lamp.bakeTransformIntoVertices(Matrix.Translation(x, 0.26, side * 0.15));
    return lamp;
  });
  const pair = Mesh.MergeMeshes(lamps, true);
  if (!pair) throw new Error("Failed to build car lamps");
  pair.name = name;
  pair.isPickable = false;
  return pair;
}

/** Scale-0 matrix: an instance that draws nothing (a parked car's lights). */
const HIDDEN = Matrix.Scaling(0, 0, 0);
```

- [ ] **Step 2: Fleet fields, constructor, capacity**

Add fields to `CarFleet`:

```ts
  /** Night lights: headlights, tail lights, beams on the road (hidden by day). */
  private readonly head: Mesh;
  private readonly tail: Mesh;
  private readonly beam: Mesh;
  private readonly headMat: StandardMaterial;
  private readonly tailMat: StandardMaterial;
  private readonly beamMat: StandardMaterial;
  private lightMatrices = new Float32Array(0);
  private beamMatrices = new Float32Array(0);
  private night = 0;
```

In the constructor, **before** `this.ensureCapacity(48);`, add:

```ts
    this.headMat = lampMaterial("carHeadlights", HEADLIGHT, scene);
    this.tailMat = lampMaterial("carTaillights", TAILLIGHT, scene);
    this.beamMat = poolMaterial("carBeams", BEAM, scene);
    this.head = lampPair("carHead", 0.51, scene);
    this.head.material = this.headMat;
    this.tail = lampPair("carTail", -0.51, scene);
    this.tail.material = this.tailMat;
    this.beam = createPoolMesh("carBeam", scene);
    this.beam.material = this.beamMat;
    for (const mesh of [this.head, this.tail, this.beam]) {
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isVisible = false;
    }
    const glow = SceneGlow.for(scene);
    glow.add(this.head, true);
    glow.add(this.tail, true);
```

and after `this.mesh.thinInstanceCount = 0;` add `this.head.thinInstanceCount = this.tail.thinInstanceCount = this.beam.thinInstanceCount = 0;`.

In `ensureCapacity`, after the two existing `thinInstanceSetBuffer` lines, add:

```ts
    this.lightMatrices = new Float32Array(this.capacity * 16);
    this.beamMatrices = new Float32Array(this.capacity * 16);
    // Head and tail lamps share one set of poses (the car's own, or hidden).
    this.head.thinInstanceSetBuffer("matrix", this.lightMatrices, 16, false);
    this.tail.thinInstanceSetBuffer("matrix", this.lightMatrices, 16, false);
    this.beam.thinInstanceSetBuffer("matrix", this.beamMatrices, 16, false);
```

- [ ] **Step 3: Write light poses in `sync`**

In `sync`, change `this.scale.setAll(1 - horizonFade(pose.pos, bounds));` to:

```ts
      const size = 1 - horizonFade(pose.pos, bounds);
      this.scale.setAll(size);
```

After `this.colors.set([c.r, c.g, c.b, 1], i * 4);`, add:

```ts
      // After dark: lamps on the car's pose (off while parked), and a beam
      // on the road ahead, following the ramps like the car does.
      if (this.night > 0) {
        if (car.parked) {
          HIDDEN.copyToArray(this.lightMatrices, i * 16);
          HIDDEN.copyToArray(this.beamMatrices, i * 16);
        } else {
          this.m.copyToArray(this.lightMatrices, i * 16);
          const ahead = {
            x: pose.pos.x + Math.cos(pose.heading) * BEAM_AHEAD,
            y: pose.pos.y + Math.sin(pose.heading) * BEAM_AHEAD,
          };
          toScene(ahead, world, roadSurfaceHeight(ahead, bridges) + 0.012, this.pos);
          this.scale.set(BEAM_LENGTH * size, 1, BEAM_WIDTH * size);
          Matrix.ComposeToRef(this.scale, this.rot, this.pos, this.m);
          this.m.copyToArray(this.beamMatrices, i * 16);
        }
      }
```

After the existing `thinInstanceBufferUpdated("color");`, add:

```ts
    if (this.night > 0) {
      for (const mesh of [this.head, this.tail, this.beam]) {
        mesh.thinInstanceCount = cars.length;
        mesh.thinInstanceBufferUpdated("matrix");
      }
    }
```

- [ ] **Step 4: `setNight` and dispose**

```ts
  /** 0 day … 1 night: lights and beams fade in (poses written by `sync`). */
  setNight(n: number): void {
    this.night = n;
    setNightLevel(this.headMat, n);
    setNightLevel(this.tailMat, n);
    setNightLevel(this.beamMat, n * BEAM_STRENGTH);
  }
```

In `dispose`, add `this.head.dispose(); this.tail.dispose(); this.beam.dispose();`.

Update the file header: "The fleet is one thin-instanced mesh (parked cars included), plus head/tail lamps and road beams at night (render/nightLights.ts): each frame writes …".

- [ ] **Step 5: Landscape fan-out**

In `landscape.ts` `setNight`, add `this.carFleet.setNight(n);`.

- [ ] **Step 6: Typecheck, lint, format; verify**

Run: `npm run format && npm run typecheck && npm run lint` (expect exit 0).
Storybook `tuning-time-of-day--night`: moving cars show white fronts, red backs and a soft beam ahead, while parked cars are dark. Beams follow the bridge ramps. `--noon`: no lamps. No console errors.

- [ ] **Step 7: Leave uncommitted.**

---

### Task 9: Boats' lanterns, night water

**Files:**
- Modify: `src/render/boats.ts` (`BoatFleet`)
- Modify: `src/render/landscape.ts` (`setNight`, `update`, constants)

**Interfaces:**
- Consumes: `lampMaterial`, `setNightLevel`, `SceneGlow`.
- Produces: `BoatFleet.setNight(n)`.

- [ ] **Step 1: Lanterns on the templates**

In `boats.ts`, import `CreateSphere` from `@babylonjs/core/Meshes/Builders/sphereBuilder`, `SceneGlow` from `./glow`, and `lampMaterial, setNightLevel` from `./nightLights`. Add the field `private readonly lanternMat: StandardMaterial;`. In the constructor, before `const make = …`:

```ts
    this.lanternMat = lampMaterial("boatLantern", "#ffd27a", scene);
    // A lantern at the masthead (sailboat) or on the cabin roof: a child
    // of the template, so every clone carries its own.
    const lantern = (body: Mesh, x: number, y: number) => {
      const lamp = CreateSphere(`${body.name}-lantern`, { diameter: 0.14, segments: 6 }, scene);
      lamp.parent = body;
      lamp.position.set(x, y, 0);
      lamp.material = this.lanternMat;
      lamp.isPickable = false;
    };
```

Change `make` so templates are disabled (their children then never draw, whatever `setNightLevel` does to `isVisible`):

```ts
    const make = (body: Mesh) => {
      body.material = bodyMat;
      body.isVisible = false; // templates only; clones are what's drawn
      body.setEnabled(false); // …and their lanterns with them
      body.isPickable = false;
      return body;
    };
```

After the `this.templates = { … };` assignment, add:

```ts
    lantern(this.templates.sailboat, 0.17, 3.48);
    lantern(this.templates.motorboat, -0.1, 0.86);
```

- [ ] **Step 2: Clones: enable, glow, lit-now**

In `createView`, after `body.isVisible = true;`, add:

```ts
    body.setEnabled(true);
    // The lantern: halo at night, and lit at once if launched after dark.
    for (const child of body.getChildMeshes()) {
      child.isVisible = this.lanternMat.alpha > 0;
      SceneGlow.for(body.getScene()).add(child as Mesh, true);
    }
```

Add the method:

```ts
  /** 0 day … 1 night: lanterns fade in. */
  setNight(n: number): void {
    setNightLevel(this.lanternMat, n);
  }
```

- [ ] **Step 3: Night water + fan-out**

In `landscape.ts`:
- After `WATER_EMISSIVE`, add:

```ts
/** Water glow at full night: darker, a moonlit blue. */
const WATER_NIGHT = new Color3(0.02, 0.05, 0.1);
```

- Add the fields `private night = 0;` and `private readonly waterBase = new Color3();`.
- In `update`, replace `WATER_EMISSIVE.scaleToRef(pulse, this.waterMat.emissiveColor);` with:

```ts
    Color3.LerpToRef(WATER_EMISSIVE, WATER_NIGHT, this.night, this.waterBase);
    this.waterBase.scaleToRef(pulse, this.waterMat.emissiveColor);
```

- In `setNight`, add `this.night = n;` and `this.fleet.setNight(n);`.
- Header comment: change "Low-poly daytime landscape" to "Low-poly landscape (lit for the time of day by render/dayCycle.ts; night lights via `setNight`)".

- [ ] **Step 4: Typecheck, lint, format; verify** (Review Focus 2: boat launched at night)

Run: `npm run format && npm run typecheck && npm run lint` (expect exit 0).
Storybook: in `tuning-time-of-day--night`, boats carry a glowing lantern. Wait for a new boat to enter the river (≈30 s): its lantern is lit on arrival. The water is darker. In `scene-river--…` (id from `index.json`), boats look as before, with no lantern visible by day and no console errors.

- [ ] **Step 5: Leave uncommitted.**

---

### Task 10: Plane landing-light beams

**Files:**
- Modify: `src/render/sceneSync.ts`

**Interfaces:**
- Consumes: `poolMaterial`, `createPoolMesh`, `setNightLevel`.
- Produces: nothing new (internal to `SceneSync`).

- [ ] **Step 1: Constants and imports**

Import `Matrix, Quaternion` (alongside `Vector3`) from `@babylonjs/core/Maths/math.vector`, `import "@babylonjs/core/Meshes/thinInstanceMesh";`, `import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";` and `import { createPoolMesh, poolMaterial, setNightLevel } from "./nightLights";`. Add constants near the other module constants:

```ts
/**
 * Landing lights at night: a pool of light on the ground ahead of each
 * plane below `BEAM_ALTITUDE` (on approach, on the ground, taking off).
 * It shrinks and fades as the plane climbs out of range.
 */
const BEAM_ALTITUDE = 6;
/** Pool height: over the runway paint (0.09), under a rolling plane (0.35). */
const BEAM_Y = 0.1;
const BEAM_LENGTH = 2.6;
const BEAM_WIDTH = 1.2;
const BEAM_STRENGTH = 0.6;
/** Phases whose landing lights are on (not parked in a hangar or gone). */
const BEAM_PHASES = new Set<PlanePhase>([
  "flying",
  "landing",
  "taxiing",
  "departing",
  "outbound",
  "takeoff",
  "climbout",
]);
```

Import the `PlanePhase` type from `../core/types` if it isn't in the existing type import list.

- [ ] **Step 2: Fields, constructor**

Fields:

```ts
  /** Landing-light pools, one thin instance per plane in range (night only). */
  private readonly beams: Mesh;
  private readonly beamMat: StandardMaterial;
  private beamMatrices = new Float32Array(16 * 8);
  private readonly beamM = new Matrix();
  private readonly beamRot = new Quaternion();
  private readonly beamScale = new Vector3();
  private readonly beamPos = new Vector3();
```

(Change `import type { Mesh }` to a value import if needed. `createPoolMesh` returns `Mesh`, so the type import is enough.)

Constructor, at the end:

```ts
    this.beamMat = poolMaterial("landingLights", "#fff6e0", scene);
    this.beams = createPoolMesh("landingLights", scene);
    this.beams.material = this.beamMat;
    this.beams.alwaysSelectAsActiveMesh = true;
    this.beams.isVisible = false;
    this.beams.thinInstanceSetBuffer("matrix", this.beamMatrices, 16, false);
    this.beams.thinInstanceCount = 0;
```

- [ ] **Step 3: `setNight` + per-frame sync**

In `setNight`, add `setNightLevel(this.beamMat, n * BEAM_STRENGTH);`.

In `syncPlanes`, directly after the `for (const plane of state.planes) { … }` loop (before `this.crashEffect?.update(dt);`), add `this.syncBeams(state);`, then add the method:

```ts
  /**
   * Night only: a landing-light pool on the ground ahead of every plane
   * low enough to light it. New planes need nothing special: each frame
   * rewrites the whole set.
   */
  private syncBeams(state: GameState): void {
    if (this.night <= 0) return;
    if (this.beamMatrices.length < state.planes.length * 16) {
      this.beamMatrices = new Float32Array(state.planes.length * 32);
      this.beams.thinInstanceSetBuffer("matrix", this.beamMatrices, 16, false);
    }
    let count = 0;
    for (const plane of state.planes) {
      const view = this.views.get(plane.id);
      if (!view || this.wreckIds.has(plane.id) || !BEAM_PHASES.has(plane.phase)) continue;
      const height = view.aircraft.root.position.y;
      if (height >= BEAM_ALTITUDE) continue;
      const fade = 1 - height / BEAM_ALTITUDE;
      const ahead = 1.6 + height * 0.6;
      toScene(
        {
          x: plane.pos.x + Math.cos(plane.heading) * ahead,
          y: plane.pos.y + Math.sin(plane.heading) * ahead,
        },
        state.world,
        BEAM_Y,
        this.beamPos,
      );
      Quaternion.RotationYawPitchRollToRef(headingToRotationY(plane.heading), 0, 0, this.beamRot);
      this.beamScale.set(BEAM_LENGTH * fade, 1, BEAM_WIDTH * fade);
      Matrix.ComposeToRef(this.beamScale, this.beamRot, this.beamPos, this.beamM);
      this.beamM.copyToArray(this.beamMatrices, count * 16);
      count++;
    }
    this.beams.thinInstanceCount = count;
    this.beams.thinInstanceBufferUpdated("matrix");
  }
```

- [ ] **Step 4: Typecheck, lint, format; verify** (Review Focus 2: new plane at night)

Run: `npm run format && npm run typecheck && npm run lint` (expect exit 0).
- Storybook `scene-gameplay--landing` (daylight): no beams, same as before.
- Game at night (`__game.state.elapsed = 300`): draw a landing path. The beam appears on the ground as the plane descends below 6, grows on the runway, follows it down the taxiway, and disappears into the hangar. A departure shows a beam on its roll that fades after lift-off.

- [ ] **Step 5: Leave uncommitted.**

---

## Phase 3: sound, HUD, docs

### Task 11: Music and ambience at night

**Files:**
- Modify: `src/audio/music.ts`
- Modify: `src/audio/ambience.ts`
- Modify: `src/audio/mixer.ts`
- Modify: `src/audio/music.stories.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `NIGHT_PROGRESSION: readonly Chord[]`, `Music.setNight(n: number)`, `Music.isNight(): boolean`, `Ambience.setNight(n: number)`, `GameAudio.setNight(n: number)`.

- [ ] **Step 1: `music.ts`**

- Replace the `TODO(you)` paragraph in the `MUSIC_PROGRESSION` comment with: `The day loop: a gentle I–IV–ii–V in D major …` (keep the "things to try" list minus the minor-key line, which is now `NIGHT_PROGRESSION`).
- After `MUSIC_PROGRESSION`, add:

```ts
/**
 * The night loop, after dusk: B minor, the relative minor of the day's D
 * major (the same notes, a sadder home), so the change is a soft one:
 * Bm9 → Gmaj7 → Dmaj7 → A6. Voiced in the same C3–G4 range.
 */
export const NIGHT_PROGRESSION: readonly Chord[] = [
  { name: "Bm9", root: 35, notes: [50, 54, 57, 59, 61] },
  { name: "Gmaj7", root: 43, notes: [55, 59, 62, 66] },
  { name: "Dmaj7", root: 38, notes: [50, 54, 57, 61] },
  { name: "A6", root: 45, notes: [57, 61, 64, 66] },
];

/**
 * Switch to the night loop once `night` reaches `NIGHT_ON`, back to day
 * below `NIGHT_OFF`; the gap stops it flip-flopping. Changes land on the
 * next chord boundary.
 */
const NIGHT_ON = 0.6;
const NIGHT_OFF = 0.4;

/** At full night the piano plays this much less often. */
const NIGHT_PIANO_THIN = 0.3;
```

- Fields in `Music`:

```ts
  /** 0 day … 1 night (see `setNight`), and which loop is playing. */
  private night = 0;
  private nightMode = false;
```

- Methods after `setChordSeconds`:

```ts
  /** How dark it is, 0 day … 1 night (render/dayCycle.ts via the mixer). */
  setNight(n: number): void {
    this.night = n;
  }

  /** Is the night loop (`NIGHT_PROGRESSION`) the one playing? */
  isNight(): boolean {
    return this.nightMode;
  }
```

- In `update()`, replace the body of the `while (this.nextChord < horizon)` loop with:

```ts
      // Day or night loop, decided chord by chord; a switch starts the new
      // loop from its first chord.
      const night = this.nightMode ? this.night > NIGHT_OFF : this.night >= NIGHT_ON;
      if (night !== this.nightMode) {
        this.nightMode = night;
        this.chordIndex = 0;
      }
      const progression = night ? NIGHT_PROGRESSION : MUSIC_PROGRESSION;
      const index = this.chordIndex % progression.length;
      this.scheduleChord(progression[index]!, this.nextChord);
      this.booked.push({ t: this.nextChord, index });
      if (this.booked.length > 3) this.booked.shift();
      this.chordIndex++;
      this.nextChord += this.chordSeconds;
```

- Update `currentChord`'s doc: `The chord sounding now (its index in the loop playing, see isNight), or null before the first.`
- In `scheduleChord`, change `if (this.rng() >= PIANO_DENSITY) continue;` to:

```ts
      if (this.rng() >= PIANO_DENSITY * (1 - NIGHT_PIANO_THIN * this.night)) continue;
```

- [ ] **Step 2: `ambience.ts`**

- Constant near `PA_SCHEDULE`:

```ts
/** At full night the terminal is this much quieter (share of its level). */
const TERMINAL_NIGHT_DIP = 0.55;
```

- Fields:

```ts
  /** Terminal level for the time of day (between the glass and the layer). */
  private readonly nightDim: GainNode;
  /** 0 day … 1 night, and the terminal level last scheduled. */
  private night = 0;
  private dim = 1;
```

- In the constructor, replace `glass.connect(this.layers.terminal);` with:

```ts
    this.nightDim = ctx.createGain();
    glass.connect(this.nightDim).connect(this.layers.terminal);
```

- Method after `setLayer`:

```ts
  /**
   * How dark it is, 0 day … 1 night: the terminal empties out (quieter) and
   * the PA speaks less often. Cheap every frame: the gain is only
   * rescheduled when it moves.
   */
  setNight(n: number): void {
    this.night = n;
    const dim = 1 - TERMINAL_NIGHT_DIP * n;
    if (Math.abs(dim - this.dim) < 0.01) return;
    this.dim = dim;
    this.nightDim.gain.setTargetAtTime(dim, this.ctx.currentTime, 2);
  }
```

- In `update()`, change `this.nextPa += this.between(PA_SCHEDULE.interval);` to:

```ts
      // Quieter nights: gaps up to twice as long at full night.
      this.nextPa += this.between(PA_SCHEDULE.interval) * (1 + this.night);
```

- [ ] **Step 3: `mixer.ts`**

- Field: `/** 0 day … 1 night, replayed into the graph when it's created. */ private night = 0;`
- In `unlock()`, after `this.graph.sfx.setFocus(this.focus);`, add:

```ts
      // It may already be night by the first click.
      this.graph.music.setNight(this.night);
      this.graph.ambience.setNight(this.night);
```

- Method after `setFocus`:

```ts
  /**
   * How dark it is, 0 day … 1 night (render/dayCycle.ts): the music moves
   * to its night loop, the terminal quiets down. Safe before audio starts.
   */
  setNight(n: number): void {
    this.night = n;
    this.graph?.music.setNight(n);
    this.graph?.ambience.setNight(n);
  }
```

- [ ] **Step 4: `main.ts`**

After `sceneSync.setNight(dayCycle.night);` add `audio.setNight(dayCycle.night);`.

- [ ] **Step 5: `music.stories.ts`: night toggle**

- Add `night: boolean;` with the doc comment `/** Play the night loop (as after dusk in the game). */` to `MusicArgs`, and add `night: false` to `args`.
- Import `NIGHT_PROGRESSION`.
- Build the chips from `const loop = args.night ? NIGHT_PROGRESSION : MUSIC_PROGRESSION;` (replace `MUSIC_PROGRESSION.map(` with `loop.map(`).
- In the Start click handler, *before* `audio.unlock();`, add `audio.setNight(args.night ? 1 : 0);`. The order is deliberate: it exercises the replay in `unlock` (Review Focus 3).
- Header doc: add "`night` plays the after-dusk loop (`NIGHT_PROGRESSION`)."

- [ ] **Step 6: Typecheck, lint, format; verify** (Review Focus 3)

Run: `npm run format && npm run typecheck && npm run lint` (expect exit 0).
- Storybook `audio-music--music` with `night` on: press Start. The chips show Bm9/Gmaj7/Dmaj7/A6, the highlighted chip advances, and there are no errors.
- Replay before unlock (Review Focus 3): that same story run proves it, since `setNight(1)` ran before `unlock()`. Also check with `browser_evaluate` on the story frame that no chip of the day loop (Dmaj9) ever lights.
- Game, dusk transition: `__game.state.elapsed = 250` (≈20:30, night ≈ 0.5). Then over a few chords, `isNight()` flips once as night passes 0.6 and doesn't flip back.

- [ ] **Step 7: Leave uncommitted.**

---

### Task 12: HUD clock

**Files:**
- Modify: `src/ui/hudMarkup.ts` (icons, score panel)
- Modify: `src/ui/hud.ts` (`Hud.setClock`, `formatClock`)
- Modify: `src/ui/hudMarkup.stories.ts` (`ScorePanel`)
- Modify: `src/ui/hud.stories.ts` (`hours` arg, `Night` story)
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `nightFactor` (core/daytime.ts) in stories.
- Produces: `CLOCK_ICONS: { sun: string; moon: string }` (hudMarkup.ts), `formatClock(hours: number): string` (hud.ts), `Hud.setClock(hours: number, night: number): void`.

- [ ] **Step 1: Markup**

In `hudMarkup.ts`, after `MUSIC_ICON`, add:

```ts
/** Sun and moon for the HUD clock (same stroke style, smaller). */
export const CLOCK_ICONS = {
  sun: `
  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" fill="currentColor" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
  </svg>`,
  moon: `
  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>`,
};
```

Replace `scorePanelMarkup` with:

```ts
/**
 * "Landed" counter, top-left, with the time of day under it (a sun or a
 * moon and the 24 h clock; `hud.setClock` fills them in).
 */
export function scorePanelMarkup(): string {
  return `
    <div class="pointer-events-none absolute top-4 left-4 z-10">
      <div
        data-arrow-avoid
        class="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 shadow-lg backdrop-blur-sm"
      >
        <span class="text-sm font-bold tracking-wider text-slate-400 uppercase">Landed</span>
        <div id="scoreDisplay" class="glow-text text-3xl font-black text-sky-400">0</div>
        <div class="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-300 tabular-nums">
          <span id="clockIcon" class="text-amber-300" title="Day">${CLOCK_ICONS.sun}</span>
          <span id="clockTime">08:00</span>
        </div>
      </div>
    </div>`;
}
```

(`scorePanelMarkup` is only called at runtime, after the module has initialised, so `CLOCK_ICONS` may sit next to `MUSIC_ICON` further down the file.)

- [ ] **Step 2: `hud.ts`**

- Import `CLOCK_ICONS` from `./hudMarkup`.
- Add the exported helper at module level:

```ts
/** "HH:MM" for a time of day in hours (0 ≤ h < 24; wraps). */
export function formatClock(hours: number): string {
  const minutes = Math.floor((((hours % 24) + 24) % 24) * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
```

- In the `Hud` interface, after `setScore`:

```ts
  /**
   * Time of day under the score: `hours` as HH:MM, and a moon once
   * `night` ≥ 0.5 (a sun before). Cheap every frame: the DOM is only
   * touched when the minute or the icon changes.
   */
  setClock(hours: number, night: number): void;
```

- In `createHud`, after `const score = byId("scoreDisplay");`:

```ts
  const clockIcon = byId("clockIcon");
  const clockTime = byId("clockTime");
  let clockText = "";
  let clockNight: boolean | null = null;
```

- In the returned object, after `setScore`:

```ts
    setClock(hours, night) {
      const text = formatClock(hours);
      if (text !== clockText) {
        clockText = text;
        clockTime.textContent = text;
      }
      const isNight = night >= 0.5;
      if (isNight !== clockNight) {
        clockNight = isNight;
        clockIcon.innerHTML = isNight ? CLOCK_ICONS.moon : CLOCK_ICONS.sun;
        clockIcon.title = isNight ? "Night" : "Day";
        clockIcon.classList.toggle("text-amber-300", !isNight);
        clockIcon.classList.toggle("text-sky-200", isNight);
      }
    },
```

- [ ] **Step 3: `main.ts`**

After `audio.setNight(dayCycle.night);` add `hud.setClock(dayCycle.hours, dayCycle.night);`.

- [ ] **Step 4: Stories**

`hudMarkup.stories.ts` `ScorePanel`:

```ts
export const ScorePanel: StoryObj<{ score: number; hours: number }> = {
  args: { score: 42, hours: 8 },
  argTypes: {
    score: { control: { type: "number", min: 0, step: 1 } },
    hours: { control: { type: "range", min: 0, max: 23.99, step: 0.25 } },
  },
  render: ({ score, hours }) => {
    const root = stage(scorePanelMarkup());
    part(root, "scoreDisplay").textContent = String(score);
    part(root, "clockTime").textContent = formatClock(hours);
    part(root, "clockIcon").innerHTML =
      nightFactor(hours) >= 0.5 ? CLOCK_ICONS.moon : CLOCK_ICONS.sun;
    return root;
  },
};
```

Import `CLOCK_ICONS` from `./hudMarkup`, `formatClock` from `./hud`, and `nightFactor` from `../core/daytime`.

`hud.stories.ts`:
- Add to `HudArgs`: `/** Time of day on the HUD clock (hours; night from ~21:00). */ hours: number;`
- Add to `argTypes`: `hours: { control: { type: "range", min: 0, max: 23.99, step: 0.25 } },`
- Add to `args`: `hours: 8,`
- In `applyArgs`, after `hud.setScore(args.score);`: `hud.setClock(args.hours, nightFactor(args.hours));` (import `nightFactor` from `../core/daytime`).
- New story after `Playing`:

```ts
/** A shift after dark: the clock shows the moon. */
export const Night: Story = { args: { phase: "playing", score: 14, hours: 23.5 } };
```

- [ ] **Step 5: Typecheck, lint, format; verify**

Run: `npm run format && npm run typecheck && npm run lint` (expect exit 0).
- Storybook `hud-elements--score-panel` (hours 8, then 23): sun 08:00, then moon 23:00. `hud-screens--night`: moon + 23:30. `hud-screens--playing`: sun 08:00. No console errors.
- Game: the clock ticks one minute per ⅓ s, the icon switches at ≈20:30, and arrival arrows still avoid the (taller) score card.

- [ ] **Step 6: Leave uncommitted.**

---

### Task 13: Docs, full Storybook sweep, performance, cleanup

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-28-day-night-shift-design.md` (naming follow-ups only)

- [ ] **Step 1: `CLAUDE.md`**

- In the **Architecture** `src/core/` bullet, append: `The shift's time of day comes from \`state.elapsed\` (\`core/daytime.ts\`: clock, sun/moon arcs, \`nightFactor\`).`
- In the render/input/ui/audio bullet, after "Web Audio sound", add: `Day/night: \`render/dayCycle.ts\` blends the palette in \`render/dayTuning.ts\` onto the scene's lights; \`SceneSync.setNight\` fans \`night\` out to fake night lights (\`render/nightLights.ts\`, halos via the shared \`render/glow.ts\`); music, ambience and the HUD clock follow the same value.`
- In the **Storybook** bullet, add: `The "Tuning/Time of day" stories (\`src/render/stories/dayCycle.stories.ts\`) play the day/night cycle on the full scene and edit each palette keyframe live, emitting a \`DAY_KEYFRAMES\` snippet to paste back.`

- [ ] **Step 2: Spec naming follow-up**

In the spec, §1 table: rename `sunAngles` / `moonAngles` to `sunArc` / `moonArc` returning `{ height, sweep }` (angles are applied in `render/dayCycle.ts` from `SUN_DIRECTION`). Add `wrapHours`. In §2.1, note the extra keyframes (`lateNight`, `predawn`, `morning`, `afternoon`, `blueHour`). Change "opposite side of the sky" to "the sun's arc 12 h later, lower".

- [ ] **Step 3: Full static checks**

Run: `npm run format && npm run typecheck && npm run lint && npm run build`
Expected: all exit 0.

- [ ] **Step 4: Render every story** (Review Focus 5)

With Storybook running:

```bash
curl -s localhost:6006/index.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).entries;for(const k in e)if(e[k].type==="story")console.log(k)})'
```

Open every id as `iframe.html?id=<id>` with the Playwright MCP browser. Wait ≈2 s each, collect `browser_console_messages` (level error) and page errors. Expected: zero errors across all stories.

Spot-check that these still show the plain daylight look (no halos on runway lights, no windows, pools or lanterns): `scene-gameplay--landing`, a countryside story, a river story, and `hud-screens--playing` (which gains only the clock).

- [ ] **Step 5: Performance**

Game (`npm run dev`): START, `__game.state.elapsed = 300` (full night, every light on). Let traffic build for ≈60 s. Run `performance_start_trace` / `performance_stop_trace` (chrome-devtools MCP), or sample `__game` frame rate with:

```js
let n = 0; const t0 = performance.now(); const f = () => { if (++n < 300) requestAnimationFrame(f); else console.log((n * 1000) / (performance.now() - t0)); }; requestAnimationFrame(f);
```

Expected: ≈ the same fps as at `elapsed = 0` (60 on the dev laptop). If it drops, first suspect the pool overdraw (`FLOOD_RADIUS`, `LAMP_POOL_RADIUS`) and the glow intensity.

- [ ] **Step 6: Stop servers**

Stop the dev server, the Storybook server, any `vite preview`, and close the Playwright/Chrome browser (user memory: kill servers when done). Check with `lsof -i :5173 -i :6006 -i :4173`: nothing listening.

- [ ] **Step 7: Leave uncommitted; hand off**

Report the changed files (`git status --short`) and suggest the commit message:

```
feat: day/night shift

Every shift runs through a looping time of day (08:00 start, 8 min per
24 h): keyframed sky and sun/moon light with moving shadows, fake night
lights (runway/taxi glow, stand floodlights, lit windows, street lamps,
headlights, lanterns, landing lights), a readability floor for liveries
and runway colours, a night music loop and quieter terminal, and a HUD
clock. Tuning/Time of day stories edit the palette live.
```
