/**
 * Mesh + material factory: aircraft, warning/hover/anchor rings, the red
 * "no landing" ring and X (runways live in runway.ts). Aircraft lights glow
 * through the scene's shared glow (glow.ts).
 *
 * Aircraft are built once per (model, colour) as a hidden template (see
 * aircraft.ts) and then cloned, so every plane of a kind and colour shares
 * geometry, and all planes share one vertex-coloured paint material.
 */
import { FresnelParameters } from "@babylonjs/core/Materials/fresnelParameters";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
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
import { SceneGlow } from "./glow";
import { lampMaterial, litNow, poolMaterial, setNightLevel } from "./nightLights";
import { OVERLAY_GROUP } from "./scene";

/**
 * The "no landing" mark mirrors the green anchor ring: the same ring (a
 * `2 × ANCHOR_RADIUS` torus, `MARK_STROKE` thick), in red, with an X
 * inside. The X's arms span `REJECT_X_SPAN` of the ring's inside, leaving
 * a gap to the ring.
 */
const MARK_STROKE = 0.5;
const REJECT_X_SPAN = 0.7;

/**
 * Readability floor at night (see `MeshFactory.setNight`): self-light on
 * the aircraft livery (grey, multiplied by the vertex colours, so hues
 * stay saturated) and on the shared runway/plane colour materials.
 */
const LIVERY_GLOW_DAY = 0.08;
const LIVERY_GLOW_NIGHT = 0.85;
const COLOR_GLOW_DAY = 0.35;
const COLOR_GLOW_NIGHT = 0.7;

/**
 * Aircraft landing lights (see aircraft.ts `headlight` / `headBeam`): lamp
 * and beam colour, and the beam's strength at full night. The beam is
 * additive, so it brightens whatever it crosses: keep it soft, or planes
 * over the lit runways wash out.
 */
const HEADLIGHT = "#fff4d6";
const HEADLIGHT_BEAM = "#fff1cf";
const HEADLIGHT_BEAM_STRENGTH = 0.35;

export class MeshFactory {
  private readonly colorMaterials = new Map<PlaneColor, StandardMaterial>();
  private readonly aircraftTemplates = new Map<string, Mesh>();
  private readonly aircraftMaterials: AircraftMaterials;
  /** The scene's shared glow (render/glow.ts): halos round the aircraft lights. */
  private readonly glow: SceneGlow;
  /** 0 day … 1 night (see `setNight`). */
  private night = 0;
  private readonly warning: StandardMaterial;
  private readonly anchor: StandardMaterial;
  private readonly reject: StandardMaterial;
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

    // Reject mark: the anchor ring's red twin, "no landing" (see
    // `createRejectMark`). Unlit like it.
    this.reject = new StandardMaterial("reject", scene);
    this.reject.disableLighting = true;
    this.reject.emissiveColor = Color3.FromHexString("#ef4444");

    // Hover ring: unlit white "grab me" halo. Neutral on purpose: it must
    // not read as a team colour (red plane) or as the red warning ring.
    this.hover = new StandardMaterial("hover", scene);
    this.hover.disableLighting = true;
    this.hover.emissiveColor = Color3.White();

    this.aircraftMaterials = this.makeAircraftMaterials();
    this.glow = SceneGlow.for(scene);
  }

  /** Shared material for a runway/plane colour. */
  material(color: PlaneColor): StandardMaterial {
    let mat = this.colorMaterials.get(color);
    if (!mat) {
      mat = this.makeMaterial(`color-${color}`, COLOR_HEX[color], COLOR_GLOW_DAY);
      this.colorMaterials.set(color, mat);
      this.tintColor(color, mat);
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
    for (const mesh of rig.lights) this.glow.add(mesh);
    // Landing lights: a halo at night only, and shown only if it's dark
    // now (setNight toggles them as the night comes and goes).
    const lit = litNow(this.aircraftMaterials.headlight as StandardMaterial);
    for (const mesh of rig.headlights) {
      this.glow.add(mesh, true);
      mesh.isVisible = lit;
    }
    for (const mesh of rig.headBeams) mesh.isVisible = lit;
    return rig;
  }

  /** Dispose a plane made by `createAircraft`, children and glow entries too. */
  disposeAircraft(rig: AircraftRig): void {
    // Children (and their glow entries, see SceneGlow.add) go with the root.
    rig.root.dispose();
  }

  /**
   * 0 day … 1 night. Brightens the glow and raises the self-light of the
   * liveries and the runway colours, so red, blue, yellow and violet read
   * as clearly at night as by day. Paths and rings are unlit already.
   */
  setNight(n: number): void {
    this.night = n;
    this.glow.setNight(n);
    const livery = LIVERY_GLOW_DAY + (LIVERY_GLOW_NIGHT - LIVERY_GLOW_DAY) * n;
    // `paint` is typed as Material in AircraftMaterials; it's the
    // StandardMaterial built in makeAircraftMaterials.
    const paint = this.aircraftMaterials.paint as StandardMaterial;
    paint.emissiveColor.set(livery, livery, livery);
    // The paint's emissive goes through its rim Fresnel, whose face-on
    // colour is black: by day only the silhouette edge is self-lit. At
    // night the face-on side lights up too, or the boost above would only
    // ever reach the rims.
    paint.emissiveFresnelParameters?.rightColor.set(n, n, n);
    // Landing lights: typed as Material in AircraftMaterials, built as
    // StandardMaterials in makeAircraftMaterials.
    setNightLevel(this.aircraftMaterials.headlight as StandardMaterial, n);
    setNightLevel(this.aircraftMaterials.headBeam as StandardMaterial, n * HEADLIGHT_BEAM_STRENGTH);
    for (const [color, mat] of this.colorMaterials) this.tintColor(color, mat);
  }

  /** Colour material self-light for the current `night`. */
  private tintColor(color: PlaneColor, mat: StandardMaterial): void {
    const glow = COLOR_GLOW_DAY + (COLOR_GLOW_NIGHT - COLOR_GLOW_DAY) * this.night;
    Color3.FromHexString(COLOR_HEX[color]).scaleToRef(glow, mat.emissiveColor);
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

  /**
   * Red ring with an X inside: "this landing won't happen", the red twin of
   * the green anchor ring (same size and stroke), shown where a path ends
   * on a runway without locking on (see render/rejectMarks.ts). The root is
   * the ring; the X is its child. Hidden until shown.
   */
  createRejectMark(name: string): Mesh {
    const ring = CreateTorus(
      name,
      { diameter: ANCHOR_RADIUS * 2, thickness: MARK_STROKE, tessellation: 48 },
      this.scene,
    );
    const inside = ANCHOR_RADIUS * 2 - MARK_STROKE;
    const cross = this.crossMesh(`${name}-x`, inside * REJECT_X_SPAN, MARK_STROKE);
    cross.parent = ring;
    for (const mesh of [ring, cross]) {
      mesh.material = this.reject;
      mesh.isPickable = false;
      mesh.renderingGroupId = OVERLAY_GROUP;
    }
    ring.setEnabled(false);
    return ring;
  }

  /** Two flat bars `length` long and `width` wide, crossed at 45°. */
  private crossMesh(name: string, length: number, width: number): Mesh {
    const bars = [Math.PI / 4, -Math.PI / 4].map((angle, i) => {
      const bar = CreateBox(
        `${name}-${i}`,
        { width: length, height: MARK_STROKE, depth: width },
        this.scene,
      );
      bar.rotation.y = angle;
      return bar;
    });
    return Mesh.MergeMeshes(bars, true)!;
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
      headlight: lampMaterial("headlight", HEADLIGHT, this.scene),
      headBeam: poolMaterial("headlight-beam", HEADLIGHT_BEAM, this.scene),
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
