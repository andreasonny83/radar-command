/**
 * The clouds (core/clouds.ts): formations of cumulus that drift over the map
 * and dim whatever is under them, planes and paths included, with thin cirrus
 * wisps high above and a soft shadow on the ground under each formation.
 *
 * Each cloud is a flat quad high above the ground, drawn in its own
 * rendering group after the gameplay objects (`CLOUD_GROUP`), so it covers
 * them. The pictures (render/cloudTextures.ts) are painted once and shared;
 * a cloud is only a mesh that is moved and faded every frame. The cirrus float
 * higher than the formations, so they shift against them when the camera
 * pans or turns. A formation's shadow is the same picture in black, lying
 * on the ground (in the ordinary group, so trees and buildings still stand
 * out of it) and offset the way the sun's light falls; it fades away at
 * night. Clouds are never pickable, so a path can still be drawn through
 * one. Purely visual: this reads `cloudsAt` and draws.
 *
 * Changing how it looks? Edit the constants below, the pictures in
 * render/cloudTextures.ts and CLOUD_* in config.ts (count, size, speed,
 * opacity, altitude); the "Scene/Clouds" stories show them all.
 */
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import {
  CLOUD_ALTITUDE,
  CLOUD_CIRRUS_OPACITY,
  CLOUD_HIGH_ALTITUDE,
  CLOUD_OPACITY,
  CLOUD_SHADOW_OPACITY,
} from "../config";
import {
  CIRRUS_ASPECT,
  CIRRUS_VARIANTS,
  CLOUD_SHAPES,
  FORMATION_ASPECT,
  cloudsAt,
  type Cloud,
} from "../core/clouds";
import type { WorldSize } from "../core/types";
import { CIRRUS_WIDTH, FORMATION_WIDTH, paintCirrus, paintFormation } from "./cloudTextures";
import { headingToRotationY, toScene } from "./coords";
import { CLOUD_GROUP, SUN_DIRECTION } from "./scene";

/** Colour of a cloud by day, and by night (the clouds go a dark slate). */
const DAY_COLOR = Color3.FromHexString("#ffffff");
const NIGHT_COLOR = Color3.FromHexString("#44506e");

/** Height of a shadow over the ground: above the fields and runways, under the planes. */
const SHADOW_ALTITUDE = 0.3;

/**
 * Where a formation's shadow falls relative to the formation (sim units):
 * the sun's ray (`SUN_DIRECTION`) carried from `CLOUD_ALTITUDE` down to the
 * ground. Scene z is sim -y.
 */
const SHADOW_SHIFT = {
  x: (SUN_DIRECTION.x * CLOUD_ALTITUDE) / -SUN_DIRECTION.y,
  y: -((SUN_DIRECTION.z * CLOUD_ALTITUDE) / -SUN_DIRECTION.y),
};

/** The meshes of one cloud: the cloud itself, and the shadow (formations only). */
interface Slot {
  cloud: Mesh;
  shadow: Mesh | null;
}

/** A flat 1 x 1 quad, scaled to each cloud's size every frame. */
function quad(scene: Scene, name: string): Mesh {
  const mesh = CreateGround(name, { width: 1, height: 1 }, scene);
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.isVisible = false;
  return mesh;
}

/** The clouds in a scene, moved along with `GameState.elapsed`. */
export class CloudsView {
  private readonly textures: DynamicTexture[] = [];
  /** Material of each picture: formations first (by `CLOUD_SHAPES` index), then cirrus. */
  private readonly materials: StandardMaterial[] = [];
  /** Black versions of the formation materials, for the shadows. */
  private readonly shadowMaterials: StandardMaterial[] = [];
  private readonly slots: Slot[] = [];
  private night = 0;

  constructor(private readonly scene: Scene) {
    const formationHeight = Math.round(FORMATION_WIDTH * FORMATION_ASPECT);
    CLOUD_SHAPES.forEach((shape, i) => {
      const tex = this.texture(`cloud${i}`, FORMATION_WIDTH, formationHeight);
      paintFormation(
        tex.getContext() as CanvasRenderingContext2D,
        shape,
        1000 + i * 97,
        FORMATION_WIDTH,
        formationHeight,
      );
      tex.update();
      this.materials.push(this.material(tex, false));
      this.shadowMaterials.push(this.material(tex, true));
    });
    const cirrusHeight = Math.round(CIRRUS_WIDTH * CIRRUS_ASPECT);
    for (let i = 0; i < CIRRUS_VARIANTS; i++) {
      const tex = this.texture(`cirrus${i}`, CIRRUS_WIDTH, cirrusHeight);
      paintCirrus(
        tex.getContext() as CanvasRenderingContext2D,
        500 + i * 53,
        CIRRUS_WIDTH,
        cirrusHeight,
      );
      tex.update();
      this.materials.push(this.material(tex, false));
    }
  }

  private texture(name: string, width: number, height: number): DynamicTexture {
    const tex = new DynamicTexture(name, { width, height }, this.scene);
    tex.hasAlpha = true;
    this.textures.push(tex);
    return tex;
  }

  /**
   * An unlit material for a picture: only the emissive colour shows,
   * multiplied by the picture, so `setNight` tints the clouds through it.
   * A `shadow` one is black instead, and takes only the picture's shape.
   */
  private material(texture: DynamicTexture, shadow: boolean): StandardMaterial {
    const mat = new StandardMaterial(`${texture.name}${shadow ? "-shadow" : ""}`, this.scene);
    mat.diffuseTexture = texture;
    mat.useAlphaFromDiffuseTexture = true;
    mat.diffuseColor = Color3.Black();
    mat.emissiveColor = shadow ? Color3.Black() : DAY_COLOR.clone();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    return mat;
  }

  /** Tint the clouds for the time of day: 0 day … 1 night (see `SceneSync.setNight`). */
  setNight(night: number): void {
    this.night = night;
    for (const mat of this.materials) {
      Color3.LerpToRef(DAY_COLOR, NIGHT_COLOR, night, mat.emissiveColor);
    }
  }

  /** The meshes for `cloud`, made the first time it is seen (the set of clouds never changes). */
  private makeSlot(cloud: Cloud, index: number): Slot {
    const main = cloud.layer === "main";
    const pic = main ? cloud.variant : CLOUD_SHAPES.length + cloud.variant;
    const mesh = quad(this.scene, `cloud-${index}`);
    mesh.renderingGroupId = CLOUD_GROUP;
    mesh.material = this.materials[pic]!;
    let shadow: Mesh | null = null;
    if (main) {
      shadow = quad(this.scene, `cloud-shadow-${index}`);
      shadow.material = this.shadowMaterials[pic]!;
    }
    return { cloud: mesh, shadow };
  }

  /** Move, turn and fade every cloud to where it is `elapsed` seconds into the shift. */
  sync(elapsed: number, world: WorldSize): void {
    const clouds = cloudsAt(elapsed, world);
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i]!;
      const slot = (this.slots[i] ??= this.makeSlot(cloud, i));
      const main = cloud.layer === "main";
      const rotation = headingToRotationY(cloud.rotation);
      const visible = cloud.strength > 0;

      slot.cloud.isVisible = visible;
      if (visible) {
        const altitude = main ? CLOUD_ALTITUDE : CLOUD_HIGH_ALTITUDE;
        toScene(cloud.center, world, altitude, slot.cloud.position);
        slot.cloud.rotation.y = rotation;
        slot.cloud.scaling.set(cloud.length, 1, cloud.width);
        slot.cloud.visibility = (main ? CLOUD_OPACITY : CLOUD_CIRRUS_OPACITY) * cloud.strength;
      }

      const shadow = slot.shadow;
      if (!shadow) continue;
      const shadowStrength = CLOUD_SHADOW_OPACITY * cloud.strength * (1 - this.night);
      shadow.isVisible = shadowStrength > 0;
      if (!shadow.isVisible) continue;
      const at = { x: cloud.center.x + SHADOW_SHIFT.x, y: cloud.center.y + SHADOW_SHIFT.y };
      toScene(at, world, SHADOW_ALTITUDE, shadow.position);
      shadow.rotation.y = rotation;
      shadow.scaling.set(cloud.length, 1, cloud.width);
      shadow.visibility = shadowStrength;
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.cloud.dispose(false, false);
      slot.shadow?.dispose(false, false);
    }
    for (const mat of [...this.materials, ...this.shadowMaterials]) mat.dispose();
    for (const tex of this.textures) tex.dispose();
  }
}
