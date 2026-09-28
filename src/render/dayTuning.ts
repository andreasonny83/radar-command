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
  {
    name: "lateNight",
    hour: 3,
    clear: "#0b160c",
    fillColor: "#5b6f9e",
    fillGround: "#1c2a26",
    fillIntensity: 0.34,
    keyColor: "#9fb4e8",
    keyIntensity: 0.18,
    shadowDarkness: 0.6,
  },
  {
    name: "predawn",
    hour: 5,
    clear: "#0e1910",
    fillColor: "#6f78a8",
    fillGround: "#232f28",
    fillIntensity: 0.36,
    keyColor: "#9fb4e8",
    keyIntensity: 0,
    shadowDarkness: 1,
  },
  {
    name: "dawn",
    hour: 6.5,
    clear: "#2a3d22",
    fillColor: "#f0c4c8",
    fillGround: "#3a4a30",
    fillIntensity: 0.5,
    keyColor: "#ffb070",
    keyIntensity: 0.55,
    shadowDarkness: 0.45,
  },
  {
    name: "morning",
    hour: 8.5,
    clear: "#2f5222",
    fillColor: "#f2f7ff",
    fillGround: "#405933",
    fillIntensity: 0.65,
    keyColor: "#fff2d9",
    keyIntensity: 0.75,
    shadowDarkness: 0.25,
  },
  {
    name: "noon",
    hour: 13,
    clear: "#2f5222",
    fillColor: "#f2f7ff",
    fillGround: "#405933",
    fillIntensity: 0.65,
    keyColor: "#fff2d9",
    keyIntensity: 0.75,
    shadowDarkness: 0.25,
  },
  {
    name: "afternoon",
    hour: 16.5,
    clear: "#2f5222",
    fillColor: "#f2f7ff",
    fillGround: "#405933",
    fillIntensity: 0.65,
    keyColor: "#fff2d9",
    keyIntensity: 0.75,
    shadowDarkness: 0.25,
  },
  {
    name: "dusk",
    hour: 19.5,
    clear: "#2b3f20",
    fillColor: "#f2b8a0",
    fillGround: "#3b4730",
    fillIntensity: 0.5,
    keyColor: "#ff9a4a",
    keyIntensity: 0.45,
    shadowDarkness: 0.4,
  },
  {
    name: "blueHour",
    hour: 21,
    clear: "#101d11",
    fillColor: "#6a7cb8",
    fillGround: "#22302a",
    fillIntensity: 0.4,
    keyColor: "#ffb070",
    keyIntensity: 0,
    shadowDarkness: 1,
  },
  {
    name: "night",
    hour: 23,
    clear: "#0b160c",
    fillColor: "#5b6f9e",
    fillGround: "#1c2a26",
    fillIntensity: 0.34,
    keyColor: "#9fb4e8",
    keyIntensity: 0.18,
    shadowDarkness: 0.6,
  },
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
