# Day/night shift — design

Date: 2026-09-28
Status: approved in conversation, awaiting written-spec review

## Goal

Give every shift a running time of day: the scene moves through morning,
day, dusk and night and back, on a loop, with lights coming on after dark.
It is atmosphere only: the game's rules, traffic and scoring don't change.

Success means:

- a shift opens at 08:00 and a full 24 h loop takes 8 real minutes;
- sky, sun colour, sun angle and shadows change smoothly through the day;
  a low moon lights the night;
- after dark the airport, village, roads, river and planes light up (runway,
  taxi and approach lights, lit windows, headlights, lanterns, landing
  lights);
- **night never costs readability**: at the darkest point, plane liveries,
  runway colours, drawn paths and warning rings read as clearly as by day;
- music drifts to a minor key at night and the terminal quiets down;
- a HUD clock shows the time of day;
- a "Tuning/Time of day" story lets the palette be tuned live;
- no drop below 60 fps at night on the laptop that holds 60 fps today;
- no new console errors.

## Out of scope

- Gameplay changes at night (visibility limits, score multipliers, traffic
  changes).
- Real-world local time, weather, fog, stars/sky dome.
- New sound recordings (e.g. crickets). They can come later through
  `scripts/audio/sources.json`.
- Tests: `CLAUDE.md` says to ignore tests for now. The core functions are
  pure, so they are easy to cover later.

## 1. Clock — `src/core/daytime.ts` (new, pure)

No DOM or Babylon imports.

| Export | Meaning |
|---|---|
| `DAY_SECONDS = 480` | Real seconds per 24 h loop (1 game hour = 20 s). |
| `SHIFT_START_HOUR = 8` | Hour every shift (and the start screen) opens at. |
| `clockHours(elapsed)` | `(SHIFT_START_HOUR + elapsed / DAY_SECONDS * 24) % 24`. |
| `sunArc(hours)` | Sun's place on its arc, `{ height, sweep }`: rises ~06:30, sets ~19:30, peaks 13:00. `render/dayCycle.ts` turns it into a light direction from `SUN_DIRECTION`, so noon is unchanged. |
| `moonArc(hours)` | The sun's arc 12 h later, lower. |
| `wrapHours(delta)` | Signed shortest way round the clock, in [-12, 12). |
| `nightFactor(hours)` | 0 = day, 1 = night; smoothstep ramps. |

`nightFactor` ramps:

| Hours | Value |
|---|---|
| 07:00–19:00 | 0 |
| 19:00–22:00 | 0 → 1 (dusk) |
| 22:00–04:00 | 1 (a quarter of the loop) |
| 04:00–07:00 | 1 → 0 (dawn) |

One loop in real time: 0:00 = 08:00, 3:40 dusk begins, 4:40 full night,
7:40 day again, 8:00 repeats.

**No new state field.** The clock is derived from `state.elapsed`, which
already resets on a new shift and only advances while `playing`. So the time
of day freezes on pause and game over with no extra code.

## 2. Render

### 2.1 `DayCycle` — `src/render/dayCycle.ts` (new)

Owns the lighting built by `createScene` (`src/render/scene.ts`): the
hemispheric `fill`, the directional `key` and its shadow generator, and the
scene clear colour. (The glow layer belongs to `MeshFactory`; it follows
`night` through `SceneSync.setNight`, see 2.2. Water darkens
through `landscape.ts`'s `setNight`.)

- `update(elapsed: number, dt: number)`: `clockHours` → blend of the palette
  keyframes → apply to the lights and scene.
- `hours: number` (the shown time of day, after any fast-forward),
  `night: number` (0..1, from `nightFactor(hours)`) and
  `clearColor: string` (hex) for the rest of the app to read.
- `setHours(hours)`: for stories (bypasses `elapsed`).

**Palette keyframes** live in `src/render/dayTuning.ts` (new), as named
constants in the style of `flightTuning.ts`. Each keyframe:

```ts
interface DayKeyframe {
  hour: number;
  clear: string;        // clear colour (darkened grass)
  fillColor: string;    // hemispheric diffuse
  fillGround: string;   // hemispheric ground colour
  fillIntensity: number;
  keyColor: string;     // sun / moon colour
  keyIntensity: number;
  shadowDarkness: number; // 0 black … 1 none
}
```

Starting keyframes (tuned in the story). Also in the palette: `lateNight` (03:00), `predawn` (05:00, key at 0 for the moon-to-sun swap), `morning` (08:30) and `afternoon` (16:30) holding the noon look, `blueHour` (21:00, key at 0 for the sun-to-moon swap):

| Hour | Look |
|---|---|
| 06:00 dawn | Low orange sun, pink fill. |
| 13:00 noon | **Exactly today's constants**, so the day look is unchanged. |
| 19:30 dusk | Amber sun, long shadows. |
| 23:00 night | Deep-blue fill ~0.3, cold low moon ~0.2, lighter shadows. |

Blending is linear between neighbouring keyframes, wrapping round midnight.

**Sun to moon.** The key light's direction follows `sunArc`, elevation
clamped to ≥ 25° so shadows never stretch into long streaks or break the
fixed shadow frustum (`fitShadowsToWorld`). Around 21:00 the keyframes take
the key's intensity to ~0 and shadow darkness to ~1. While it is dark, the
direction swaps to `moonArc` and the moon fades in, so the shadow
direction never visibly jumps. The same swap happens in reverse around 05:00.

**New shift after dark.** When the target hour jumps (e.g. a restart at
02:00 goes to 08:00), `DayCycle` fast-forwards the shown hour through dawn
over ~1.5 s instead of snapping.

`scene.ts` keeps creating the lights with today's values (stories that don't
use `DayCycle` look exactly as now). Its header comment no longer says
"daytime lights" only.

### 2.2 Night lights

**No new Babylon lights.** `StandardMaterial` handles 4 lights per mesh by
default, and dozens of point lights would ruin the frame rate. Every night
light is one of:

- emissive geometry;
- a glow-layer halo;
- an additive "light pool" quad lying on the ground.

The only real lights stay the key (sun/moon) and the fill.

`SceneSync.setNight(n)` fans the value out to the views:

| View | At night |
|---|---|
| `runway.ts` | Edge and approach lights brighten and glow. Colour threshold bars get extra self-light. |
| `airfield.ts` | Blue taxi edge lights brighten. |
| `airportGrounds.ts` | Terminal glass glows warm, tower cab lit, apron floodlight pools. |
| `countryside.ts` | Thin-instanced window quads on houses. Each house has a seeded switch-on threshold, so windows come on one by one at dusk. Lamp dots + light pools along village roads. |
| `cars.ts` | A second thin-instance mesh reuses each car's matrix: white headlights, red tail lights, faint beam on the road. One extra draw call. |
| `boats.ts` | Masthead lantern. |
| `aircraft.ts` / `sceneSync.ts` | Landing-light beam (additive cone/quad) when low: approach, landing, take-off. Nav, strobe and beacon glow harder. |
| `landscape.ts` | Passes `setNight` on to airports, countryside, cars, boats and bridges (bridge lamp brightens); blends the water emissive from `WATER_EMISSIVE` toward a new `WATER_NIGHT` by `n`. |
| `meshes.ts` (`MeshFactory`) | Glow-layer intensity rises with `n`; new night emissives are added to its include-list explicitly. |

Night pieces fade with `n` (alpha/emissive × `n`, or thresholded per item)
and are hidden (`isVisible = false`) while `n === 0`, so the day costs
nothing extra.

**Readability floor.**

- Plane livery self-light (emissive) rises with `n`, so red, blue, yellow
  and violet stay unmistakable.
- Runway colour markers do the same.
- Paths, warning, anchor, hover and reject rings already draw unlit in the
  overlay rendering group; check they stay unchanged.
- The darkest keyframe is tuned against this floor in the story.

### 2.3 Wiring — `src/main.ts`

In the render loop, before `sceneSync.syncPlanes`:

```ts
dayCycle.update(state.elapsed, dt);
sceneSync.setNight(dayCycle.night);
audio.setNight(dayCycle.night);
hud.setClock(dayCycle.hours, dayCycle.night);
```

The page body background (mirrored from `CLEAR_COLOR` in `style.css` today)
follows `dayCycle.clearColor`, set only when the colour changes.

## 3. Audio

The audio layer never imports render code. `main.ts` passes the number on
through `audio.setNight(n)`, which forwards it to music and ambience.

- **Music (`src/audio/music.ts`).** New `NIGHT_PROGRESSION`:
  Bm9 → Gmaj7 → Dmaj7 → A6, the minor key the file's comment already
  suggests.
  - The progression is picked when the next chord is scheduled, with
    hysteresis: switch to night at `n ≥ 0.6`, back to day at `n ≤ 0.4`.
    Changes only happen on chord boundaries.
  - B minor is D major's relative minor, so the shift is soft.
  - The piano plays a little sparser at night (density × `1 − 0.3n`).
- **Ambience (`src/audio/ambience.ts`).**
  - The terminal loop level falls to ~45% at full night.
  - PA gaps stretch: the next interval is drawn from
    `PA_SCHEDULE.interval × (1 + n)`.

## 4. HUD

- Clock chip under the "Landed" card (top-left, same `data-arrow-avoid`
  box): `08:40` plus a sun or moon SVG icon, switching at `n ≥ 0.5`.
- Markup in `src/ui/hudMarkup.ts`; `hud.setClock(hours, night)` in
  `src/ui/hud.ts` writes to the DOM only when the minute string or the icon
  changes.

## 5. Storybook

- **New "Tuning/Time of day"** (`src/render/stories/dayCycle.stories.ts`):
  - the shared stage (`stage.ts`) with an airport, village, roads with cars,
    river with boats, and planes flying and landing;
  - controls: hour slider (0–24), play toggle with speed;
  - live editing of each keyframe, with a "copy palette" snippet to paste
    back into `dayTuning.ts` (like "Tuning/Flight").
- HUD stories (`hudMarkup.stories.ts` / `hud.stories.ts`): clock in day and
  night states.
- "Audio/Music" (`music.stories.ts`): day/night progression toggle.
- Existing stories are unchanged: they don't create a `DayCycle`, so they
  keep today's daytime constants.
- `CLAUDE.md`: a line on `core/daytime.ts`, `render/dayCycle.ts` /
  `dayTuning.ts` and the new story.

## 6. Build phases

Each phase is checked in the game before the next.

1. `core/daytime.ts`, `DayCycle` + `dayTuning.ts` (sky, sun/moon, shadows,
   restart fast-forward), wiring in `main.ts`, "Tuning/Time of day" story.
2. Night lights across all views, `SceneSync.setNight` fan-out, readability
   floor.
3. Audio (music progression, ambience), HUD clock, HUD/music stories,
   `CLAUDE.md`.

## 7. Verification

- `npm run typecheck`, `npm run lint`, `npm run build` pass.
- Every story renders (`iframe.html?id=<story-id>`) with no console or page
  errors.
- In the game (dev), jump through the day via the dev handle:
  `__game.state.elapsed = 280` (full night), `= 220` (dusk), `= 440` (dawn).
  Check the readability floor, the sun/moon swap, the restart fast-forward
  and pause freezing the clock.
- Frame rate holds 60 fps at night with every night light on.
- Dev, Storybook and preview servers and any headless browser are stopped
  at the end.

## Risks

- **Glow layer blooming the scenery.** It already uses an include-list for
  aircraft lights. New night emissives must be added to that list
  deliberately, not by turning the layer on for everything.
- **Shadow acne at low sun angles.** The ≥ 25° clamp plus the existing bias
  should hold; retune `shadows.bias` in the story if needed.
- **Thin-instance windows on many houses.** One mesh, one draw call; the
  per-house threshold lives in an instance colour/alpha buffer, updated only
  when `n` changes by more than a step.
