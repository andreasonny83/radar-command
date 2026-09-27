/**
 * Gameplay visuals through the real SceneSync, so everything draws exactly
 * as in the game:
 *
 *   - Markers:  a frozen moment staged by hand: drawn path lines, a pair of
 *               planes close enough for warning rings, a path anchored
 *               onto a runway threshold (green ring, re-anchored on a loop
 *               so its hold-and-fade replays), the free-path plane
 *               hovered by the pointer on a loop (white ring, slight
 *               swell; the `hover` arg holds it on), and two planes still
 *               off-screen on their way in, with their arrival arrows. The
 *               sim doesn't run, but the render clock does, so rings pulse
 *               and wind blows.
 *   - Crash:    two planes flown into each other by the real sim, on a
 *               loop: the crash cinematic (camera glide, zoom and slow
 *               orbit) with the fireball, falling wrecks, debris, fire and
 *               smoke, and the see-through game-over panel on its delay.
 *   - Landing:  one plane flown by the real sim down an anchored path from
 *               well outside the airspace, on a loop: it descends from
 *               OUTER_FLIGHT_ALTITUDE as it crosses the edge, glides down
 *               the approach, flares, taxis to a stand. Its model scales
 *               with height (ALTITUDE_SCALE_PER_UNIT), so it shrinks on
 *               the way down and is smallest on the ground. The gear
 *               extends on final (GEAR_DOWN_DISTANCE); with `sound` (click
 *               the canvas first) the gear whine and clunk, touchdown chirp,
 *               reverse thrust and rollout rumble play in step with it.
 *   - OuterTraffic: planes crossing paths outside the airspace (magenta
 *               dashed edge), flown by the real flight model with the
 *               automatic collision avoidance on or off: head-on, crossing
 *               and converging arrivals all swerve apart, then resume
 *               course. Replays on a loop.
 *   - Departure: one violet departure (core/departures.ts) flown by the
 *               real sim, on a loop: out of its hangar, onto the stand,
 *               cleared, along the taxiway and connector, backtracking down
 *               the runway, U-turn, line-up, take-off roll, rotation,
 *               lift-off, climb and level-off along its dotted route, with
 *               the toasts the game shows. `follow` rides along with the
 *               camera; `sound` plays the chime and engines (click the
 *               canvas first: browsers only start audio after a gesture).
 *   - LiveGame: the whole game (sim, input, HUD) in a story, with slow motion
 *               (`showAirspace` draws the airspace edge). Right-click a
 *               plane to follow it, with the "track plane active" badge
 *               bottom-left; right-click again to return (`autoFollow`
 *               follows the first plane; `sound` plays all the game's audio
 *               after a click on the canvas). Follow: FOLLOW_ZOOM in
 *               config.ts, `follow` / `returnFromFollow` / `trackPlane` in
 *               camera.ts, the badge in ui/hudMarkup.ts + style.css.
 *
 * Tuning loop: PATH_* / ANCHOR_RING_* / HOVER_* / YAW_EASE / BANK_EASE in sceneSync.ts, ring sizes and
 * colours in meshes.ts, arrow placement in arrivals.ts, arrow look in
 * ui/hudMarkup.ts, distances (AIRSPACE_MARGIN, VIEW_MARGIN, ARRIVAL_WARNING…)
 * in config.ts. Outer traffic: AVOID_SEPARATION / AVOID_LOOKAHEAD /
 * AVOID_MAX_TURN in config.ts, the manoeuvre itself in core/avoidance.ts.
 * Crash: CRASH_ZOOM / CRASH_FRAME_LIFT / CRASH_ORBIT_* / CRASH_OVERLAY_DELAY in config.ts,
 * WRECK_* / DEBRIS_* / FLASH_* / SCORCH_* / SMOKE_DRIFT and the particle
 * set-ups in crash.ts, FOCUS_EASE_RATE in camera.ts, CRASH_BACKDROP in
 * ui/hud.ts.
 * Landing: FLIGHT_ALTITUDE / OUTER_FLIGHT_ALTITUDE / ALTITUDE_TRANSITION /
 * APPROACH_DISTANCE / THRESHOLD_ALTITUDE / ALTITUDE_SCALE_PER_UNIT and
 * FLARE_DISTANCE in config.ts, MAX_VERTICAL_SPEED in sceneSync.ts.
 * Departure: DEPARTURE_* / BACKTRACK_SPEED / LINEUP_* / TAKEOFF_ACCEL /
 * ROTATE_SPEED / CLIMB_ACCEL / CLIMB_DISTANCE in config.ts, the route and
 * procedure (`planDepartureRoute`) in core/departures.ts, DEPARTURE_DOT_* /
 * ROTATION_* / CLIMB_PITCH_GAIN in sceneSync.ts, the connector in
 * render/airfield.ts, chime and engine sound in audio/sfx.ts (mixed by
 * audio/mixer.ts; the background music has its own story, "Audio/Music").
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { GameAudio } from "../../audio/mixer";
import {
  CRASH_OVERLAY_DELAY,
  PATH_MIN_SPACING,
  PLANE_SPEED,
  ROTATE_STEP,
  WARNING_DISTANCE,
  ZOOM_MIN,
  ZOOM_STEP,
} from "../../config";
import { headingVector, mulberry32 } from "../../core/math";
import { createDeparture } from "../../core/departures";
import { anchorPath, appendPathPoint } from "../../core/path";
import { resolveOuterTraffic } from "../../core/avoidance";
import { airspaceBounds, isInAirspace } from "../../core/layout";
import { createPlane, updatePlane } from "../../core/plane";
import { startGame, step, togglePause } from "../../core/simulation";
import { pickSpawn } from "../../core/spawner";
import { createGameState } from "../../core/state";
import type { GameState, Plane, RunwayColor, Vec2 } from "../../core/types";
import { attachPointerInput } from "../../input/pointer";
import { createArrivalArrows } from "../../ui/arrivalArrows";
import { createHud } from "../../ui/hud";
import { toastFor } from "../../ui/eventToasts";
import { arrivalLayerMarkup, toastMarkup } from "../../ui/hudMarkup";
import { arrivalMarkers } from "../arrivals";
import { MeshFactory } from "../meshes";
import { ANCHOR_RING_FADE, ANCHOR_RING_HOLD, SceneSync } from "../sceneSync";
import { trackPlane } from "../camera";
import { gameCamera, mountStage, type Stage } from "./stage";

const DEG = Math.PI / 180;

/**
 * The game's audio for a story, or null when `enabled` is off. Sound starts
 * on the first click on the canvas (browsers only allow audio after a
 * gesture) and stops with the stage. No storage: the story's args decide,
 * not the player's saved settings.
 */
function storyAudio(stage: Stage, enabled: boolean, music = false): GameAudio | null {
  if (!enabled) return null;
  const audio = new GameAudio(null);
  audio.setMusicOn(music);
  audio.setScene("playing");
  stage.canvas.addEventListener("pointerdown", () => audio.unlock());
  stage.engine.onDisposeObservable.add(() => audio.close());
  return audio;
}

/**
 * Per frame, after `sync.syncPlanes`: play this frame's animation cues and
 * let the engines, rollouts and ambience follow `state` (as main.ts does).
 */
function playFrame(audio: GameAudio | null, sync: SceneSync, state: GameState): void {
  if (!audio) return;
  for (const cue of sync.takeAudioCues()) audio.cue(cue);
  audio.update(state, (id) => sync.panFor(id));
}

const meta: Meta = { title: "Scene/Gameplay" };
export default meta;

// ---------------------------------------------------------------------------
// Markers (hand-staged state)
// ---------------------------------------------------------------------------

/** `steps` points along a quadratic Bézier from a to c (control point b), excluding a. */
function curve(a: Vec2, b: Vec2, c: Vec2, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    });
  }
  return out;
}

/** Give `plane` a drawn path (and bump its version so SceneSync draws it). */
function setPath(plane: Plane, path: Vec2[], anchored = false): void {
  plane.path = path;
  plane.pathAnchored = anchored;
  plane.pathVersion++;
}

/**
 * Stage a scene: one plane on an anchored approach to the first runway, one
 * with a free path, and two converging planes inside `WARNING_DISTANCE`.
 */
function stageMarkers(state: GameState): void {
  const { world, runways } = state;
  const planes: Plane[] = [];
  const target = runways[0];

  if (target) {
    // Approach from well behind the threshold, curving in along the heading.
    const dir = headingVector(target.heading);
    const start = { x: target.threshold.x - dir.x * 30 + 12, y: target.threshold.y - dir.y * 30 };
    const bend = { x: target.threshold.x - dir.x * 12, y: target.threshold.y - dir.y * 12 };
    const approach = createPlane(1, target.color, start, target.heading);
    setPath(approach, curve(start, bend, target.threshold, 16), true);
    planes.push(approach);
  }

  // A free path wandering across the field.
  const wanderer = createPlane(2, "blue", { x: world.width * 0.15, y: world.height * 0.2 }, 0);
  setPath(
    wanderer,
    curve(
      wanderer.pos,
      { x: world.width * 0.5, y: world.height * 0.05 },
      { x: world.width * 0.6, y: world.height * 0.4 },
      20,
    ),
  );
  planes.push(wanderer);

  // Two planes converging: close enough to warn, not to crash.
  const mid = { x: world.width * 0.55, y: world.height * 0.55 };
  const gap = WARNING_DISTANCE * 0.35;
  const a = createPlane(3, "yellow", { x: mid.x - gap, y: mid.y }, 20 * DEG);
  const b = createPlane(4, "red", { x: mid.x + gap, y: mid.y }, 160 * DEG);
  a.warning = b.warning = true;
  planes.push(a, b);

  // Two arrivals, placed exactly as the spawner would (seeded, so the story
  // is the same every time): still off-screen, so they show as arrows.
  const rng = mulberry32(11);
  for (const id of [5, 6]) {
    const spec = pickSpawn(world, state.viewAspect, ["red", "blue", "yellow"], rng);
    const inbound = createPlane(id, spec.color, spec.pos, spec.heading);
    inbound.inbound = true;
    inbound.entry = spec.entry;
    planes.push(inbound);
  }

  state.planes = planes;
}

interface MarkersArgs {
  rotationDeg: number;
  zoom: number;
  /** Keep the hover highlight on, instead of toggling it on a loop. */
  hover: boolean;
}

export const Markers: StoryObj<MarkersArgs> = {
  argTypes: {
    rotationDeg: { control: { type: "range", min: -180, max: 180, step: 15 } },
    zoom: { control: { type: "range", min: ZOOM_MIN, max: 2.5, step: 0.05 } },
  },
  args: { rotationDeg: 0, zoom: 1, hover: false },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      stageMarkers(state);
      stage.root.insertAdjacentHTML("beforeend", arrivalLayerMarkup());
      const arrows = createArrivalArrows(stage.root.querySelector<HTMLElement>("#arrivals")!);
      // Re-anchor the approach every so often (unanchored for one frame), so
      // the anchor ring's hold-and-fade plays again with a pause between.
      const approach = state.planes.find((p) => p.pathAnchored);
      const replayEvery = ANCHOR_RING_HOLD + ANCHOR_RING_FADE + 1.5;
      let sinceAnchor = 0;
      // The free-path plane (id 2) is "hovered": 1.5 s on, 1.5 s off, so the
      // ring's ease in and out shows too (see HOVER_EASE in sceneSync.ts).
      const hovered = new Set([2]);
      const none = new Set<number>();
      return (dt, time) => {
        if (approach) {
          sinceAnchor += dt;
          approach.pathAnchored = sinceAnchor < replayEvery;
          if (!approach.pathAnchored) sinceAnchor = 0;
        }
        sync.setHighlighted(args.hover || time % 3 < 1.5 ? hovered : none);
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        arrows.update(arrivalMarkers(state, stage.scene, stage.canvas));
      };
    }),
};

// ---------------------------------------------------------------------------
// Crash
// ---------------------------------------------------------------------------

interface CrashArgs {
  /** Angle between the two planes' headings (180 = head-on). */
  angleDeg: number;
  /** Seconds after the crash before the whole thing replays. */
  replayAfter: number;
  /** Show the game-over panel (on its CRASH_OVERLAY_DELAY), as in the game. */
  overlay: boolean;
  timeScale: number;
}

/**
 * Put two planes on a collision course over the middle of the field, about
 * a second apart, and nothing else in the sky (spawning held off).
 */
function stageCrash(state: GameState, angleDeg: number): void {
  const { world } = state;
  const meet = { x: world.width * 0.46, y: world.height * 0.34 };
  // Each plane starts ~1.2 s of flight back along its own course.
  const back = PLANE_SPEED * 1.2;
  const half = (angleDeg * DEG) / 2;
  const headings = [-half, Math.PI + half];
  const colors = ["red", "blue"] as const;
  state.planes = headings.map((h, i) => {
    const dir = headingVector(h);
    const start = { x: meet.x - dir.x * back, y: meet.y - dir.y * back };
    return createPlane(state.nextPlaneId++, colors[i]!, start, h);
  });
  state.phase = "playing";
  state.spawnTimer = -1e9; // no other traffic
}

export const Crash: StoryObj<CrashArgs> = {
  argTypes: {
    angleDeg: { control: { type: "range", min: 30, max: 180, step: 5 } },
    replayAfter: { control: { type: "range", min: 4, max: 40, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 2, step: 0.05 } },
  },
  args: { angleDeg: 150, replayAfter: 14, overlay: true, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      const hud = createHud(stage.root, {
        onStart: () => (sinceCrash = args.replayAfter), // "TRY AGAIN" replays now
        onTogglePause: () => undefined,
        onRotate: (dir) => cam.controller.rotateBy(dir * ROTATE_STEP),
        onZoom: (dir) => cam.controller.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
      });
      hud.hideOverlay();
      stageCrash(state, args.angleDeg);

      let time = 0;
      /** Seconds since the crash, or null before it. */
      let sinceCrash: number | null = null;
      return (dt) => {
        time += dt;
        for (const event of step(state, dt)) {
          if (event.type !== "crash") continue;
          const site = sync.crash(event.planeIds);
          if (site) cam.controller.focusOn(site);
          sinceCrash = 0;
        }
        if (sinceCrash !== null) {
          const before = sinceCrash;
          sinceCrash += dt;
          if (args.overlay && before < CRASH_OVERLAY_DELAY && sinceCrash >= CRASH_OVERLAY_DELAY) {
            hud.showGameOver(state.score);
          }
          if (sinceCrash >= args.replayAfter) {
            // Clear the wreckage (new plane ids) and fly it all again.
            sinceCrash = null;
            hud.hideOverlay();
            cam.controller.release();
            stageCrash(state, args.angleDeg);
          }
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Landing (real sim, one plane)
// ---------------------------------------------------------------------------

interface LandingArgs {
  /** How far outside the airspace the plane starts (world units). */
  startOutside: number;
  /** Seconds before the approach replays (the plane may still be taxiing). */
  replayAfter: number;
  /**
   * Sound (click the canvas once to start it): gear whine and clunk on
   * final, the touchdown chirp and reverse thrust, the rollout rumble.
   */
  sound: boolean;
  timeScale: number;
}

/**
 * One red plane on the red runway's extended centreline, `startOutside`
 * units beyond the airspace edge, with a straight path drawn to the
 * threshold and anchored exactly as the pointer input would. Nothing else
 * flies (spawning held off).
 */
function stageLanding(state: GameState, startOutside: number): void {
  const runway = state.runways.find((r) => r.color === "red") ?? state.runways[0]!;
  const dir = headingVector(runway.heading);
  // Walk back along the approach until clear of the airspace, then further.
  const bounds = airspaceBounds(state.world);
  const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  let back = 0;
  const at = (d: number): Vec2 => ({
    x: runway.threshold.x - dir.x * d,
    y: runway.threshold.y - dir.y * d,
  });
  while (back < reach && isInAirspace(at(back), state.world)) back += 1;
  back += startOutside;

  const plane = createPlane(state.nextPlaneId++, runway.color, at(back), runway.heading);
  state.planes = [plane];
  // Draw the path point by point, trying to anchor after each (as input does).
  for (let d = back - PATH_MIN_SPACING; d > -PATH_MIN_SPACING; d -= PATH_MIN_SPACING) {
    appendPathPoint(plane, at(Math.max(0, d)));
    if (anchorPath(plane, state.runways, state.world)) break;
  }
  state.phase = "playing";
  state.spawnTimer = -1e9; // no other traffic
}

export const Landing: StoryObj<LandingArgs> = {
  argTypes: {
    startOutside: { control: { type: "range", min: 0, max: 40, step: 1 } },
    replayAfter: { control: { type: "range", min: 10, max: 60, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 3, step: 0.05 } },
  },
  args: { startOutside: 18, replayAfter: 34, sound: true, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      stageLanding(state, args.startOutside);
      const audio = storyAudio(stage, args.sound);

      let time = 0;
      let sinceStart = 0;
      return (dt) => {
        time += dt;
        sinceStart += dt;
        step(state, dt);
        if (sinceStart >= args.replayAfter) {
          sinceStart = 0;
          stageLanding(state, args.startOutside); // new plane id: fresh mesh
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        playFrame(audio, sync, state);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Departure (take-off from the field)
// ---------------------------------------------------------------------------

interface DepartureArgs {
  /** Runway the departure takes off from. */
  runway: RunwayColor;
  /** Camera rides along with the plane (as right-clicking it in the game). */
  follow: boolean;
  /** Chime and engines (click the canvas once to let the browser play audio). */
  sound: boolean;
  /** Background music under the effects too (audio/music.ts). */
  music: boolean;
  /** Seconds before it replays (a new departure from the same hangar). */
  replayAfter: number;
  timeScale: number;
}

/**
 * A fresh shift with nothing flying, and one departure for `color` in the
 * first hangar it can start from. Returns its id, or null if none fits.
 */
function stageDeparture(state: GameState, color: RunwayColor): number | null {
  state.planes = [];
  state.phase = "playing";
  state.spawnTimer = -1e9; // no arrivals
  state.departureTimer = -1e9; // and no scheduled departures either
  const runway = state.runways.find((r) => r.color === color) ?? state.runways[0]!;
  const stand = runway.airfield.stands[0]!;
  return createDeparture(state, runway, stand, mulberry32(state.nextPlaneId)).id;
}

export const Departure: StoryObj<DepartureArgs> = {
  argTypes: {
    runway: { control: "inline-radio", options: ["red", "blue", "yellow"] },
    replayAfter: { control: { type: "range", min: 20, max: 90, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 3, step: 0.05 } },
  },
  args: {
    runway: "red",
    follow: false,
    sound: true,
    music: false,
    replayAfter: 55,
    timeScale: 1,
  },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, 0, args.follow ? 1 : 1.6);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      // The game's toast, for the departure notices.
      stage.root.insertAdjacentHTML("beforeend", toastMarkup());
      const toast = stage.root.querySelector<HTMLElement>("#toast")!;
      let toastLeft = 0;

      const sfx = storyAudio(stage, args.sound, args.music);

      const begin = () => {
        const id = stageDeparture(state, args.runway);
        if (id !== null && args.follow) cam.controller.follow(trackPlane(() => state, id));
        // The sim announces a departure the scheduler makes; this one was
        // made by hand, so show (and chime) its notice here.
        show(toastFor({ type: "departureAnnounced", planeId: id ?? 0, color: args.runway }));
        sfx?.chime();
      };
      const show = (t: ReturnType<typeof toastFor>) => {
        if (!t) return;
        toast.textContent = t.text;
        toast.style.color = t.color;
        toast.classList.remove("opacity-0");
        toastLeft = 2.5;
      };
      begin();

      let time = 0;
      let sinceStart = 0;
      return (dt) => {
        time += dt;
        sinceStart += dt;
        for (const event of step(state, dt)) show(toastFor(event));
        if ((toastLeft -= dt) <= 0) toast.classList.add("opacity-0");
        if (sinceStart >= args.replayAfter) {
          sinceStart = 0;
          begin(); // new plane id: fresh mesh
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        playFrame(sfx, sync, state);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Outer traffic (automatic collision avoidance outside the airspace)
// ---------------------------------------------------------------------------

interface OuterTrafficArgs {
  /** Run the automatic avoidance (core/avoidance.ts); off, they fly through each other. */
  avoidance: boolean;
  /** Seconds before the encounters replay. */
  replayAfter: number;
  timeScale: number;
}

/**
 * Three encounters in the countryside round the airspace, each timed so
 * the planes would meet if nobody swerved:
 *
 * - head-on: two departures flying at each other above the field;
 * - crossing: two departures meeting at right angles left of it;
 * - converging: two arrivals whose tracks to the right-hand edge cross.
 */
function stageOuterTraffic(state: GameState): void {
  const b = airspaceBounds(state.world);
  const planes: Plane[] = [];
  const add = (color: Plane["color"], pos: Vec2, heading: number): Plane => {
    const plane = createPlane(state.nextPlaneId++, color, pos, heading);
    planes.push(plane);
    return plane;
  };
  const depart = (color: Plane["color"], pos: Vec2, heading: number) => {
    add(color, pos, heading).phase = "departing";
  };
  const arrive = (color: Plane["color"], pos: Vec2, entry: Vec2) => {
    const plane = add(color, pos, Math.atan2(entry.y - pos.y, entry.x - pos.x));
    plane.inbound = true;
    plane.entry = entry;
  };

  // Head-on, above the field: 50 units apart, closing at twice cruise speed.
  const topY = b.minY - 12;
  const midX = (b.minX + b.maxX) / 2;
  depart("red", { x: midX - 25, y: topY }, 0);
  depart("blue", { x: midX + 25, y: topY }, Math.PI);

  // Crossing at right angles left of the field, both reaching the same
  // point at the same moment.
  const leftX = b.minX - 12;
  const meetY = (b.minY + b.maxY) / 2;
  depart("yellow", { x: leftX, y: meetY - 22 }, Math.PI / 2);
  depart("red", { x: leftX - 22, y: meetY }, 0);

  // Converging arrivals right of the field, tracks crossing halfway in.
  const farX = b.maxX + 24;
  arrive("blue", { x: farX, y: meetY + 16 }, { x: b.maxX, y: meetY - 6 });
  arrive("yellow", { x: farX, y: meetY - 16 }, { x: b.maxX, y: meetY + 6 });

  state.planes = planes;
}

export const OuterTraffic: StoryObj<OuterTrafficArgs> = {
  argTypes: {
    replayAfter: { control: { type: "range", min: 4, max: 20, step: 0.5 } },
    timeScale: { control: { type: "range", min: 0.1, max: 3, step: 0.05 } },
  },
  args: { avoidance: true, replayAfter: 8, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      sync.setAirspaceVisible(true);
      stageOuterTraffic(state);

      let time = 0;
      let sinceStart = 0;
      return (dt) => {
        time += dt;
        sinceStart += dt;
        // The sim's move step on its own (see `step`): no spawns, landings
        // or crashes to get in the way.
        if (args.avoidance) resolveOuterTraffic(state.planes, state.world);
        for (const plane of state.planes) updatePlane(plane, dt, state.world);
        state.planes = state.planes.filter((p) => p.phase !== "departed");
        if (sinceStart >= args.replayAfter) {
          sinceStart = 0;
          stageOuterTraffic(state); // new plane ids: fresh meshes
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Live game
// ---------------------------------------------------------------------------

interface LiveArgs {
  /** Skip the start overlay and begin a shift straight away. */
  autoStart: boolean;
  /** Game speed: 0.25 = slow motion for watching turns, banking and landings. */
  timeScale: number;
  /** Draw the airspace edge, as `DEBUG_SHOW_AIRSPACE` does in the game. */
  showAirspace: boolean;
  /** Follow the shift's first plane, as right-clicking it would. */
  autoFollow: boolean;
  /** All the game's sound: effects, ambience and music (click the canvas to start it). */
  sound: boolean;
}

/**
 * The full game: draw paths with the mouse, land planes, crash, right-click
 * a plane to follow it. Uses the same modules as main.ts, minus
 * window-level listeners (keyboard, resize).
 */
export const LiveGame: StoryObj<LiveArgs> = {
  argTypes: { timeScale: { control: { type: "range", min: 0.1, max: 2, step: 0.05 } } },
  args: { autoStart: true, timeScale: 1, showAirspace: false, autoFollow: false, sound: false },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);

      /** Seconds until the game-over panel shows (see main.ts), or null. */
      let gameOverIn: number | null = null;
      const begin = () => {
        gameOverIn = null;
        cam.controller.release();
        startGame(state);
        hud.setScore(state.score);
        hud.hideOverlay();
        hud.setPhase(state.phase);
      };
      const hud = createHud(stage.root, {
        onStart: begin,
        onTogglePause: () => togglePause(state) && hud.setPhase(state.phase),
        onRotate: (dir) => cam.controller.rotateBy(dir * ROTATE_STEP),
        onZoom: (dir) => cam.controller.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
      });
      sync.setAirspaceVisible(args.showAirspace);
      const pointer = attachPointerInput(
        stage.canvas,
        stage.scene,
        cam.controller.camera,
        () => state,
        {
          onPan: (dx, dy) => cam.controller.dragBy(dx, dy),
          onFollow: (planeId) => follow(planeId),
          onPathDrawn: (_planeId, anchored) => audio?.readback(anchored),
        },
      );
      const audio = storyAudio(stage, args.sound, true);
      /** Same as main.ts: follow a plane, or right-click again to return. */
      const follow = (planeId: number | null) => {
        if (cam.controller.following) cam.controller.returnFromFollow();
        else if (planeId !== null) cam.controller.follow(trackPlane(() => state, planeId));
      };
      /** `autoFollow` picks the first plane once; after that it's up to the mouse. */
      let autoFollowed = false;
      if (args.autoStart) begin();

      let time = 0;
      return (dt) => {
        if (state.phase !== "paused") time += dt;
        for (const event of step(state, dt)) {
          audio?.onSimEvent(event, (id) => sync.panFor(id));
          if (event.type === "landed") hud.setScore(state.score);
          else if (event.type === "crash") {
            const site = sync.crash(event.planeIds);
            if (site) cam.controller.focusOn(site);
            gameOverIn = CRASH_OVERLAY_DELAY;
            hud.setPhase(state.phase);
          } else {
            const toast = toastFor(event);
            if (toast) hud.showToast(toast.text, toast.color);
          }
        }
        if (gameOverIn !== null && (gameOverIn -= dt) <= 0) {
          gameOverIn = null;
          hud.showGameOver(state.score);
        }
        if (args.autoFollow && !autoFollowed && state.planes[0]) {
          autoFollowed = true;
          follow(state.planes[0].id);
        }
        cam.frame(dt, time);
        hud.setTracking(cam.controller.following);
        sync.setHighlighted(pointer.refreshHover());
        sync.syncPlanes(state, time);
        audio?.setScene(
          state.phase === "gameover" ? "crash" : state.phase === "paused" ? "paused" : "playing",
        );
        playFrame(audio, sync, state);
        hud.setArrivals(arrivalMarkers(state, stage.scene, stage.canvas));
      };
    }, args.timeScale),
};
