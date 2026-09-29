/**
 * The world round the runways, close up, exactly as the game builds it for
 * a 16:9 screen (the full Landscape: fields, woods, roads, village, river,
 * airport grounds, with the runways and taxiways on top):
 *
 *   - AirportGrounds: one airport's airside (striped mown grass, fence,
 *                     windsock) and landside (tower, terminal, car park);
 *   - Village:        the village, its church, farms and the roads, with
 *                     cars driving through;
 *   - Drawbridge:     one drawbridge on its own, its leaves and barriers
 *                     driven by the controls (or cycling on their own),
 *                     with a motorboat passing under the leaves.
 *
 * Drag to orbit, wheel to zoom.
 *
 * Tuning loop: layout in core/airports.ts and core/countryside.ts (sizes in
 * config.ts: PERIMETER_MARGIN, TERMINAL_*, CAR_PARK_*, TOWER_SETBACK,
 * COUNTRYSIDE_REACH, FIELD_*, HEDGE_GAP, ROAD_*, VILLAGE_RADIUS, CAR_*);
 * looks in render/airportGrounds.ts, render/countryside.ts, render/cars.ts,
 * render/bridges.ts (DECK_Y from boats.ts MOTORBOAT_HEIGHT, LEAF_OPEN, BOOM_*),
 * BRIDGE_LIFT_TIME in config.ts.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { BOAT_TYPES } from "../../config";
import { layoutAirports } from "../../core/airports";
import { createBoatTraffic } from "../../core/boats";
import { computeWorldSize, layoutRunways } from "../../core/layout";
import { buildScenery } from "../../core/scenery";
import type { Vec2, WorldSize } from "../../core/types";
import type { BridgeState } from "../../core/bridges";
import type { Bridge } from "../../core/countryside";
import { AirfieldFactory } from "../airfield";
import { BoatFleet } from "../boats";
import { DrawbridgeFactory } from "../bridges";
import { toScene } from "../coords";
import { Landscape } from "../landscape";
import { MeshFactory } from "../meshes";
import { RunwayFactory } from "../runway";
import { fitShadowsToWorld } from "../scene";
import { groundPad, mountStage, orbitCamera, type Stage } from "./stage";

const meta: Meta = { title: "Scene/Countryside" };
export default meta;

/** The game's (fixed-size) world, with everything on it. */
function buildWorld(stage: Stage): { world: WorldSize; update: (time: number) => void } {
  const world = computeWorldSize();
  const runways = layoutRunways(world);
  const factory = new MeshFactory(stage.scene);
  fitShadowsToWorld(stage.shadows, world);
  const landscape = new Landscape(stage.scene, stage.shadows);
  landscape.setWorld(world, runways);
  const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
  const views = runways.map((r) => runwayFactory.create(r, world, runways));
  const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
  for (const r of runways) airfields.create(r, world);
  return {
    world,
    update: (time) => {
      landscape.update(time);
      for (const view of views) view.update(time);
    },
  };
}

// ---------------------------------------------------------------------------
// Airport grounds
// ---------------------------------------------------------------------------

type AirportChoice = "blue + yellow" | "red";

export const AirportGrounds: StoryObj<{ airport: AirportChoice; look: "terminal" | "airside" }> = {
  argTypes: {
    airport: { control: "inline-radio", options: ["blue + yellow", "red"] },
    look: { control: "inline-radio", options: ["terminal", "airside"] },
  },
  args: { airport: "blue + yellow", look: "terminal" },
  render: (args) =>
    mountStage((stage) => {
      const { world, update } = buildWorld(stage);
      const airports = layoutAirports(layoutRunways(world), world);
      const wanted = args.airport === "red" ? "red" : "blue";
      const airport = airports.find((a) => a.runways.some((r) => r.color === wanted))!;
      const focus: Vec2 =
        args.look === "terminal" && airport.landside
          ? airport.landside.terminal.center
          : airport.center;
      orbitCamera(stage, toScene(focus, world), args.look === "terminal" ? 30 : 75);
      return (_dt, time) => update(time);
    }),
};

// ---------------------------------------------------------------------------
// Village
// ---------------------------------------------------------------------------

export const Village: StoryObj = {
  render: () =>
    mountStage((stage) => {
      const { world, update } = buildWorld(stage);
      const village = buildScenery(world, layoutRunways(world)).countryside.village;
      const focus = village ?? { x: world.width / 2, y: world.height * 0.9 };
      orbitCamera(stage, toScene(focus, world), 40);
      return (_dt, time) => update(time);
    }),
};

// ---------------------------------------------------------------------------
// Drawbridge
// ---------------------------------------------------------------------------

interface DrawbridgeArgs {
  /** Cycle open → closed on its own, like the game does for each sailboat. */
  auto: boolean;
  /** Leaves: 0 down, 1 fully up (when not cycling). */
  lift: number;
  /** Barriers down and lights flashing (when not cycling). */
  closed: boolean;
  /** A motorboat shuttling under the bridge, to check its clearance. */
  motorboat: boolean;
}

/**
 * A drawbridge over a 7-wide river on its own (the game's is built from the
 * road that crosses the river): ramps up from both banks, stone abutments,
 * the two leaves, and a barrier at each end. The motorboat (on by default)
 * must pass under the lowered leaves, roof lantern included.
 */
export const Drawbridge: StoryObj<DrawbridgeArgs> = {
  argTypes: { lift: { control: { type: "range", min: 0, max: 1, step: 0.05 } } },
  args: { auto: true, lift: 0, closed: false, motorboat: true },
  render: (args) =>
    mountStage((stage) => {
      groundPad(stage, 80);
      // A world centred on the bridge, so toScene puts it at the origin.
      const world = { width: 100, height: 100 };
      // Road straight across (sim y 40 → 60), river 9 wide across it at y = 50.
      const points = Array.from({ length: 21 }, (_, i) => ({ x: 50, y: 40 + i }));
      const bridge: Bridge = { road: 0, from: 0, to: 20, points, wetFrom: 5.5, wetTo: 14.5 };
      riverStrip(stage);
      const view = new DrawbridgeFactory(stage.scene, stage.shadows).create(bridge, world);
      // River centreline under the bridge (sim y = 50), for the motorboat.
      const river = Array.from({ length: 41 }, (_, i) => ({ x: 30 + i, y: 50, width: 9 }));
      const traffic = createBoatTraffic(river, world);
      const fleet = new BoatFleet(stage.scene, stage.shadows);
      orbitCamera(stage, new Vector3(0, 0.6, 0), 22);
      const state: BridgeState = { bridge, lift: args.lift, wanted: args.closed };
      return (_dt, time) => {
        if (args.auto) {
          // 12 s cycle: close, lift, hold, lower, reopen.
          const t = time % 12;
          state.wanted = t > 1 && t < 8;
          state.lift = Math.max(0, Math.min(1, Math.min((t - 2) / 3, (9 - t) / 3)));
        } else {
          state.lift = args.lift;
          state.wanted = args.closed;
        }
        view.update(state, time);
        // The motorboat loops through the 30 units round the bridge (at
        // s = 20), in full view, regardless of the leaves.
        const speed = BOAT_TYPES.motorboat.speed;
        const s = 5 + ((time * speed) % 30);
        traffic.boats = args.motorboat ? [{ id: 1, kind: "motorboat", s, dir: 1, speed }] : [];
        fleet.sync(traffic, world, time);
      };
    }),
};

/** A strip of river under the story's bridge, across the road at the origin. */
function riverStrip(stage: Stage): void {
  const water = CreateGround("storyRiver", { width: 60, height: 9 }, stage.scene);
  water.position.y = 0.04;
  const mat = new StandardMaterial("storyRiverMat", stage.scene);
  mat.diffuseColor = Color3.FromHexString("#3aa0d0");
  mat.specularColor = new Color3(0.4, 0.5, 0.6);
  water.material = mat;
  water.isPickable = false;
}
