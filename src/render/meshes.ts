/**
 * Mesh + material factory: aircraft, warning/hover/anchor rings (runways live in
 * runway.ts) and the glow layer for aircraft lights.
 *
 * Aircraft are built once per (model, colour) as a hidden template (see
 * aircraft.ts) and then cloned, so every plane of a kind and colour shares
 * geometry, and all planes share one vertex-coloured paint material.
 */
import "@babylonjs/core/Layers/effectLayerSceneComponent"; // side effect: effect layer rendering
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { ANCHOR_RADIUS, COLOR_HEX, PLANE_RADIUS } from "../config";
import type { PlaneColor } from "../core/types";
import {
  buildAircraftTemplate,
  rigFromClone,
  type AircraftKind,
  type AircraftMaterials,
  type AircraftRig,
} from "./aircraft";
import { OVERLAY_GROUP } from "./scene";

export class MeshFactory {
  private readonly colorMaterials = new Map<PlaneColor, StandardMaterial>();
  private readonly aircraftTemplates = new Map<string, Mesh>();
  private readonly aircraftMaterials: AircraftMaterials;
  /** Soft halo around nav lights and strobes; only lights are included. */
  private readonly glow: GlowLayer;
  private readonly warning: StandardMaterial;
  private readonly anchor: StandardMaterial;
  private readonly hover: StandardMaterial;

  constructor(private readonly scene: Scene) {
    // Warning ring: unlit, translucent red that the sync layer pulses.
    this.warning = new StandardMaterial("warning", scene);
    this.warning.disableLighting = true;
    this.warning.emissiveColor = Color3.FromHexString("#ef4444");
    this.warning.alpha = 0.5;

    // Anchor ring: unlit green "connected" marker, pulsed by the sync layer.
    this.anchor = new StandardMaterial("anchor", scene);
    this.anchor.disableLighting = true;
    this.anchor.emissiveColor = Color3.FromHexString("#22c55e");

    // Hover ring: unlit white "grab me" halo. Neutral on purpose: it must
    // not read as a team colour (red plane) or as the red warning ring.
    this.hover = new StandardMaterial("hover", scene);
    this.hover.disableLighting = true;
    this.hover.emissiveColor = Color3.White();

    this.aircraftMaterials = this.makeAircraftMaterials();
    // Exclude by default: with an empty include list (no planes yet) the
    // layer would otherwise make every emissive surface glow.
    this.glow = new GlowLayer("aircraft-lights", scene, {
      mainTextureRatio: 0.5,
      blurKernelSize: 24,
      excludeByDefault: true,
    });
    this.glow.intensity = 1.1;
  }

  /** Shared material for a runway/plane colour. */
  material(color: PlaneColor): StandardMaterial {
    let mat = this.colorMaterials.get(color);
    if (!mat) {
      mat = this.makeMaterial(`color-${color}`, COLOR_HEX[color], 0.35);
      this.colorMaterials.set(color, mat);
    }
    return mat;
  }

  /**
   * New aircraft of `kind` in `color` (nose along +x, centred on the
   * origin), with its animated parts sorted into a rig.
   */
  createAircraft(kind: AircraftKind, color: PlaneColor, id: number, name: string): AircraftRig {
    const key = `${kind}-${color}`;
    let template = this.aircraftTemplates.get(key);
    if (!template) {
      const team = Color3.FromHexString(COLOR_HEX[color]);
      template = buildAircraftTemplate(
        this.scene,
        kind,
        team,
        this.aircraftMaterials,
        `tpl-${key}`,
      );
      this.aircraftTemplates.set(key, template);
    }
    const root = template.clone(name);
    root.setEnabled(true);
    const rig = rigFromClone(kind, root, id);
    // Rendering group is set per clone: it isn't copied from the template.
    for (const mesh of rig.all) mesh.renderingGroupId = OVERLAY_GROUP;
    for (const mesh of rig.lights) this.glow.addIncludedOnlyMesh(mesh);
    return rig;
  }

  /** Dispose a plane made by `createAircraft`, children and glow entries too. */
  disposeAircraft(rig: AircraftRig): void {
    // The glow layer keeps ids of included meshes and doesn't drop them on
    // dispose, so remove them by hand or the list grows every plane.
    for (const mesh of rig.lights) this.glow.removeIncludedOnlyMesh(mesh);
    rig.root.dispose();
  }

  /** Flat red ring shown around planes on a collision course. */
  createWarningRing(name: string): Mesh {
    const ring = CreateTorus(
      name,
      { diameter: PLANE_RADIUS * 3.6, thickness: 0.35, tessellation: 32 },
      this.scene,
    );
    ring.material = this.warning;
    ring.isPickable = false;
    ring.renderingGroupId = OVERLAY_GROUP;
    return ring;
  }

  /**
   * Flat white ring shown around a plane the pointer hovers or holds, so it
   * reads as draggable. Sized inside the warning ring, so both show when a
   * plane is hovered and in conflict. Faded in and out by the sync layer.
   */
  createHoverRing(name: string): Mesh {
    const ring = CreateTorus(
      name,
      { diameter: PLANE_RADIUS * 2.8, thickness: 0.3, tessellation: 40 },
      this.scene,
    );
    ring.material = this.hover;
    ring.isPickable = false;
    ring.renderingGroupId = OVERLAY_GROUP;
    ring.setEnabled(false);
    return ring;
  }

  /**
   * Flat green ring marking the anchor area around a runway threshold,
   * shown while a plane's path is locked onto it.
   */
  createAnchorRing(name: string): Mesh {
    const ring = CreateTorus(
      name,
      { diameter: ANCHOR_RADIUS * 2, thickness: 0.5, tessellation: 48 },
      this.scene,
    );
    ring.material = this.anchor;
    ring.isPickable = false;
    ring.renderingGroupId = OVERLAY_GROUP;
    ring.setEnabled(false);
    return ring;
  }

  /** Materials shared by every aircraft part (see aircraft.ts). */
  private makeAircraftMaterials(): AircraftMaterials {
    const paint = new StandardMaterial("aircraft-paint", this.scene);
    // White diffuse: the per-vertex livery colours supply the hue.
    paint.diffuseColor = Color3.White();
    // Glossy paint: a tight, bright sun glint that slides along the fuselage
    // and wings as the plane turns. The sparkle is what catches the eye
    // against the matte landscape (nothing else in the scene is this shiny).
    paint.specularColor = new Color3(0.55, 0.55, 0.52);
    paint.specularPower = 48;
    // Rim light on surfaces edge-on to the camera: a pale sky-lit edge that
    // lifts the silhouette off the grass without a hard outline, and without
    // washing out the team colour on the faces turned towards the camera.
    paint.emissiveColor = new Color3(0.08, 0.08, 0.08);
    paint.emissiveFresnelParameters = new FresnelParameters({
      bias: 0.15,
      power: 1.6,
      leftColor: new Color3(0.5, 0.53, 0.58),
      rightColor: Color3.Black(),
    });
    // Thin slabs (wings, fins) are modelled without caring about winding.
    paint.backFaceCulling = false;

    const disc = new StandardMaterial("prop-disc", this.scene);
    disc.disableLighting = true;
    disc.emissiveColor = new Color3(0.75, 0.78, 0.82);
    disc.alpha = 0.16;
    disc.backFaceCulling = false;

    const lamp = (name: string, hex: string) => {
      const mat = new StandardMaterial(name, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(hex);
      return mat;
    };
    return {
      paint,
      propDisc: disc,
      navRed: lamp("nav-red", "#ff3b3b"),
      navGreen: lamp("nav-green", "#3bff6a"),
      strobe: lamp("strobe", "#ffffff"),
      beacon: lamp("beacon", "#ff2020"),
    };
  }

  private makeMaterial(name: string, hex: string, glow: number): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    const color = Color3.FromHexString(hex);
    mat.diffuseColor = color;
    // A little self-illumination keeps colours readable on the dark field.
    mat.emissiveColor = color.scale(glow);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    return mat;
  }
}
