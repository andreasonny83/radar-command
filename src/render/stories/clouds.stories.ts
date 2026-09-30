/**
 * Clouds (core/clouds.ts, drawn by render/clouds.ts): the visual difficulty
 * layer that starts at game hour 30 (`CLOUD_START_HOURS`): formations of
 * cumulus (banks, streets, lone ones) with their shadows on the ground, and
 * high cirrus wisps above.
 *
 *   - Gallery: every picture (render/cloudTextures.ts) flat on a grass
 *            backdrop, by day and by night tint, to judge the shapes and
 *            their baked shading without the game around them.
 *   - Cover: the clouds frozen at one point of the ramp (`hours` into the
 *            shift, 30 = first cloud, 54 = all of them), over planes flying
 *            as in the game, to judge how much they hide. `night` tints them
 *            the way the game does after dusk.
 *   - Live:  the real sim from `startHours` (the game's
 *            `VITE_DEBUG_START_HOURS`): clouds fade in and drift as the
 *            shift runs. `timeScale` speeds it up.
 *
 * Tuning loop: CLOUD_* in config.ts (start hour, counts, size, drift,
 * opacity, altitudes, shadow), the pictures (layouts, noise, shading) in
 * render/cloudTextures.ts, DAY_COLOR / NIGHT_COLOR in render/clouds.ts.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { CLOUD_FULL_HOURS, CLOUD_START_HOURS } from "../../config";
import { CIRRUS_ASPECT, CIRRUS_VARIANTS, CLOUD_SHAPES, FORMATION_ASPECT } from "../../core/clouds";
import { DAY_SECONDS } from "../../core/daytime";
import { startGame, step } from "../../core/simulation";
import { createGameState } from "../../core/state";
import { CIRRUS_WIDTH, FORMATION_WIDTH, paintCirrus, paintFormation } from "../cloudTextures";
import { MeshFactory } from "../meshes";
import { SceneSync } from "../sceneSync";
import { dragToPan, gameCamera, mountStage } from "./stage";

const meta: Meta = { title: "Scene/Clouds" };
export default meta;

/** Seconds of play per game hour. */
const HOUR_SECONDS = DAY_SECONDS / 24;

/**
 * A canvas with one picture painted on it, in a labelled frame. `tint`
 * multiplies the colour of every pixel like the night material does (all 1
 * = day).
 */
function picture(
  label: string,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  tint: readonly [number, number, number],
): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "m-0";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  paint(ctx);
  const image = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    for (let c = 0; c < 3; c++) image.data[i + c] = image.data[i + c]! * tint[c]!;
  }
  ctx.putImageData(image, 0, 0);
  figure.append(canvas);
  const caption = document.createElement("figcaption");
  caption.className = "mt-1 font-mono text-xs text-slate-200";
  caption.textContent = label;
  figure.append(caption);
  return figure;
}

/** Every cloud picture on a grass backdrop, by day and with the night tint. */
export const Gallery: StoryObj = {
  render: () => {
    const root = document.createElement("div");
    root.className = "h-full overflow-auto p-4";
    root.style.background = "#4a8a3a";
    const formationHeight = Math.round(FORMATION_WIDTH * FORMATION_ASPECT);
    const cirrusHeight = Math.round(CIRRUS_WIDTH * CIRRUS_ASPECT);
    for (const [name, tint] of [
      ["day", [1, 1, 1]],
      ["night", [0.27, 0.31, 0.43]],
    ] as const) {
      const row = document.createElement("div");
      row.className = "mb-6 flex flex-wrap gap-4";
      CLOUD_SHAPES.forEach((shape, i) => {
        row.append(
          picture(
            `${name}: ${shape} #${i}`,
            FORMATION_WIDTH,
            formationHeight,
            (ctx) => paintFormation(ctx, shape, 1000 + i * 97, FORMATION_WIDTH, formationHeight),
            tint,
          ),
        );
      });
      for (let i = 0; i < CIRRUS_VARIANTS; i++) {
        row.append(
          picture(
            `${name}: cirrus #${i}`,
            CIRRUS_WIDTH,
            cirrusHeight,
            (ctx) => paintCirrus(ctx, 500 + i * 53, CIRRUS_WIDTH, cirrusHeight),
            tint,
          ),
        );
      }
      root.append(row);
    }
    return root;
  },
};

interface CoverArgs {
  /** Game hours into the shift the clouds are frozen at. */
  hours: number;
  /** 0 day … 1 night. */
  night: number;
}

/** The clouds frozen at one point of their ramp, over live traffic. */
export const Cover: StoryObj<CoverArgs> = {
  argTypes: {
    hours: {
      control: {
        type: "range",
        min: CLOUD_START_HOURS,
        max: CLOUD_START_HOURS + CLOUD_FULL_HOURS,
        step: 1,
      },
    },
    night: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
  },
  args: { hours: CLOUD_START_HOURS + CLOUD_FULL_HOURS, night: 0 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      dragToPan(stage, cam.controller);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      startGame(state, Math.random, 24);
      sync.rebuildWorld(state);
      sync.setNight(args.night);

      let time = 0;
      return (dt) => {
        time += dt;
        step(state, dt);
        // A crash ends the shift: start again so the story keeps playing.
        if (state.phase === "gameover") startGame(state, Math.random, 24);
        // Hold the clouds still at the chosen hour (the sim clock keeps running).
        const real = state.elapsed;
        state.elapsed = args.hours * HOUR_SECONDS;
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        state.elapsed = real;
      };
    }),
};

interface LiveArgs {
  /** Game hours to start in (30 = the first cloud shows at once). */
  startHours: number;
  timeScale: number;
}

/** The real sim: clouds fade in one by one and drift while planes arrive. */
export const Live: StoryObj<LiveArgs> = {
  argTypes: {
    startHours: { control: { type: "range", min: 0, max: 60, step: 6 } },
    timeScale: { control: { type: "range", min: 0.5, max: 8, step: 0.5 } },
  },
  args: { startHours: CLOUD_START_HOURS, timeScale: 4 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      dragToPan(stage, cam.controller);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      startGame(state, Math.random, args.startHours);
      sync.rebuildWorld(state);

      let time = 0;
      return (dt) => {
        time += dt;
        step(state, dt);
        if (state.phase === "gameover") startGame(state, Math.random, args.startHours);
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }, args.timeScale),
};
