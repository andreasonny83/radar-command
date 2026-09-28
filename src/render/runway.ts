/**
 * Runway meshes: a paved strip with real-world style markings and lights.
 *
 * Built in the runway's local frame, then placed by a root node rotated so
 * local +x is the landing direction and local z runs across the strip:
 *
 *   approach lights → [threshold bar | piano keys | 32 | TDZ | aiming point | ... | end]
 *        (-x)                                                                        (+x)
 *
 * Gameplay cues stay in the runway's colour: the threshold bar plus a
 * "rabbit" of approach lights that sweeps towards the threshold, showing
 * which end to land on. Everything else is white paint on dark asphalt.
 *
 * Static white markings are merged into a single mesh per runway, and so are
 * the edge lights, so each runway costs a handful of draw calls. After dark
 * the edge and approach lights bloom (the scene's shared glow, glow.ts).
 *
 * Crossing runways (blue and yellow's X) share their pavement where they
 * meet. As on a real airfield, the intersection keeps only the primary
 * runway's centreline (the one listed first): edge lines and edge lights
 * of both stop at the other strip, and the secondary's paint does too.
 */
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX, RUNWAY_THRESHOLD_INSET } from "../config";
import { runwayDesignator } from "../core/layout";
import type { Runway, RunwayColor, Vec2, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { SceneGlow } from "./glow";

// Layer heights (scene y). Everything sits above the grass (0) and stream
// (≤ 0.05) and below planes on their rollout (0.35).
const SHOULDER_TOP = 0.06;
const ASPHALT_TOP = 0.08;
const PAINT_Y = 0.09;
const LIGHT_Y = 0.14;

/** Paved shoulder extends this far past the asphalt on every side. */
const SHOULDER_MARGIN = 0.6;

/** Spacing of the white edge lights along each side. */
const EDGE_LIGHT_SPACING = 2.4;

/** Approach light bars beyond the runway start, and their spacing. */
const APPROACH_LIGHT_COUNT = 5;
const APPROACH_LIGHT_SPACING = 1.2;
/** Seconds for one rabbit sweep from the farthest light to the threshold. */
const RABBIT_PERIOD = 1.1;

/** Sampling step (world units) when splitting edge lines round an intersection. */
const CUT_STEP = 0.05;

/**
 * Where a runway's own markings may go, given the runways crossing it.
 * Works in the runway's local frame: x along the landing direction, z
 * across (to the left of the landing direction, as the root node's +z).
 */
class Clearance {
  private readonly dir: Vec2;
  private readonly left: Vec2;

  constructor(
    private readonly runway: Runway,
    /** Other runways whose pavement overlaps this one. */
    private readonly crossing: readonly Runway[],
  ) {
    const c = Math.cos(runway.heading);
    const s = Math.sin(runway.heading);
    this.dir = { x: c, y: s };
    // Babylon's rotation about y turns local +z into sim (sin h, -cos h).
    this.left = { x: s, y: -c };
  }

  /** True if local (x, z) is clear of every crossing runway's pavement. */
  clear(x: number, z: number, margin = 0): boolean {
    const { center } = this.runway;
    const p = {
      x: center.x + this.dir.x * x + this.left.x * z,
      y: center.y + this.dir.y * x + this.left.y * z,
    };
    return this.crossing.every((o) => !onPavement(p, o, margin));
  }

  /** True if a local rectangle (centre x, z; size length × width) is clear. */
  clearRect(x: number, z: number, length: number, width: number): boolean {
    const hl = length / 2;
    const hw = width / 2;
    return [
      [0, 0],
      [-hl, -hw],
      [-hl, hw],
      [hl, -hw],
      [hl, hw],
    ].every(([dx, dz]) => this.clear(x + dx!, z + dz!));
  }

  /** Sub-ranges of [from, to] along local x, at lateral z, clear of crossings. */
  spans(z: number, from: number, to: number): Array<[number, number]> {
    if (this.crossing.length === 0) return [[from, to]];
    const out: Array<[number, number]> = [];
    let start: number | null = null;
    for (let x = from; x <= to + 1e-9; x += CUT_STEP) {
      const ok = this.clear(x, z, 0.15);
      if (ok && start === null) start = x;
      if (!ok && start !== null) {
        out.push([start, x - CUT_STEP]);
        start = null;
      }
    }
    if (start !== null) out.push([start, to]);
    return out.filter(([a, b]) => b - a > 0.2);
  }
}

/** True if sim point `p` is on `runway`'s pavement (shoulder included). */
function onPavement(p: Vec2, runway: Runway, margin: number): boolean {
  const c = Math.cos(runway.heading);
  const s = Math.sin(runway.heading);
  const dx = p.x - runway.center.x;
  const dy = p.y - runway.center.y;
  const along = dx * c + dy * s;
  const across = -dx * s + dy * c;
  return (
    Math.abs(along) <= runway.length / 2 + SHOULDER_MARGIN + margin &&
    Math.abs(across) <= runway.width / 2 + SHOULDER_MARGIN + margin
  );
}

/** A built runway: its root node plus the lights `update` animates. */
export class RunwayView {
  /** Where the root sits once fully revealed. */
  private readonly center: Vector3;
  /** Scene direction of the landing direction (local +x). */
  private readonly along: Vector3;

  constructor(
    readonly root: TransformNode,
    /** Ordered farthest → nearest to the threshold. */
    private readonly approachLights: Mesh[],
    /** Runway length, to keep the approach end still (see `reveal`). */
    private readonly length: number,
  ) {
    this.center = root.position.clone();
    // Babylon's rotation about y turns local +x into (cos r, 0, -sin r).
    const r = root.rotation.y;
    this.along = new Vector3(Math.cos(r), 0, -Math.sin(r));
  }

  /**
   * How far a newly opened runway has been laid down, 0 (nothing) to 1
   * (whole). It unrolls from its approach end towards the far end (see
   * `SceneSync`'s runway progression): the strip scales along its length,
   * and the root slides so the approach end (local x = -length/2) stays put.
   */
  reveal(k: number): void {
    // A zero scale would make the world matrix singular.
    const s = Math.max(0.001, Math.min(1, k));
    this.root.scaling.x = s;
    const shift = (-this.length / 2) * (1 - s);
    this.root.position.copyFrom(this.center).addInPlace(this.along.scale(shift));
  }

  /** Sweep the approach "rabbit" towards the threshold. `time` in seconds. */
  update(time: number): void {
    const n = this.approachLights.length;
    // Head of the sweep, in light indices; runs a little past the last light
    // so there's a short dark beat before the next sweep.
    const head = ((time % RABBIT_PERIOD) / RABBIT_PERIOD) * (n + 1.5);
    this.approachLights.forEach((light, i) => {
      const glow = Math.max(0, 1 - Math.abs(head - i) * 1.3);
      light.visibility = 0.5 + 0.5 * glow;
    });
  }

  dispose(): void {
    this.root.dispose();
  }
}

export class RunwayFactory {
  private readonly shoulder: StandardMaterial;
  private readonly asphalt: StandardMaterial;
  private readonly paint: StandardMaterial;
  private readonly edgeLight: StandardMaterial;
  private readonly approachMaterials = new Map<RunwayColor, StandardMaterial>();
  /** Number decals, cached by designator so resizes don't leak textures. */
  private readonly numberMaterials = new Map<string, StandardMaterial>();

  constructor(
    private readonly scene: Scene,
    /** Shared runway/plane colour material (lit, with a little glow). */
    private readonly colorMaterial: (color: RunwayColor) => StandardMaterial,
  ) {
    this.shoulder = matte("rwyShoulder", "#8a8f86", scene);
    this.asphalt = matte("rwyAsphalt", "#2e3238", scene);
    this.paint = matte("rwyPaint", "#f1f5f9", scene);
    // Keep paint crisp in shadow: a bit of self-illumination.
    this.paint.emissiveColor = new Color3(0.35, 0.35, 0.35);
    this.edgeLight = unlit("rwyEdgeLight", Color3.FromHexString("#fff3d0"), scene);
  }

  /**
   * @param all  every runway on the field (this one included), so markings
   *   can make way at intersections. Order decides which crossing runway
   *   is primary: the earlier one keeps its centreline through the X.
   */
  create(runway: Runway, world: WorldSize, all: readonly Runway[] = []): RunwayView {
    const crossing = all.filter((o) => o !== runway && pavementsCross(runway, o));
    // Secondary runway: its paint also stops at the primary's pavement.
    const cutPaint = crossing.some((o) => all.indexOf(o) < all.indexOf(runway));
    const clearance = new Clearance(runway, crossing);
    const paintClearance = cutPaint ? clearance : new Clearance(runway, []);

    const root = new TransformNode(`runway-${runway.color}`, this.scene);
    root.position = toScene(runway.center, world);
    root.rotation.y = headingToRotationY(runway.heading);

    const L = runway.length;
    const W = runway.width;
    const thresholdX = -(L / 2 - RUNWAY_THRESHOLD_INSET);

    const shoulder = this.slab(
      "shoulder",
      L + SHOULDER_MARGIN * 2,
      W + SHOULDER_MARGIN * 2,
      0,
      SHOULDER_TOP,
    );
    shoulder.material = this.shoulder;

    const asphalt = this.slab("asphalt", L, W, SHOULDER_TOP, ASPHALT_TOP);
    asphalt.material = this.asphalt;

    // The coloured threshold bar is the landing line (and the colour cue).
    const bar = this.mark(0.9, W - 0.3, thresholdX, 0, 0.012);
    bar.material = this.colorMaterial(runway.color);

    const paint = this.buildPaint(L, W, thresholdX, clearance, paintClearance);
    const number = this.buildNumber(runwayDesignator(runway.heading), thresholdX + 4.5);
    const edgeLights = this.buildEdgeLights(L, W, clearance);
    const approach = this.buildApproachLights(runway.color, L, W);
    // After dark the edge and approach lights bloom (render/glow.ts).
    const glow = SceneGlow.for(this.scene);
    glow.add(edgeLights, true);
    for (const light of approach) glow.add(light, true);

    const parts = [shoulder, asphalt, bar, paint, number, edgeLights, ...approach];
    for (const part of parts) {
      part.parent = root;
      part.isPickable = false;
    }
    // Planes on approach shade the pavement.
    for (const part of [shoulder, asphalt, bar, paint, number]) part.receiveShadows = true;

    return new RunwayView(root, approach, L);
  }

  // -------------------------------------------------------------------------
  // Markings
  // -------------------------------------------------------------------------

  /**
   * All static white paint, merged into one mesh: piano keys, touchdown
   * zone bars, aiming points, centreline dashes, edge lines and end bar.
   *
   * @param edges  where edge lines may run (they always stop at crossings)
   * @param marks  where every other mark may go (stops at crossings only
   *   on a secondary runway)
   */
  private buildPaint(
    L: number,
    W: number,
    thresholdX: number,
    edges: Clearance,
    clear: Clearance,
  ): Mesh {
    const marks: Mesh[] = [];
    const end = L / 2;
    /** Add a mark if it fits before the far end of the runway, clear of crossings. */
    const add = (length: number, width: number, x: number, z: number) => {
      if (x + length / 2 < end - 0.3 && clear.clearRect(x, z, length, width)) {
        marks.push(this.mark(length, width, x, z));
      }
    };
    /** Same mark on both sides of the centreline. */
    const pair = (length: number, width: number, x: number, z: number) => {
      add(length, width, x, z);
      add(length, width, x, -z);
    };

    // Piano keys: 4 stripes each side of a centre gap, just past the threshold.
    const keysX = thresholdX + 1.7;
    for (let i = 0; i < 4; i++) pair(2, 0.28, keysX, 0.35 + 0.14 + i * 0.48);

    // Touchdown zone: 3 bars each side, then 2 further along.
    for (const z of [0.85, 1.2, 1.55]) pair(1.2, 0.16, thresholdX + 7.5, z);
    for (const z of [1.0, 1.35]) pair(1.2, 0.16, thresholdX + 13.5, z);

    // Aiming point: the two big blocks pilots aim for.
    pair(2.4, 0.45, thresholdX + 10.2, 1.25);

    // Centreline dashes, starting after the runway number.
    for (let x = thresholdX + 6.6; x < end - 1; x += 2.1) add(1.2, 0.14, x, 0);

    // Edge lines along the full paved length (broken where another runway
    // crosses), plus an end bar.
    // (Pushed directly: they run right to the end, past `add`'s cutoff.)
    for (const side of [1, -1]) {
      const z = side * (W / 2 - 0.25);
      for (const [a, b] of edges.spans(z, thresholdX - 0.45, end - 0.2)) {
        marks.push(this.mark(b - a, 0.1, (a + b) / 2, z));
      }
    }
    marks.push(this.mark(0.25, W - 0.4, end - 0.35, 0));

    const merged = Mesh.MergeMeshes(marks, true);
    if (!merged) throw new Error("Failed to build runway markings");
    merged.name = "paint";
    merged.material = this.paint;
    return merged;
  }

  /** Runway number decal, reading upright for a plane on approach. */
  private buildNumber(designator: string, x: number): Mesh {
    // With the ground builder's UVs and DynamicTexture's flipped Y, text drawn
    // upright ends up with its "up" along local +x and its "right" along -z:
    // exactly the view of a pilot landing towards +x. So no extra rotation;
    // width (x) is the text's height, height (z) its width.
    const decal = CreateGround("number", { width: 2.6, height: 2.8 }, this.scene);
    decal.rotation.y = Math.PI / 2;
    decal.position.set(x, PAINT_Y + 0.015, 0);
    decal.material = this.numberMaterial(designator);
    return decal;
  }

  private numberMaterial(designator: string): StandardMaterial {
    let mat = this.numberMaterials.get(designator);
    if (mat) return mat;

    const size = 256;
    const tex = new DynamicTexture(`rwyNum-${designator}`, size, this.scene, true);
    tex.hasAlpha = true; // transparent background: only the digits are drawn
    // Condensed, tall digits like real runway numbers. x = null centres it.
    tex.drawText(
      designator,
      null,
      size * 0.84,
      "bold 210px 'Arial Narrow', sans-serif",
      "#ffffff",
      null,
    );

    mat = new StandardMaterial(`rwyNumMat-${designator}`, this.scene);
    mat.diffuseTexture = tex;
    mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    this.numberMaterials.set(designator, mat);
    return mat;
  }

  // -------------------------------------------------------------------------
  // Lights
  // -------------------------------------------------------------------------

  /**
   * Small warm-white lights just outside both edges, merged into one mesh.
   * None on a crossing runway's pavement.
   */
  private buildEdgeLights(L: number, W: number, clear: Clearance): Mesh {
    const lights: Mesh[] = [];
    const count = Math.floor(L / EDGE_LIGHT_SPACING);
    const start = -((count * EDGE_LIGHT_SPACING) / 2);
    for (let i = 0; i <= count; i++) {
      for (const side of [1, -1]) {
        const x = start + i * EDGE_LIGHT_SPACING;
        const z = side * (W / 2 + 0.3);
        if (!clear.clear(x, z, 0.3)) continue;
        const light = CreateBox("edgeLight", { size: 0.16 }, this.scene);
        light.position.set(x, LIGHT_Y, z);
        lights.push(light);
      }
    }
    const merged = Mesh.MergeMeshes(lights, true);
    if (!merged) throw new Error("Failed to build runway edge lights");
    merged.name = "edgeLights";
    merged.material = this.edgeLight;
    return merged;
  }

  /**
   * Approach lights on the grass before the runway start, in the runway's
   * colour. The middle bar is a wide crossbar, like a real approach system.
   * Returned farthest-first so the rabbit sweeps towards the threshold.
   */
  private buildApproachLights(color: RunwayColor, L: number, W: number): Mesh[] {
    const mat = this.approachMaterial(color);
    const lights: Mesh[] = [];
    for (let k = APPROACH_LIGHT_COUNT; k >= 1; k--) {
      const crossbar = k === 3;
      const light = CreateBox(
        "approachLight",
        { width: 0.45, height: 0.14, depth: crossbar ? W + 1 : 2 },
        this.scene,
      );
      light.position.set(-L / 2 - SHOULDER_MARGIN - k * APPROACH_LIGHT_SPACING, LIGHT_Y, 0);
      light.material = mat;
      lights.push(light);
    }
    return lights;
  }

  private approachMaterial(color: RunwayColor): StandardMaterial {
    let mat = this.approachMaterials.get(color);
    if (!mat) {
      mat = unlit(`rwyApproach-${color}`, Color3.FromHexString(COLOR_HEX[color]), this.scene);
      this.approachMaterials.set(color, mat);
    }
    return mat;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** A flat box from `bottom` to `top`, `length` along x and `width` across. */
  private slab(name: string, length: number, width: number, bottom: number, top: number): Mesh {
    const box = CreateBox(name, { width: length, height: top - bottom, depth: width }, this.scene);
    box.position.y = (bottom + top) / 2;
    return box;
  }

  /** A thin painted rectangle centred at local (x, z). */
  private mark(length: number, width: number, x: number, z: number, lift = 0): Mesh {
    const box = CreateBox("mark", { width: length, height: 0.02, depth: width }, this.scene);
    box.position.set(x, PAINT_Y + lift, z);
    return box;
  }
}

/** True if the paved strips of `a` and `b` overlap (sampled along `a`). */
function pavementsCross(a: Runway, b: Runway): boolean {
  const c = Math.cos(a.heading);
  const s = Math.sin(a.heading);
  const half = a.length / 2 + SHOULDER_MARGIN;
  const side = a.width / 2 + SHOULDER_MARGIN;
  for (let x = -half; x <= half; x += 0.5) {
    for (const z of [-side, 0, side]) {
      const p = { x: a.center.x + c * x + s * z, y: a.center.y + s * x - c * z };
      if (onPavement(p, b, 0)) return true;
    }
  }
  return false;
}

/** Lit material with no specular highlight. */
function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  return mat;
}

/** Unlit, self-coloured material for lights (ignores scene lighting). */
function unlit(name: string, color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = color;
  return mat;
}
