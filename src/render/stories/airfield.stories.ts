/**
 * Static world pieces at real game scale: a single runway with its taxiway,
 * the departures' U-shaped connector onto the runway's far end (with its
 * hold-short bars; see core/departures.ts) and hangars, blue and yellow's
 * crossing runways, the whole airfield
 * layout, and the landscape around it.
 *
 * Tuning loop: runway markings/lights live in runway.ts, taxiways and
 * hangars in airfield.ts, the layout and sizes in config.ts (RUNWAY_*,
 * CROSSING_*, TAXIWAY_*, STAND_*, HANGAR_*, DEPARTURE_ENTRY_U, STREAM_*, TREE_*, AIRSPACE_MARGIN,
 * VIEW_MARGIN, MAP_MARGIN, ZOOM_MIN), colours in landscape.ts. Save and the
 * story rebuilds. The magenta dashed outline (`showBoundary`) is the
 * airspace edge, for tuning AIRSPACE_MARGIN. Boats have their own stories
 * in "Scene/River".
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  COLOR_HEX,
  CROSSING_ANGLE,
  CROSSING_BISECTOR,
  CROSSING_EXIT_U,
  RUNWAY_LENGTH,
  RUNWAY_THRESHOLD_INSET,
  RUNWAY_WIDTH,
  ZOOM_MIN,
} from "../../config";
import { layoutAirfield } from "../../core/airfield";
import { layoutRunways } from "../../core/layout";
import { headingVector } from "../../core/math";
import type { Runway, RunwayColor } from "../../core/types";
import { AirfieldFactory } from "../airfield";
import { AirspaceBoundary } from "../boundary";
import { Landscape } from "../landscape";
import { MeshFactory } from "../meshes";
import { RunwayFactory, type RunwayView } from "../runway";
import { fitShadowsToWorld } from "../scene";
import { gameCamera, groundPad, mountStage, orbitCamera } from "./stage";

const DEG = Math.PI / 180;

interface AirfieldArgs {
  /** Camera heading on top of the default view (degrees). */
  rotationDeg: number;
  /** Camera zoom, as the "+" / "−" buttons set it (ZOOM_MIN–2.5). */
  zoom: number;
  /**
   * Show the airspace edge. Players never see it; the game only draws it
   * with `DEBUG_SHOW_AIRSPACE` on, for tuning `AIRSPACE_MARGIN`.
   */
  showBoundary: boolean;
}

const meta: Meta = { title: "Scene/Airfield" };
export default meta;

// ---------------------------------------------------------------------------
// Single runway
// ---------------------------------------------------------------------------

interface RunwayArgs {
  color: RunwayColor;
  /** Landing direction (degrees, sim convention: 0 = +x, 90 = down the screen). */
  headingDeg: number;
  length: number;
  width: number;
}

/**
 * One runway with its taxiway, apron and hangars on a grass pad, close up.
 * Drag to orbit, wheel to zoom. Length and width override RUNWAY_LENGTH /
 * RUNWAY_WIDTH for quick experiments (the taxiway layout doesn't follow).
 */
export const SingleRunway: StoryObj<RunwayArgs> = {
  argTypes: {
    color: { control: "inline-radio", options: Object.keys(COLOR_HEX) },
    headingDeg: { control: { type: "range", min: -180, max: 180, step: 5 } },
    length: { control: { type: "range", min: 10, max: 80, step: 1 } },
    width: { control: { type: "range", min: 2, max: 12, step: 0.5 } },
  },
  args: { color: "blue", headingDeg: 0, length: RUNWAY_LENGTH, width: RUNWAY_WIDTH },
  render: (args) =>
    mountStage((stage) => {
      const factory = new MeshFactory(stage.scene);
      const runways = new RunwayFactory(stage.scene, (c) => factory.material(c));
      groundPad(stage, args.length * 8);
      // A world centred on the runway, so toScene puts it at the origin.
      const world = { width: 100, height: 100 };
      const heading = args.headingDeg * DEG;
      const center = { x: 50, y: 50 };
      const dir = headingVector(heading);
      const back = args.length / 2 - RUNWAY_THRESHOLD_INSET;
      const runway: Runway = {
        color: args.color,
        center,
        heading,
        length: args.length,
        width: args.width,
        threshold: { x: center.x - dir.x * back, y: center.y - dir.y * back },
        airfield: layoutAirfield(args.color, center, heading, 1, 0),
      };
      const view = runways.create(runway, world);
      new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows).create(
        runway,
        world,
      );
      orbitCamera(stage, Vector3.Zero(), args.length * 0.9);
      // Approach "rabbit" lights sweep towards the threshold.
      return (_dt, time) => view.update(time);
    }),
};

// ---------------------------------------------------------------------------
// Crossing runways
// ---------------------------------------------------------------------------

interface CrossingArgs {
  /** Angle between the two runways (degrees). Game: CROSSING_ANGLE. */
  angleDeg: number;
  /** Heading halfway between the landing directions. Game: CROSSING_BISECTOR. */
  bisectorDeg: number;
  /** Where each turnoff leaves its runway. Game: CROSSING_EXIT_U. */
  exitU: number;
}

/**
 * Blue and yellow's shared airport close up: two runways crossing in an X,
 * each apron on its runway's outer side. Shows how the intersection is
 * painted (blue, listed first, keeps its centreline; edge lines and lights
 * stop at the other strip). Drag to orbit, wheel to zoom. The controls
 * override the CROSSING_* constants for quick experiments.
 */
export const CrossingRunways: StoryObj<CrossingArgs> = {
  argTypes: {
    angleDeg: { control: { type: "range", min: 20, max: 90, step: 5 } },
    bisectorDeg: { control: { type: "range", min: -180, max: 180, step: 5 } },
    exitU: { control: { type: "range", min: -5, max: 12, step: 0.5 } },
  },
  args: {
    angleDeg: Math.round(CROSSING_ANGLE / DEG),
    bisectorDeg: Math.round(CROSSING_BISECTOR / DEG),
    exitU: CROSSING_EXIT_U,
  },
  render: (args) =>
    mountStage((stage) => {
      const factory = new MeshFactory(stage.scene);
      const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
      const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
      groundPad(stage, RUNWAY_LENGTH * 8);
      // A world centred on the crossing, so toScene puts it at the origin.
      const world = { width: 100, height: 100 };
      const center = { x: 50, y: 50 };
      const specs = [
        { color: "blue", offset: -1, side: -1 },
        { color: "yellow", offset: 1, side: 1 },
      ] as const;
      let nextStand = 0;
      const runways: Runway[] = specs.map(({ color, offset, side }) => {
        const heading = (args.bisectorDeg + (offset * args.angleDeg) / 2) * DEG;
        const dir = headingVector(heading);
        const back = RUNWAY_LENGTH / 2 - RUNWAY_THRESHOLD_INSET;
        const airfield = layoutAirfield(color, center, heading, side, nextStand, args.exitU);
        nextStand += airfield.stands.length;
        return {
          color,
          center,
          heading,
          length: RUNWAY_LENGTH,
          width: RUNWAY_WIDTH,
          threshold: { x: center.x - dir.x * back, y: center.y - dir.y * back },
          airfield,
        };
      });
      const views = runways.map((r) => runwayFactory.create(r, world, runways));
      for (const r of runways) airfields.create(r, world);
      orbitCamera(stage, Vector3.Zero(), RUNWAY_LENGTH * 1.3);
      return (_dt, time) => {
        for (const view of views) view.update(time);
      };
    }),
};

// ---------------------------------------------------------------------------
// Whole field
// ---------------------------------------------------------------------------

const fieldArgTypes = {
  rotationDeg: { control: { type: "range", min: -180, max: 180, step: 15 } },
  zoom: { control: { type: "range", min: ZOOM_MIN, max: 2.5, step: 0.05 } },
} as const;

/**
 * Runways, taxiways and hangars as laid out on the fixed-size world (see
 * `WORLD_ASPECT`), on bare grass. Resizing the preview only refits the
 * camera round it, like the game.
 */
export const RunwayLayout: StoryObj<AirfieldArgs> = {
  argTypes: fieldArgTypes,
  args: { rotationDeg: 0, zoom: 1, showBoundary: true },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const factory = new MeshFactory(stage.scene);
      const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
      groundPad(stage, cam.world.width * 3);
      fitShadowsToWorld(stage.shadows, cam.world);
      const runways = layoutRunways(cam.world);
      const views: RunwayView[] = runways.map((r) => runwayFactory.create(r, cam.world, runways));
      const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
      for (const r of runways) airfields.create(r, cam.world);
      const boundary = new AirspaceBoundary(stage.scene);
      boundary.setWorld(cam.world);
      boundary.setVisible(args.showBoundary);
      return (dt, time) => {
        cam.frame(dt, time);
        for (const view of views) view.update(time);
      };
    }),
};

/**
 * The full decorative landscape with the airfield: grass, farmland and
 * woods, roads with cars and a bridge, the village, the airports' grounds
 * (fences, towers, terminals), and the meandering stream with its boats.
 * Close-ups of the new pieces live in "Scene/Countryside".
 */
export const FullLandscape: StoryObj<AirfieldArgs> = {
  argTypes: fieldArgTypes,
  args: { rotationDeg: 0, zoom: 1, showBoundary: true },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const factory = new MeshFactory(stage.scene);
      const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
      fitShadowsToWorld(stage.shadows, cam.world);
      const runways = layoutRunways(cam.world);
      const landscape = new Landscape(stage.scene, stage.shadows);
      landscape.setWorld(cam.world, runways);
      const views = runways.map((r) => runwayFactory.create(r, cam.world, runways));
      const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
      for (const r of runways) airfields.create(r, cam.world);
      const boundary = new AirspaceBoundary(stage.scene);
      boundary.setWorld(cam.world);
      boundary.setVisible(args.showBoundary);
      return (dt, time) => {
        cam.frame(dt, time);
        landscape.update(time);
        for (const view of views) view.update(time);
      };
    }),
};
