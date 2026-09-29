/**
 * Aircraft models (aircraft.ts) through the real MeshFactory: paint
 * material, glow layer, wing flex, props, strobes, landing gear (`gear`,
 * or `gearCycle` to watch it fold; GEAR_TRAVEL in sceneSync.ts), the
 * visual wind and, after dark (`hour`), the landing lights: lamps and beam
 * (`headlight` / `headBeam` in aircraft.ts, colours and HEADLIGHT_BEAM_STRENGTH
 * in meshes.ts). "Headlights" shows the fleet at night.
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
import { animateAircraft, setHeadlights, type AircraftKind, type AircraftRig } from "../aircraft";
import { DayCycle } from "../dayCycle";
import { MeshFactory } from "../meshes";
import { fitShadowsToWorld } from "../scene";
import { GEAR_TRAVEL } from "../sceneSync";
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
  /** Landing gear, 0 = retracted to 1 = down (the light plane's is fixed). */
  gear: number;
  /** Cycle the gear up and down (every `GEAR_TRAVEL` + a pause) instead of `gear`. */
  gearCycle: boolean;
  /** 0..1 strength of the visual wind (drift, crab, bumps). */
  windExposure: number;
  /** Degrees per second the plane yaws on its stand; 0 = still. */
  turntable: number;
  /** Multiplies time for every animation: 0.25 = slow motion. */
  timeScale: number;
  /** Time of day (hours): lights the stage, and after dusk the landing lights. */
  hour: number;
  /** Landing lights switched on (the game turns them off in the hangar). */
  headlights: boolean;
}

/**
 * Pose one plane like sceneSync.ts `updateView` does: sit it at `pos`,
 * apply the wind offsets, then roll/yaw/pitch.
 */
function posePlane(
  rig: AircraftRig,
  id: number,
  pos: Vector3,
  p: {
    heading: number;
    bank: number;
    exposure: number;
    chop: number;
    rollout: number;
    gear: number;
  },
  time: number,
  dt: number,
): void {
  const { heading, bank, exposure, chop, rollout, gear } = p;
  const wind = windEffect(time, id, heading, exposure);
  rig.root.position.set(pos.x + wind.drift.x, pos.y + wind.lift, pos.z - wind.drift.y);
  rig.root.rotation.set(-(bank + wind.roll), heading + wind.crab, wind.pitch);
  animateAircraft(rig, { time, dt, bank, chop: chop + wind.chop, rollout, gear });
}

/**
 * Gear position for the story: `args.gear`, or with `gearCycle` a loop of
 * down → retracting → up → extending, eased like sceneSync.ts draws it.
 */
function gearAt(args: AircraftArgs, time: number): number {
  if (!args.gearCycle) return args.gear;
  const hold = 1.2;
  const period = 2 * (GEAR_TRAVEL + hold);
  const t = time % period;
  const g =
    t < hold
      ? 1
      : t < hold + GEAR_TRAVEL
        ? 1 - (t - hold) / GEAR_TRAVEL
        : t < 2 * hold + GEAR_TRAVEL
          ? 0
          : (t - 2 * hold - GEAR_TRAVEL) / GEAR_TRAVEL;
  return g * g * (3 - 2 * g);
}

/**
 * Light the stage for `args.hour` (render/dayCycle.ts) and hand the night
 * on to the factory, like SceneSync.setNight does in the game.
 */
function lightForHour(stage: Stage, factory: MeshFactory, args: AircraftArgs): void {
  const day = new DayCycle(stage);
  day.setHours(args.hour);
  factory.setNight(day.night);
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
    gear: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    windExposure: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    turntable: { control: { type: "range", min: 0, max: 90, step: 5 } },
    timeScale: { control: { type: "range", min: 0, max: 2, step: 0.05 } },
    hour: { control: { type: "range", min: 0, max: 23.75, step: 0.25 } },
  },
  args: {
    kind: "airliner",
    color: "red",
    view: "orbit",
    bankDeg: 0,
    chop: 0,
    rollout: 0,
    gear: 1,
    gearCycle: false,
    windExposure: 0,
    turntable: 15,
    timeScale: 1,
    hour: 12,
    headlights: true,
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
      lightForHour(stage, factory, args);
      const rig = factory.createAircraft(args.kind, args.color, 1, "plane");
      setHeadlights(rig, args.headlights);
      for (const mesh of rig.shadowCasters) stage.shadows.addShadowCaster(mesh, false);
      const pos = new Vector3(0, FLIGHT_ALTITUDE, 0);
      const updateCamera = setupView(stage, args.view, pos, PLANE_RADIUS * 6);

      return (dt, time) => {
        updateCamera?.(dt, time);
        const heading = time * args.turntable * DEG;
        const bank = args.bankDeg * DEG;
        const { windExposure: exposure, chop, rollout } = args;
        const gear = gearAt(args, time);
        posePlane(rig, 1, pos, { heading, bank, exposure, chop, rollout, gear }, time, dt);
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
      lightForHour(stage, factory, args);
      groundPad(stage, 240);
      const spacing = PLANE_RADIUS * 3.5;
      const planes = KINDS.flatMap((kind, row) =>
        COLORS.map((color, col) => {
          const id = row * COLORS.length + col + 1;
          const rig = factory.createAircraft(kind, color, id, `plane-${id}`);
          setHeadlights(rig, args.headlights);
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
        const gear = gearAt(args, time);
        for (const { rig, id, pos } of planes) {
          posePlane(rig, id, pos, { heading, bank, exposure, chop, rollout, gear }, time, dt);
        }
      };
    }, args.timeScale),
};

/**
 * The fleet at night, in the game's camera: nose and wing lamps and the
 * cone of light each plane throws ahead of it.
 */
export const Headlights: Story = {
  ...Fleet,
  args: { ...Fleet.args, hour: 23, view: "game" },
};
