/**
 * Shared Babylon "stage" for Storybook stories: a full-size canvas running
 * the game's own scene setup (`createScene`: lights, shadows, clear colour),
 * so a mesh in a story looks exactly as it does in the game.
 *
 * Only one stage runs at a time: mounting a new one (switching stories,
 * changing an arg, or a hot reload after editing a constant) disposes the
 * previous engine, so WebGL contexts never pile up.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { MAX_DT } from "../../config";
import { computeWorldSize } from "../../core/layout";
import type { WorldSize } from "../../core/types";
import { CameraController } from "../camera";
import { setDayPalette } from "../dayTuning";
import { setFlightTuning } from "../flightTuning";
import { createScene } from "../scene";

export interface Stage {
  /** Wrapper element returned to Storybook; add HTML overlays here. */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  engine: Engine;
  scene: Scene;
  shadows: ShadowGenerator;
  /** Sky fill and key (sun) lights, for stories that run a DayCycle. */
  fill: HemisphericLight;
  key: DirectionalLight;
  /** Width / height of the canvas right now. */
  aspect(): number;
}

/**
 * Per-frame callback. `time` is the stage clock in seconds, scaled by the
 * `timeScale` passed to `mountStage` (so slow motion slows every animation).
 */
export type FrameFn = (dt: number, time: number) => void;

/** Dispose hook for whatever stage is currently running. */
let disposeActive: (() => void) | null = null;

/**
 * Create a stage, let `build` populate it, then run the render loop.
 *
 * @param build      adds meshes/cameras; may return a per-frame callback.
 *                   It must leave `scene.activeCamera` set. Runs on the
 *                   first frame the canvas has a size, not immediately.
 * @param timeScale  multiplies dt for everything `build` animates (1 = real time).
 */
export function mountStage(build: (stage: Stage) => FrameFn | void, timeScale = 1): HTMLElement {
  disposeActive?.();
  // Undo any flight tuning a previous story (Tuning/Flight) applied, so every
  // other story shows the game's active preset.
  setFlightTuning();
  // Same for the time-of-day palette (Tuning/Time of day edits it live).
  setDayPalette();

  const root = document.createElement("div");
  root.className = "relative h-full w-full overflow-hidden text-slate-100";
  const canvas = document.createElement("canvas");
  canvas.className = "block h-full w-full outline-none";
  // Same rule as #renderCanvas in style.css: drags draw paths, never scroll.
  canvas.style.touchAction = "none";
  root.append(canvas);

  const { engine, scene, shadows, fill, key } = createScene(canvas);
  const stage: Stage = {
    root,
    canvas,
    engine,
    scene,
    shadows,
    fill,
    key,
    aspect: () => engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()),
  };
  // Storybook attaches `root` after this function returns, so the canvas
  // has no size yet. `build` waits for the first frame with a real layout,
  // so world sizes and camera fits see the true aspect ratio (a later window
  // resize only refits the canvas; change any arg to rebuild).
  let frame: FrameFn | void | undefined;
  let built = false;
  const resizer = new ResizeObserver(() => engine.resize());
  resizer.observe(canvas);

  let time = 0;
  const dispose = () => {
    resizer.disconnect();
    engine.dispose();
    if (disposeActive === dispose) disposeActive = null;
  };
  disposeActive = dispose;

  engine.runRenderLoop(() => {
    if (!root.isConnected) {
      // Navigated to a non-3D story: nothing will mount a new stage to
      // clean this one up, so notice we've been detached and stop.
      if (built) dispose();
      return;
    }
    if (!built) {
      if (canvas.clientHeight === 0) return;
      engine.resize();
      frame = build(stage);
      built = true;
    }
    const dt = Math.min(engine.getDeltaTime() / 1000, MAX_DT) * timeScale;
    time += dt;
    frame?.(dt, time);
    if (scene.activeCamera) scene.render();
  });
  return root;
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

/**
 * The game's own camera (fixed tilt, orthographic) framing the fixed-size
 * world in the canvas, exactly like main.ts. Use it to judge how an element reads at
 * real game scale.
 *
 * @param rotation  extra heading (radians) on top of the default view
 * @param zoom      >1 zooms in, like pressing "+" in the game
 */
export function gameCamera(
  stage: Stage,
  rotation = 0,
  zoom = 1,
): { controller: CameraController; world: WorldSize; frame: FrameFn } {
  const controller = new CameraController(stage.scene, stage.canvas);
  const world = computeWorldSize();
  controller.setWorld(world);
  controller.rotateBy(rotation);
  controller.zoomBy(zoom);
  // Jump straight to the target view instead of easing in from the default.
  controller.update(10, stage.aspect());
  return {
    controller,
    world,
    frame: (dt) => controller.update(dt, stage.aspect()),
  };
}

/**
 * Let the player grab and drag the map around a `gameCamera`, like dragging
 * empty ground in the game (input/pointer.ts `onPan`). Stories that show a
 * static or scripted scene have no planes to route, so every left-button /
 * touch drag pans: there is no path drawing to compete with.
 *
 * Stories wiring the real pointer input (`attachPointerInput` with `onPan`)
 * already pan and must not call this too, or each drag would move twice.
 */
export function dragToPan(stage: Stage, controller: CameraController): void {
  const { canvas } = stage;
  /** The one pointer dragging the map and where it was last seen (CSS px). */
  let pan: { pointerId: number; x: number; y: number } | null = null;
  canvas.style.cursor = "grab";

  canvas.addEventListener("pointerdown", (e) => {
    // Primary (left) mouse button only; touch/pen report 0. One finger at a
    // time, as in the game.
    if (e.button !== 0 || pan !== null) return;
    pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.style.cursor = "grabbing";
    // Keep receiving move/up for this pointer even if it leaves the canvas.
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pan || pan.pointerId !== e.pointerId) return;
    // CameraController.dragBy wants canvas heights, +y down the screen.
    const h = canvas.clientHeight || 1;
    controller.dragBy((e.clientX - pan.x) / h, (e.clientY - pan.y) / h);
    pan.x = e.clientX;
    pan.y = e.clientY;
  });
  const end = (e: PointerEvent) => {
    if (!pan || pan.pointerId !== e.pointerId) return;
    pan = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

/**
 * A free-orbit perspective camera for close-ups: drag to orbit, wheel to
 * zoom. (The game camera never takes drags on its own: see `dragToPan`.)
 */
export function orbitCamera(stage: Stage, target: Vector3, radius: number): ArcRotateCamera {
  const camera = new ArcRotateCamera("orbit", -Math.PI / 2.6, 1.05, radius, target, stage.scene);
  camera.lowerRadiusLimit = radius * 0.3;
  camera.upperRadiusLimit = radius * 4;
  camera.wheelDeltaPercentage = 0.01;
  camera.minZ = 0.1;
  camera.attachControl(true);
  return camera;
}

/** Plain grass square that catches shadows, for stories without the landscape. */
export function groundPad(stage: Stage, size: number): Mesh {
  const ground = CreateGround("pad", { width: size, height: size }, stage.scene);
  const mat = new StandardMaterial("padMat", stage.scene);
  mat.diffuseColor = Color3.FromHexString("#64a23d"); // landscape.ts GRASS_MID
  mat.specularColor = Color3.Black();
  ground.material = mat;
  ground.receiveShadows = true;
  ground.isPickable = false;
  return ground;
}
