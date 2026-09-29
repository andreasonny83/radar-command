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
export const DAY_SECONDS = 360; // 6 minutes

/** Hour every shift (and the start screen) opens at. */
export const SHIFT_START_HOUR = 12;

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
