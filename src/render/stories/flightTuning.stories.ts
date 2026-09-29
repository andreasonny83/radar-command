/**
 * Flight animation tuning workbench (see flightTuning.ts).
 *
 * One story per preset. Three planes (one of each model) fly circuits
 * through the real sim and SceneSync: a figure-eight (bank reversals), a
 * tight circle (steady bank, wing load) and a long oval (straights, where
 * wind drift and crab show best). Every control edits the live tuning, and
 * the planes keep flying while you drag a slider.
 *
 * The panel turns the current values into a preset block. Paste it into
 * `FLIGHT_PRESETS` in flightTuning.ts and point `ACTIVE_PRESET` at it to
 * ship it. A new preset needs one `presetStory` export at the bottom to show
 * up here.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArgTypes, Meta, StoryObj } from "@storybook/html-vite";
import { createPlane, updatePlane } from "../../core/plane";
import { createGameState } from "../../core/state";
import type { Plane, RunwayColor, Vec2, WorldSize } from "../../core/types";
import {
  ACTIVE_PRESET,
  FLIGHT_PRESETS,
  setFlightTuning,
  type FlightPresetName,
  type FlightTuning,
} from "../flightTuning";
import { MeshFactory } from "../meshes";
import { SceneSync } from "../sceneSync";
import { dragToPan, gameCamera, mountStage } from "./stage";

type View = "game" | "chase airliner" | "chase turboprop" | "chase light";

interface TuningArgs extends FlightTuning {
  view: View;
  /** Game speed: 0.25 = slow motion. */
  timeScale: number;
  /** Preset name used in the snippet. */
  saveAs: string;
}

const COLORS: readonly RunwayColor[] = ["red", "blue", "yellow"];
const TUNING_KEYS = Object.keys(FLIGHT_PRESETS.default) as (keyof FlightTuning)[];

/** Current tuning values out of the story args. */
function tuningFrom(args: TuningArgs): FlightTuning {
  return Object.fromEntries(TUNING_KEYS.map((k) => [k, args[k]])) as unknown as FlightTuning;
}

// ---------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------

/** Spacing of generated waypoints (world units), about a drawn path's. */
const WAYPOINT_SPACING = 2;

/** A closed loop sampled into evenly spaced-ish waypoints. */
function loop(point: (t: number) => Vec2, length: number): Vec2[] {
  const n = Math.max(12, Math.round(length / WAYPOINT_SPACING));
  return Array.from({ length: n }, (_, i) => point((i / n) * Math.PI * 2));
}

/**
 * Racetrack centred on (cx, cy): two straights `2 * half` long joined by
 * semicircles of radius `r`, flown clockwise on screen.
 */
function stadium(cx: number, cy: number, half: number, r: number): Vec2[] {
  const points: Vec2[] = [];
  const straight = Math.max(1, Math.round((half * 2) / WAYPOINT_SPACING));
  const arc = Math.max(6, Math.round((Math.PI * r) / WAYPOINT_SPACING));
  // side +1: top straight (heading +x) then the right-hand turn;
  // side -1: bottom straight (heading -x) then the left-hand turn.
  for (const side of [1, -1]) {
    const y = cy - side * r;
    for (let i = 0; i < straight; i++) {
      points.push({ x: cx - side * half + (side * 2 * half * i) / straight, y });
    }
    // Semicircle about the end's centre, from one straight to the other.
    const ex = cx + side * half;
    for (let i = 0; i < arc; i++) {
      const theta = (-side * Math.PI) / 2 + (Math.PI * i) / arc;
      points.push({ x: ex + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    }
  }
  return points;
}

/**
 * Three circuits laid out as fractions of the world, so they stay apart on
 * any aspect ratio. Plane ids 1–3 map to turboprop, light, airliner
 * (aircraft.ts `aircraftKindFor`).
 */
function circuits(world: WorldSize): { id: number; points: Vec2[] }[] {
  const { width: w, height: h } = world;
  // Figure-eight (lemniscate of Bernoulli): turns reverse every half loop.
  const eight = { x: w * 0.28, y: h * 0.5, a: 18 };
  // Tight circle: holds a steady bank, so wing load flex is easy to judge.
  const circle = { x: w * 0.72, y: h * 0.33, r: 9 };
  // Stadium: long straights to watch drift and crab.
  const oval = { x: w * 0.55, y: h * 0.8, half: 20, r: 7 };
  return [
    {
      id: 1,
      points: loop((t) => {
        const d = 1 + Math.sin(t) ** 2;
        return {
          x: eight.x + (eight.a * Math.cos(t)) / d,
          y: eight.y + (eight.a * Math.sin(t) * Math.cos(t)) / d,
        };
      }, eight.a * 5.2),
    },
    {
      id: 2,
      points: loop(
        (t) => ({ x: circle.x + circle.r * Math.cos(t), y: circle.y + circle.r * Math.sin(t) }),
        circle.r * Math.PI * 2,
      ),
    },
    { id: 3, points: stadium(oval.x, oval.y, oval.half, oval.r) },
  ];
}

/** Keep `plane.path` topped up from its circuit, so it never runs out. */
function feed(plane: Plane, points: Vec2[], cursor: { i: number }): void {
  if (plane.path.length >= 6) return;
  while (plane.path.length < 12) {
    plane.path.push(points[cursor.i % points.length]!);
    cursor.i++;
  }
  plane.pathVersion++;
}

// ---------------------------------------------------------------------------
// Snippet panel
// ---------------------------------------------------------------------------

/** Tidy number for code: at most 4 decimals, no float noise. */
function num(v: number): string {
  return String(Number(v.toFixed(4)));
}

/** Preset block for `FLIGHT_PRESETS`, marking values that differ from `base`. */
function presetSnippet(name: string, values: FlightTuning, base: FlightTuning): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
  const lines = TUNING_KEYS.map((k) => {
    const changed = num(values[k]) !== num(base[k]);
    return `    ${k}: ${num(values[k])},${changed ? ` // was ${num(base[k])}` : ""}`;
  });
  return `  ${key}: {\n${lines.join("\n")}\n  },`;
}

/** Overlay (top-right) showing the snippet with copy buttons. */
class SnippetPanel {
  readonly el = document.createElement("div");
  private readonly title = document.createElement("div");
  private readonly code = document.createElement("pre");
  private snippet = "";
  private activeLine = "";

  constructor() {
    this.el.className =
      "absolute top-4 right-4 z-10 w-80 rounded-xl border border-slate-700 bg-slate-900/85 p-3 text-xs shadow-lg backdrop-blur-sm";
    this.title.className = "mb-2 font-bold tracking-wider text-slate-300 uppercase";
    this.code.className =
      "max-h-64 overflow-auto rounded-lg bg-slate-950/70 p-2 font-mono text-[11px] leading-snug text-sky-200 select-text";
    const buttons = document.createElement("div");
    buttons.className = "mt-2 flex gap-2";
    buttons.append(
      this.button("Copy preset", () => this.snippet),
      this.button("Copy ACTIVE_PRESET", () => this.activeLine),
    );
    const hint = document.createElement("p");
    hint.className = "mt-2 text-slate-400";
    hint.textContent =
      "Paste the preset into FLIGHT_PRESETS in src/render/flightTuning.ts, then set ACTIVE_PRESET to ship it.";
    this.el.append(this.title, this.code, buttons, hint);
  }

  update(presetName: string, saveAs: string, values: FlightTuning): void {
    const base = FLIGHT_PRESETS[presetName as FlightPresetName];
    const changed = TUNING_KEYS.filter((k) => num(values[k]) !== num(base[k])).length;
    const active = presetName === ACTIVE_PRESET ? " · active in game" : "";
    this.title.textContent = `Preset: ${presetName}${active} · ${changed} changed`;
    this.snippet = presetSnippet(saveAs || presetName, values, base);
    this.activeLine = `export const ACTIVE_PRESET: FlightPresetName = ${JSON.stringify(saveAs || presetName)};`;
    this.code.textContent = this.snippet;
  }

  private button(label: string, text: () => string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className =
      "rounded-lg bg-sky-500 px-3 py-1 font-bold text-slate-950 transition hover:bg-sky-400 active:scale-95";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      void navigator.clipboard.writeText(text()).then(
        () => this.flash(btn, "Copied!", label),
        // Clipboard can be blocked (permissions, insecure origin): the
        // snippet is selectable, so say so rather than fail silently.
        () => this.flash(btn, "Blocked: select + copy", label),
      );
    });
    return btn;
  }

  private flash(btn: HTMLButtonElement, text: string, label: string): void {
    btn.textContent = text;
    setTimeout(() => (btn.textContent = label), 1200);
  }
}

// ---------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------

/**
 * The mounted workbench. Storybook keeps an element mounted when the render
 * function returns the same node, so slider changes only swap the tuning
 * values; the scene is rebuilt only when `key` (story, view, speed) changes.
 */
let mounted: { key: string; root: HTMLElement; panel: SnippetPanel } | null = null;

function renderWorkbench(args: TuningArgs, storyId: string, presetName: string): HTMLElement {
  const values = tuningFrom(args);
  const key = `${storyId}|${args.view}|${args.timeScale}`;
  if (mounted && mounted.key === key && mounted.root.isConnected) {
    setFlightTuning(values);
    mounted.panel.update(presetName, args.saveAs, values);
    return mounted.root;
  }

  const panel = new SnippetPanel();
  const root = mountStage((stage) => {
    setFlightTuning(values);
    const game = gameCamera(stage);
    const state = createGameState(stage.aspect());
    const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
    sync.rebuildWorld(state);

    const flights = circuits(state.world).map(({ id, points }) => {
      const [a, b] = [points[0]!, points[1]!];
      const color = COLORS[(id - 1) % COLORS.length]!;
      const plane = createPlane(id, color, a, Math.atan2(b.y - a.y, b.x - a.x));
      return { plane, points, cursor: { i: 1 } };
    });
    state.planes = flights.map((f) => f.plane);

    // Chase views: a perspective orbit camera locked onto one model. Drag
    // to orbit (no paths are drawn here), wheel to zoom.
    if (args.view !== "game") {
      const kind = args.view.replace("chase ", "");
      const id = { turboprop: 1, light: 2, airliner: 3 }[kind] ?? 3;
      const chase = new ArcRotateCamera(
        "chase",
        -Math.PI / 2,
        // Steep enough that the path line reads as a ground track.
        0.75,
        18,
        Vector3.Zero(),
        stage.scene,
      );
      chase.minZ = 0.1;
      chase.lowerRadiusLimit = 5;
      chase.upperRadiusLimit = 80;
      chase.wheelDeltaPercentage = 0.01;
      chase.attachControl(true);
      // First sync creates the meshes; follow one once it exists (a mesh
      // target makes the camera track its position every frame).
      sync.syncPlanes(state, 0);
      const target = stage.scene.getMeshByName(`plane-${id}`);
      if (target) chase.setTarget(target);
      stage.scene.activeCamera = chase;
    } else {
      // Game view: drag the map around, as in the game.
      dragToPan(stage, game.controller);
    }

    return (dt, time) => {
      if (args.view === "game") game.frame(dt, time);
      for (const f of flights) {
        feed(f.plane, f.points, f.cursor);
        updatePlane(f.plane, dt, state.world);
      }
      sync.syncPlanes(state, time);
    };
  }, args.timeScale);

  root.append(panel.el);
  panel.update(presetName, args.saveAs, values);
  mounted = { key, root, panel };
  return root;
}

/** Range control helper. */
const range = (min: number, max: number, step: number, category: string, detail?: string) => ({
  control: { type: "range" as const, min, max, step },
  table: { category },
  ...(detail ? { description: detail } : {}),
});

const argTypes: Partial<ArgTypes<TuningArgs>> = {
  view: {
    control: "inline-radio",
    options: ["game", "chase airliner", "chase turboprop", "chase light"],
    table: { category: "Workbench" },
  },
  timeScale: range(0.1, 2, 0.05, "Workbench"),
  saveAs: { control: "text", table: { category: "Workbench" } },

  maxBank: range(0, 1.4, 0.01, "Banking", "radians (0.6 ≈ 35°)"),
  yawEase: range(0.01, 0.5, 0.01, "Banking", "seconds"),
  bankEase: range(0.02, 1, 0.01, "Banking", "seconds"),

  flexBase: range(0, 0.15, 0.005, "Aircraft animation", "radians"),
  flexLoad: range(0, 0.5, 0.01, "Aircraft animation"),
  flexBump: range(0, 0.2, 0.005, "Aircraft animation"),
  flexAirliner: range(0, 2, 0.05, "Aircraft animation"),
  flexTurboprop: range(0, 2, 0.05, "Aircraft animation"),
  flexLight: range(0, 2, 0.05, "Aircraft animation"),
  spinTurboprop: range(0, 60, 1, "Aircraft animation", "rad/s; >40 aliases at 60 Hz"),
  spinLight: range(0, 60, 1, "Aircraft animation", "rad/s; >40 aliases at 60 Hz"),
  rolloutSpin: range(0, 1, 0.05, "Aircraft animation"),
  strobePeriod: range(0.3, 4, 0.05, "Aircraft animation", "seconds"),
  beaconPeriod: range(0.3, 4, 0.05, "Aircraft animation", "seconds"),

  driftAmplitude: range(0, 2, 0.01, "Wind", "world units"),
  wanderShare: range(0, 1, 0.01, "Wind"),
  maxCrab: range(0, 0.5, 0.01, "Wind", "radians"),
  bumpAmplitude: range(0, 0.5, 0.01, "Wind", "radians"),
  liftAmplitude: range(0, 1, 0.01, "Wind", "scene units"),
  windDirection: range(-Math.PI, Math.PI, 0.01, "Wind", "radians, sim convention"),
  windVeer: range(0, 1.5, 0.01, "Wind", "radians"),
};

const meta: Meta<TuningArgs> = {
  title: "Tuning/Flight",
  argTypes,
  args: { view: "game", timeScale: 1 },
  render: (args, context) =>
    renderWorkbench(args, context.id, context.parameters.preset as FlightPresetName),
};
export default meta;

type Story = StoryObj<TuningArgs>;

/** Story starting from a preset's values; its name is marked if the game uses it. */
function presetStory(preset: FlightPresetName): Story {
  const label = preset.charAt(0).toUpperCase() + preset.slice(1);
  return {
    name: preset === ACTIVE_PRESET ? `${label} (active)` : label,
    args: { ...FLIGHT_PRESETS[preset], saveAs: preset },
    parameters: { preset },
  };
}

export const Default = presetStory("default");
export const Calm = presetStory("calm");
export const Gusty = presetStory("gusty");
export const Aerobatic = presetStory("aerobatic");
