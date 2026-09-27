/**
 * Aircraft models (aircraft.ts) through the real MeshFactory: paint
 * material, glow layer, wing flex, props, strobes and the visual wind.
 *
 * Tuning loop: edit the models / KIND_SIZE in aircraft.ts, the paint
 * material in meshes.ts or PLANE_RADIUS in config.ts, and the story
 * hot-reloads. Args cover the per-frame inputs the sync layer would normally
 * feed in. Wing flex, props, lights and wind use the game's active flight
 * preset: tune those live in "Tuning/Flight".
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { FLIGHT_ALTITUDE, PLANE_RADIUS } from "../../config";
import type { PlaneColor } from "../../core/types";
import { animateAircraft, type AircraftKind, type AircraftRig } from "../aircraft";
import { MeshFactory } from "../meshes";
import { fitShadowsToWorld } from "../scene";
import { windEffect } from "../wind";
import { gameCamera, groundPad, mountStage, orbitCamera, type Stage } from "./stage";

const KINDS: AircraftKind[] = ["airliner", "turboprop", "light"];
/** Arrival colours, then violet: departures (core/departures.ts). */
const COLORS: PlaneColor[] = ["red", "blue", "yellow", "violet"];
const DEG = Math.PI / 180;

interface AircraftArgs {
  kind: AircraftKind;
  color: PlaneColor;
  /** "orbit" = drag-to-orbit close-up; "game" = the real camera and scale. */
  view: "orbit" | "game";
  /** Bank angle (degrees, + = right wing down). */
  bankDeg: number;
  /** Turbulence chop fed to wing flex, -1..1. */
  chop: number;
  /** Landing rollout progress 0..1 (winds the props down). */
  rollout: number;
  /** 0..1 strength of the visual wind (drift, crab, bumps). */
  windExposure: number;
  /** Degrees per second the plane yaws on its stand; 0 = still. */
  turntable: number;
  /** Multiplies time for every animation: 0.25 = slow motion. */
  timeScale: number;
}

/**
 * Pose one plane like sceneSync.ts `updateView` does: sit it at `pos`,
 * apply the wind offsets, then roll/yaw/pitch.
 */
function posePlane(
  rig: AircraftRig,
  id: number,
  pos: Vector3,
  p: { heading: number; bank: number; exposure: number; chop: number; rollout: number },
  time: number,
  dt: number,
): void {
  const { heading, bank, exposure, chop, rollout } = p;
  const wind = windEffect(time, id, heading, exposure);
  rig.root.position.set(pos.x + wind.drift.x, pos.y + wind.lift, pos.z - wind.drift.y);
  rig.root.rotation.set(-(bank + wind.roll), heading + wind.crab, wind.pitch);
  animateAircraft(rig, { time, dt, bank, chop: chop + wind.chop, rollout });
}

/** Camera for the chosen view; returns its per-frame update (if any). */
function setupView(stage: Stage, view: AircraftArgs["view"], target: Vector3, radius: number) {
  if (view === "game") {
    const cam = gameCamera(stage);
    fitShadowsToWorld(stage.shadows, cam.world);
    return cam.frame;
  }
  orbitCamera(stage, target, radius);
  return undefined;
}

const meta: Meta<AircraftArgs> = {
  title: "Scene/Aircraft",
  argTypes: {
    kind: { control: "inline-radio", options: KINDS },
    color: { control: "inline-radio", options: COLORS },
    view: { control: "inline-radio", options: ["orbit", "game"] },
    bankDeg: {
      control: { type: "range", min: -60, max: 60, step: 1 },
      description: "In game, bank tops out at the preset's maxBank (Tuning/Flight)",
    },
    chop: { control: { type: "range", min: -1, max: 1, step: 0.05 } },
    rollout: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    windExposure: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    turntable: { control: { type: "range", min: 0, max: 90, step: 5 } },
    timeScale: { control: { type: "range", min: 0, max: 2, step: 0.05 } },
  },
  args: {
    kind: "airliner",
    color: "red",
    view: "orbit",
    bankDeg: 0,
    chop: 0,
    rollout: 0,
    windExposure: 0,
    turntable: 15,
    timeScale: 1,
  },
};
export default meta;

type Story = StoryObj<AircraftArgs>;

/** One plane on a stand. Drag to orbit, wheel to zoom. */
export const Single: Story = {
  render: (args) =>
    mountStage((stage) => {
      const factory = new MeshFactory(stage.scene);
      groundPad(stage, 200);
      const rig = factory.createAircraft(args.kind, args.color, 1, "plane");
      for (const mesh of rig.shadowCasters) stage.shadows.addShadowCaster(mesh, false);
      const pos = new Vector3(0, FLIGHT_ALTITUDE, 0);
      const updateCamera = setupView(stage, args.view, pos, PLANE_RADIUS * 6);

      return (dt, time) => {
        updateCamera?.(dt, time);
        const heading = time * args.turntable * DEG;
        const bank = args.bankDeg * DEG;
        const { windExposure: exposure, chop, rollout } = args;
        posePlane(rig, 1, pos, { heading, bank, exposure, chop, rollout }, time, dt);
      };
    }, args.timeScale),
};

/** Every model in every colour, side by side, for comparing sizes and liveries. */
export const Fleet: Story = {
  args: { turntable: 0, windExposure: 0.5 },
  argTypes: { kind: { table: { disable: true } }, color: { table: { disable: true } } },
  render: (args) =>
    mountStage((stage) => {
      const factory = new MeshFactory(stage.scene);
      groundPad(stage, 240);
      const spacing = PLANE_RADIUS * 3.5;
      const planes = KINDS.flatMap((kind, row) =>
        COLORS.map((color, col) => {
          const id = row * COLORS.length + col + 1;
          const rig = factory.createAircraft(kind, color, id, `plane-${id}`);
          for (const mesh of rig.shadowCasters) stage.shadows.addShadowCaster(mesh, false);
          const pos = new Vector3((col - 1) * spacing, FLIGHT_ALTITUDE, (1 - row) * spacing);
          return { rig, id, pos };
        }),
      );
      const updateCamera = setupView(stage, args.view, new Vector3(0, 0, 0), spacing * 4);

      return (dt, time) => {
        updateCamera?.(dt, time);
        const heading = Math.PI / 2 + time * args.turntable * DEG;
        const bank = args.bankDeg * DEG;
        const { windExposure: exposure, chop, rollout } = args;
        for (const { rig, id, pos } of planes) {
          posePlane(rig, id, pos, { heading, bank, exposure, chop, rollout }, time, dt);
        }
      };
    }, args.timeScale),
};
