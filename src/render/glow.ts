/**
 * The scene's one glow layer: soft halos round small bright lights.
 *
 * Aircraft lights (nav, strobe, beacon) glow at any hour. Scenery lights
 * (runway and taxi lights, lamps, headlights, lanterns) are added as
 * "night-only": their halo is scaled by `night`, so by day they look
 * exactly as they always have and after dark they bloom. One layer keeps
 * it to a single extra render pass however many lights there are.
 *
 * Shared per scene (`SceneGlow.for`), so any renderer can add its lights
 * without the layer being passed around.
 */
import "@babylonjs/core/Layers/effectLayerSceneComponent"; // side effect: effect layer rendering
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** Halo strength by day, and how much more it gets at full night. */
const DAY_INTENSITY = 1.1;
const NIGHT_BOOST = 0.5;

const glows = new WeakMap<Scene, SceneGlow>();

export class SceneGlow {
  readonly layer: GlowLayer;
  private night = 0;
  /** `uniqueId`s of meshes whose halo scales with `night`. */
  private readonly nightOnly = new Set<number>();

  private constructor(scene: Scene) {
    // Exclude by default: with an empty include list (no planes yet) the
    // layer would otherwise make every emissive surface glow.
    this.layer = new GlowLayer("lights-glow", scene, {
      mainTextureRatio: 0.5,
      blurKernelSize: 24,
      excludeByDefault: true,
    });
    this.layer.intensity = DAY_INTENSITY;
    // The layer's default is emissive × alpha; night-only lights also
    // scale by `night`. The layer never reads `mesh.visibility`, so it's
    // applied here: blinking and fading lights (beacons, the approach
    // rabbit, barrier lights, fading-in airfields) pulse in their halos
    // too. (This replaces Babylon's default, which also handles
    // emissiveIntensity and emissive textures: nothing included uses them.)
    this.layer.customEmissiveColorSelector = (mesh, _subMesh, material, result) => {
      const e = (material as StandardMaterial).emissiveColor;
      if (!e) {
        result.set(0, 0, 0, material.alpha);
        return;
      }
      const k = (this.nightOnly.has(mesh.uniqueId) ? this.night : 1) * mesh.visibility;
      result.set(e.r * k, e.g * k, e.b * k, material.alpha);
    };
  }

  /** The glow for `scene`, created on first use. */
  static for(scene: Scene): SceneGlow {
    let glow = glows.get(scene);
    if (!glow) {
      glow = new SceneGlow(scene);
      glows.set(scene, glow);
    }
    return glow;
  }

  /**
   * Give `mesh` a halo; `nightOnly` scales it by `night`. The mesh is
   * dropped from the layer when it's disposed (the layer keeps ids of
   * included meshes and wouldn't drop them itself).
   */
  add(mesh: Mesh, nightOnly = false): void {
    this.layer.addIncludedOnlyMesh(mesh);
    if (nightOnly) this.nightOnly.add(mesh.uniqueId);
    mesh.onDisposeObservable.addOnce(() => this.remove(mesh));
  }

  remove(mesh: Mesh): void {
    this.layer.removeIncludedOnlyMesh(mesh);
    this.nightOnly.delete(mesh.uniqueId);
  }

  /** 0 day … 1 night: night-only halos fade in, every halo gets a bit stronger. */
  setNight(n: number): void {
    this.night = n;
    this.layer.intensity = DAY_INTENSITY + NIGHT_BOOST * n;
  }
}
