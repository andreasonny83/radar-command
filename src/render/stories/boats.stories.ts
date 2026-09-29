/**
 * River boats (render/boats.ts) and their traffic (core/boats.ts).
 *
 * Tuning loop: edit the models, colours or BOAT_SCALE in boats.ts,
 * or the traffic (BOAT_TYPES speeds/lanes, BOAT_SPAWN_*, BOAT_MAX,
 * BOAT_FADE_DISTANCE) in config.ts, and the story
 * hot-reloads.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { STREAM_BANK_WIDTH, STREAM_WIDTH, ZOOM_MIN } from "../../config";
import { createBoatTraffic, stepBoats } from "../../core/boats";
import { layoutRunways } from "../../core/layout";
import type { StreamPoint } from "../../core/scenery";
import { AirfieldFactory } from "../airfield";
import { BoatFleet } from "../boats";
import { Landscape } from "../landscape";
import { MeshFactory } from "../meshes";
import { RunwayFactory } from "../runway";
import { fitShadowsToWorld } from "../scene";
import { dragToPan, gameCamera, groundPad, mountStage, orbitCamera, type Stage } from "./stage";

const DEG = Math.PI / 180;

const meta: Meta = { title: "Scene/River" };
export default meta;

// ---------------------------------------------------------------------------
// Boat models
// ---------------------------------------------------------------------------

interface ModelArgs {
  /** Let the boats sail (and new ones launch) instead of holding still. */
  sailing: boolean;
  /** Multiplies time for every animation: 0.25 = slow motion. */
  timeScale: number;
}

/** A 100 × 100 world with a straight river across its middle. */
const WORLD = { width: 100, height: 100 };

/** First x of the straight river; distance along it is `x - RIVER_START_X`. */
const RIVER_START_X = -80;

/** Straight centreline along y = 50, well past both sides of the world. */
function straightRiver(): StreamPoint[] {
  const line: StreamPoint[] = [];
  for (let x = RIVER_START_X; x <= 180; x += 2.5) line.push({ x, y: 50, width: STREAM_WIDTH });
  return line;
}

/**
 * Flat water strip over a sandy bank, coloured like landscape.ts, lying
 * along scene x through the origin (where `toScene` puts sim y = 50).
 */
function waterStrip(stage: Stage, length: number): void {
  const flat = (name: string, width: number, y: number, hex: string, alpha = 1) => {
    const mesh = CreateGround(name, { width: length, height: width }, stage.scene);
    mesh.position.y = y;
    const mat = new StandardMaterial(`${name}Mat`, stage.scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = Color3.Black();
    mat.alpha = alpha;
    mesh.material = mat;
    mesh.receiveShadows = true;
  };
  flat("bank", STREAM_WIDTH + STREAM_BANK_WIDTH * 2, 0.02, "#a8905c");
  flat("water", STREAM_WIDTH, 0.04, "#3aa0d0", 0.9);
}

/**
 * Sailboat and motorboat passing each other close up, in their lanes (each
 * keeps to its right). Drag to orbit, wheel to zoom. With `sailing` on they
 * move off and the spawner launches more, as in the game.
 */
export const BoatModels: StoryObj<ModelArgs> = {
  argTypes: {
    timeScale: { control: { type: "range", min: 0, max: 4, step: 0.25 } },
  },
  args: { sailing: false, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      groundPad(stage, 120);
      waterStrip(stage, 240);
      const fleet = new BoatFleet(stage.scene, stage.shadows);
      const traffic = createBoatTraffic(straightRiver(), WORLD);
      // The scene origin is sim (50, 50); put one of each boat either side.
      const mid = 50 - RIVER_START_X;
      traffic.boats = [
        { id: 1, kind: "sailboat", s: mid - 3, dir: 1, speed: 1.8 },
        { id: 2, kind: "motorboat", s: mid + 3, dir: -1, speed: 3.4 },
      ];
      traffic.nextId = 3;
      orbitCamera(stage, new Vector3(0, 1, 0), 14);
      return (dt, time) => {
        if (args.sailing) stepBoats(traffic, dt);
        fleet.sync(traffic, WORLD, time);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Traffic on the real river
// ---------------------------------------------------------------------------

interface TrafficArgs {
  /** Camera heading on top of the default view (degrees). */
  rotationDeg: number;
  /** Camera zoom, as the "+" / "−" buttons set it (ZOOM_MIN–2.5). */
  zoom: number;
  /**
   * Fast-forward, to see launches without waiting. Boats step at most 0.1 s
   * per frame (like the game), so beyond ~6× the traffic stops speeding up.
   */
  timeScale: number;
}

/**
 * The game's landscape and airfield at game scale, with boat traffic on the
 * river exactly as the game runs it: launches from either end every
 * BOAT_SPAWN_MIN–MAX seconds, fading in/out off the field.
 */
export const RiverTraffic: StoryObj<TrafficArgs> = {
  argTypes: {
    rotationDeg: { control: { type: "range", min: -180, max: 180, step: 15 } },
    zoom: { control: { type: "range", min: ZOOM_MIN, max: 2.5, step: 0.05 } },
    timeScale: { control: { type: "range", min: 0.25, max: 6, step: 0.25 } },
  },
  args: { rotationDeg: 0, zoom: 1, timeScale: 4 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      dragToPan(stage, cam.controller);
      const factory = new MeshFactory(stage.scene);
      fitShadowsToWorld(stage.shadows, cam.world);
      const runways = layoutRunways(cam.world);
      const landscape = new Landscape(stage.scene, stage.shadows);
      landscape.setWorld(cam.world, runways);
      const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
      const views = runways.map((r) => runwayFactory.create(r, cam.world, runways));
      const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
      for (const r of runways) airfields.create(r, cam.world);
      return (dt, time) => {
        cam.frame(dt, time);
        landscape.update(time);
        for (const view of views) view.update(time);
      };
    }, args.timeScale),
};
