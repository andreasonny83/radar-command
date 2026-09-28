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
import { gameCamera, mountStage, type FrameFn, type Stage } from "./stage";

/** Live traffic that never stops: a crash just starts a new shift. */
function keepFlying(state: GameState, dt: number): void {
  step(state, dt);
  if (state.phase === "gameover") startGame(state);
}

/**
 * Build the scene and return a frame function that lights it for the hour
 * `hourAt(time)` returns.
 */
function frameWith(stage: Stage, hourAt: (time: number) => number): FrameFn {
  const cam = gameCamera(stage);
  const state = createGameState(stage.aspect());
  const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
  sync.rebuildWorld(state);
  startGame(state);
  const day = new DayCycle(stage);
  return (dt, time) => {
    keepFlying(state, dt);
    day.setHours(hourAt(time));
    sync.setNight(day.night);
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

/** "6.5" → "06:30", for story names. */
function hourLabel(hour: number): string {
  const m = Math.round(hour * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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
    name: `${name} (${hourLabel(base.hour)})`,
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
        // Field by field, in DayKeyframe order, so the snippet reads like
        // the source (and stray Storybook args never leak into it).
        const edited: DayKeyframe = {
          name,
          hour: base.hour,
          clear: hexOr(args.clear, base.clear),
          fillColor: hexOr(args.fillColor, base.fillColor),
          fillGround: hexOr(args.fillGround, base.fillGround),
          fillIntensity: args.fillIntensity,
          keyColor: hexOr(args.keyColor, base.keyColor),
          keyIntensity: args.keyIntensity,
          shadowDarkness: args.shadowDarkness,
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
