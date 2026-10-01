/**
 * Babylon engine + scene bootstrap: renderer, clear colour, lights and the
 * shared shadow generator.
 *
 * The lights are created here with the noon look (these constants are the
 * noon keyframe in dayTuning.ts). In the game, render/dayCycle.ts then moves
 * them through the day; stories that don't create a `DayCycle` keep this
 * noon look.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent"; // side effect: shadow rendering
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { maxViewRadius } from "../core/layout";
import type { WorldSize } from "../core/types";
import { isTouchDevice, qualityProfile, type QualityProfile } from "./quality";

/**
 * Background colour: the darkened grass at the map edge, so any sliver of
 * clear colour past the landscape blends in. Mirrored by the page body in
 * `style.css`.
 */
export const CLEAR_COLOR = "#2f5222";

/**
 * Rendering group for gameplay objects (planes, paths, warning rings).
 * Babylon draws groups in order and clears depth between them, so anything
 * in this group always shows on top of the scenery — trees can be taller
 * than the flight altitude without ever hiding a plane or its route.
 */
export const OVERLAY_GROUP = 1;

/**
 * Rendering group for the clouds: drawn after `OVERLAY_GROUP`, so they
 * cover planes and paths too, which is the whole point of them.
 */
export const CLOUD_GROUP = 2;

/** Direction the sun shines (towards the ground, slightly from the side). */
export const SUN_DIRECTION = new Vector3(-0.5, -1, 0.3).normalize();

/** How far back along the sun ray the light sits; must clear every caster. */
export const SUN_DISTANCE = 150;

/**
 * Shadow map covers this multiple of the playfield diagonal. Trees beyond it
 * cast no shadow, which only shows at the far edge of a full zoom-out, and
 * keeping it tight keeps plane shadows crisp.
 */
const SHADOW_COVERAGE = 1.6;

export interface SceneContext {
  engine: Engine;
  scene: Scene;
  /** Shared generator: register anything that should cast a shadow. */
  shadows: ShadowGenerator;
  /** Sky fill light (render/dayCycle.ts retints it through the day). */
  fill: HemisphericLight;
  /** Sun / moon: the shadow-casting key light (moved by render/dayCycle.ts). */
  key: DirectionalLight;
  /** The render settings chosen for this device (render/quality.ts). */
  quality: QualityProfile;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  // Render settings for this device (render/quality.ts): full density and
  // 4x MSAA on desktops, a capped density, no MSAA at high density and a
  // smaller shadow map on phones and tablets. The scale is set below by
  // hand rather than with `adaptToDeviceRatio`, which has no cap.
  const quality = qualityProfile(window.devicePixelRatio, isTouchDevice());
  const engine = new Engine(
    canvas,
    quality.antialias,
    { stencil: false, preserveDrawingBuffer: false },
    false,
  );
  engine.setHardwareScalingLevel(1 / quality.maxScale);
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString(`${CLEAR_COLOR}ff`);

  // Input is handled with plain DOM pointer events (see input/pointer.ts), so
  // skip Babylon's per-event mesh picking entirely.
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;

  // Daytime lighting: a sky fill that bounces green off the grass, plus a
  // warm key "sun" that casts the shadows.
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.65;
  fill.diffuse = new Color3(0.95, 0.97, 1);
  fill.groundColor = new Color3(0.25, 0.35, 0.2);

  const key = new DirectionalLight("key", SUN_DIRECTION.clone(), scene);
  key.intensity = 0.75;
  key.diffuse = new Color3(1, 0.95, 0.85);
  // Directional lights need a position for shadows: it is the eye point of
  // the shadow camera, which looks along the light direction.
  key.position = SUN_DIRECTION.scale(-SUN_DISTANCE);
  key.shadowMinZ = 1;
  key.shadowMaxZ = SUN_DISTANCE * 2;

  // 4096 on desktops: the frustum spans the whole map, so at 2048 a plane's
  // wings were only ~2 texels wide and PCF blurred its shadow into a faint
  // smudge. At 4096 planes cast a crisp, readable silhouette that helps pick
  // them out against the grass. The caster geometry cost is unchanged; only
  // the depth fill grows (holds 60 fps in the full game on a laptop). Phones
  // take the softer 2048 (`TOUCH_SHADOW_MAP`): a quarter of the fill cost,
  // and on a small screen the shadows are small anyway.
  const shadows = new ShadowGenerator(quality.shadowMapSize, key);
  // PCF gives soft-edged shadows for a single texture lookup budget (WebGL2).
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002;
  // 0 = black, 1 = no shadow. Dark enough that plane shadows read at a
  // glance; the sky fill light keeps shaded ground from going murky.
  shadows.darkness = 0.25;

  return { engine, scene, shadows, fill, key, quality };
}

/**
 * Size the (fixed, square) shadow frustum to the playfield. A fixed frustum
 * instead of Babylon's auto-extend, because the thousands of trees across
 * the whole map would otherwise stretch the shadow map until plane shadows
 * were a few blurry texels.
 */
export function fitShadowsToWorld(shadows: ShadowGenerator, world: WorldSize): void {
  const light = shadows.getLight() as DirectionalLight;
  // Planes fly anywhere in the default view (arrivals cross the gap between
  // its edge and the airspace), which in tall or wide windows reaches well
  // past the field's diagonal: stretch to cover the biggest one so they keep
  // a shadow. Window-independent, so a resize never changes it.
  light.shadowFrustumSize = Math.max(
    Math.hypot(world.width, world.height) * SHADOW_COVERAGE,
    2 * maxViewRadius(world),
  );
}
