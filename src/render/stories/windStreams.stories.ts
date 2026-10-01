/**
 * Wind streams (core/windStreams.ts, drawn by render/windStreams.ts): the
 * difficulty layer that arrives on the second game day.
 *
 *   - PathLoss: a plane flies a drawn path straight into an active stream:
 *               the path line vanishes (and the game's "Path lost — wind"
 *               toast shows) and the plane is pushed off along the wind
 *               while shaking harder (STREAM_SHAKE in sceneSync.ts). A
 *               second stream starts in its warning phase (faint, dashed,
 *               still) and turns active later, so both looks play on a
 *               loop. A third is only forecast: the "Yellow warning of wind"
 *               strip at the top of the screen (ui/weatherAlerts.ts) shows,
 *               with its own tone, before it appears on the map. `sound`
 *               plays the gust and the forecast tone (click the canvas first).
 *   - BlackWind: a black stream (from the third game day) builds to its lethal
 *               peak: the band flickers red-orange, the "Extreme wind peaking"
 *               toast and the red warning strip show, and a plane flying into
 *               it is destroyed (crash cinematic, then the scene replays).
 *               `sound` plays the rumble (click the canvas first).
 *   - Live:     the real sim started 24 game hours in (as `seedShift` in core/state.ts does
 *               for `VITE_DEBUG_START_HOURS=24`: every runway open, streams
 *               from the first seconds), planes arriving as in the game.
 *               `timeScale` speeds it up.
 *
 * Tuning loop: WIND_* and BLACK_* in config.ts (size, timings, push, how many
 * streams, black share and peak window),
 * the look (WIND_COLOR, BLACK_WIND_COLOR, BLACK_WIND_ALERT_COLOR, PEAK_FLICKER_RATE,
 * WIND_SCROLL_SPEED, *_ALPHA, the wisps in
 * `makeWisps`, `makeOutline`) in render/windStreams.ts, STREAM_SHAKE / STREAM_SHAKE_EASE
 * in sceneSync.ts, the gust (`windGust`, LEVELS.windGust) and the black-wind rumble
 * (`blackWindRumble`, LEVELS.blackWind) in audio/sfx.ts,
 * the toasts in ui/eventToasts.ts, the forecast strip (WIND_FORECAST_SECONDS
 * in config.ts, `weatherAlerts`, the forecast tone `weatherWarning` in audio/sfx.ts).
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { GameAudio } from "../../audio/mixer";
import {
  BLACK_PEAK_DELAY,
  PLANE_SPEED,
  WIND_FORECAST_SECONDS,
  WIND_FORM_SECONDS,
  WIND_LENGTH,
  WIND_WIDTH,
} from "../../config";
import { createPlane } from "../../core/plane";
import { startGame, step } from "../../core/simulation";
import { createGameState } from "../../core/state";
import type { GameState, SimEvent, WindStream } from "../../core/types";
import { toastFor } from "../../ui/eventToasts";
import { noticesMarkup } from "../../ui/hudMarkup";
import { createWeatherStrip, weatherAlerts } from "../../ui/weatherAlerts";
import { MeshFactory } from "../meshes";
import { SceneSync } from "../sceneSync";
import { dragToPan, gameCamera, mountStage, type Stage } from "./stage";

const meta: Meta = { title: "Scene/Wind streams" };
export default meta;

/**
 * The game's HUD notices: the toast for sim events, and the weather warning
 * strip (ui/weatherAlerts.ts) for the state's forecast streams.
 */
function toaster(stage: Stage): {
  show: (event: SimEvent) => void;
  alerts: (state: GameState) => void;
} {
  stage.root.insertAdjacentHTML("beforeend", noticesMarkup());
  const strip = createWeatherStrip(stage.root.querySelector<HTMLElement>("#weatherAlerts")!);
  const el = stage.root.querySelector<HTMLElement>("#toast")!;
  let left = 0;
  const show = (event: SimEvent) => {
    const toast = toastFor(event);
    if (!toast) return;
    el.textContent = toast.text;
    el.style.color = toast.color;
    el.classList.remove("opacity-0");
    left = 2.5;
  };
  stage.scene.onBeforeRenderObservable.add(() => {
    if (left <= 0) return;
    left -= stage.engine.getDeltaTime() / 1000;
    if (left <= 0) el.classList.add("opacity-0");
  });
  return { show, alerts: (state) => strip.update(weatherAlerts(state)) };
}

/** Sound for a story: the game's mixer, started by a click on the canvas. */
function storyAudio(stage: Stage, enabled: boolean): GameAudio | null {
  if (!enabled) return null;
  const audio = new GameAudio(null);
  audio.setMusicOn(false);
  audio.setScene("playing");
  stage.canvas.addEventListener("pointerdown", () => audio.unlock());
  stage.engine.onDisposeObservable.add(() => audio.close());
  return audio;
}

// ---------------------------------------------------------------------------
// PathLoss
// ---------------------------------------------------------------------------

interface PathLossArgs {
  sound: boolean;
  /** Seconds before the scene restarts. */
  replayAfter: number;
  timeScale: number;
}

/** A drawn path flown into an active stream, beside a stream still forming. */
export const PathLoss: StoryObj<PathLossArgs> = {
  argTypes: {
    replayAfter: { control: { type: "range", min: 10, max: 60, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 3, step: 0.05 } },
  },
  args: { sound: false, replayAfter: 24, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, 0, 1.3);
      dragToPan(stage, cam.controller);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      const { show, alerts } = toaster(stage);
      const audio = storyAudio(stage, args.sound);
      const { world } = state;
      const mid = { x: world.width / 2, y: world.height / 2 };

      const stageScene = () => {
        state.phase = "playing";
        state.planes = [];
        state.spawnTimer = -1e9; // nothing arrives: only the staged plane
        state.departureTimer = -1e9;
        // One stream already active, blowing down the screen (+y) across
        // the plane's way; one still forming beside it.
        const active: WindStream = {
          id: 1,
          black: false,
          age: WIND_FORM_SECONDS,
          rect: {
            center: { x: mid.x, y: mid.y },
            heading: Math.PI / 2,
            length: WIND_LENGTH,
            width: WIND_WIDTH,
          },
        };
        const forming: WindStream = {
          id: 2,
          black: false,
          age: 0,
          rect: {
            center: { x: mid.x + 30, y: mid.y - 10 },
            heading: Math.PI / 4,
            length: WIND_LENGTH,
            width: WIND_WIDTH,
          },
        };
        // And one only forecast: the HUD strip warns of it, then it starts
        // forming on the map (nothing is drawn for it before).
        const forecast: WindStream = {
          id: 3,
          black: false,
          age: -WIND_FORECAST_SECONDS,
          rect: {
            center: { x: mid.x - 25, y: mid.y + 28 },
            heading: -Math.PI / 4,
            length: WIND_LENGTH,
            width: WIND_WIDTH,
          },
        };
        state.streams = [active, forming, forecast];
        state.nextStreamId = 4;
        state.windTimer = 1e9; // no more: the two staged ones only
        // A plane heading east along a drawn path that runs through the
        // active band.
        const plane = createPlane(state.nextPlaneId++, "red", { x: mid.x - 35, y: mid.y }, 0);
        plane.canDepart = false;
        plane.path = [1, 2, 3, 4, 5, 6].map((i) => ({ x: mid.x - 35 + i * 14, y: mid.y }));
        plane.pathVersion++;
        state.planes = [plane];
        state.elapsed = 400; // past the first game day, for the wind level
      };
      stageScene();

      let time = 0;
      let sinceStart = 0;
      return (dt) => {
        time += dt;
        sinceStart += dt;
        for (const event of step(state, dt)) {
          show(event);
          audio?.onSimEvent(event, (id) => sync.panFor(id));
        }
        if (sinceStart >= args.replayAfter) {
          sinceStart = 0;
          stageScene();
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        alerts(state);
        if (audio) for (const cue of sync.takeAudioCues()) audio.cue(cue);
      };
    }, args.timeScale),
};

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
      /** Seconds from the start until the stream's lethal peak opens. */
      const PEAK_IN = 6;

      const stageScene = () => {
        cam.controller.release();
        state.phase = "playing";
        state.spawnTimer = -1e9; // nothing arrives: only the staged plane
        state.departureTimer = -1e9;
        state.windTimer = 1e9; // no more streams
        state.elapsed = 800; // past the first days, for the wind level
        // A black stream across the plane's way. It is in its build-up
        // (flickering) as the plane approaches, and the peak opens
        // `PEAK_IN` seconds in, with the plane just inside the band.
        const stream: WindStream = {
          id: 1,
          black: true,
          age: WIND_FORM_SECONDS + BLACK_PEAK_DELAY - PEAK_IN,
          rect: {
            center: { ...mid },
            heading: Math.PI / 2,
            length: WIND_LENGTH,
            width: WIND_WIDTH,
          },
        };
        state.streams = [stream];
        state.nextStreamId = 2;
        // Heading east: it reaches the band's middle half a second after
        // the peak opens (the band is WIND_WIDTH across, ~1.7 s to cross).
        const plane = createPlane(
          state.nextPlaneId++,
          "red",
          { x: mid.x - PLANE_SPEED * (PEAK_IN + 0.5), y: mid.y },
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
            // A new plane id clears the wreckage; fly it all again.
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

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

interface LiveArgs {
  /** Game hours to start in (24 = second day: streams from the start). */
  startHours: number;
  sound: boolean;
  timeScale: number;
}

/** The real sim on the second day: streams come and go, planes arrive. */
export const Live: StoryObj<LiveArgs> = {
  argTypes: {
    startHours: { control: { type: "range", min: 0, max: 96, step: 24 } },
    timeScale: { control: { type: "range", min: 0.5, max: 4, step: 0.5 } },
  },
  args: { startHours: 24, sound: false, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, 0, 1);
      dragToPan(stage, cam.controller);
      const state: GameState = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      startGame(state, Math.random, args.startHours);
      sync.rebuildWorld(state);
      const { show, alerts } = toaster(stage);
      const audio = storyAudio(stage, args.sound);

      let time = 0;
      return (dt) => {
        time += dt;
        for (const event of step(state, dt)) {
          show(event);
          audio?.onSimEvent(event, (id) => sync.panFor(id));
        }
        // A crash ends the shift: start again so the story keeps playing.
        if (state.phase === "gameover") startGame(state, Math.random, args.startHours);
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        alerts(state);
        if (audio) for (const cue of sync.takeAudioCues()) audio.cue(cue);
      };
    }, args.timeScale),
};
