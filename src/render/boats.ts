/**
 * Low-poly river boats: a little sailboat and a motorboat, synced every
 * frame from `core/boats.ts` traffic.
 *
 * Each model is built once as a template (flat-shaded, colours baked into
 * vertex colours, like the trees' canopies), then cloned per boat so every
 * boat can fade in and out on its own `visibility`. Each carries a lantern
 * (masthead or cabin roof) that lights up at night (`setNight`).
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { boatPose, type BoatKind, type BoatTraffic } from "../core/boats";
import type { WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { SceneGlow } from "./glow";
import { lampMaterial, setNightLevel } from "./nightLights";

/** Water surface height (matches landscape.ts `WATER_Y`). */
const WATER_Y = 0.04;

/**
 * Boats are modelled at roughly true size next to the planes, then scaled
 * up so they read at game zoom (the trees are oversized for the same reason).
 */
const BOAT_SCALE = 1.6;

const HULL_WHITE = Color3.FromHexString("#f2efe8");
const HULL_NAVY = Color3.FromHexString("#2d4b78");
const DECK_WOOD = Color3.FromHexString("#c49a63");
const DECK_GREY = Color3.FromHexString("#d5dade");
const SAIL = Color3.FromHexString("#fbfaf5");
const JIB = Color3.FromHexString("#efe6d2");
const MAST = Color3.FromHexString("#5b4a3a");
const CABIN_ROOF = Color3.FromHexString("#d9483b");
const GLASS = Color3.FromHexString("#27415c");

type V3 = [number, number, number];

/**
 * Triangle soup with one flat colour per triangle; `build` turns it into an
 * un-indexed mesh, so every face gets its own normal (the low-poly look).
 */
class ModelBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  tri(a: V3, b: V3, c: V3, color: Color3): void {
    for (const v of [a, b, c]) {
      this.positions.push(...v);
      this.colors.push(color.r, color.g, color.b, 1);
    }
  }

  /** Quad as two triangles (a → b → c → d around the edge). */
  quad(a: V3, b: V3, c: V3, d: V3, color: Color3): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Thin flat panel visible from both sides (sails). */
  panel(a: V3, b: V3, c: V3, color: Color3): void {
    this.tri(a, b, c, color);
    this.tri(a, c, b, color);
  }

  /**
   * Prism between two rings of the same size (`top` above `bottom`), with
   * a flat lid on top. Rings go round in the same order, convex.
   */
  prism(top: V3[], bottom: V3[], side: Color3, lid: Color3): void {
    const n = top.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(top[i]!, bottom[i]!, bottom[j]!, top[j]!, side);
    }
    // Fan the lid from its first vertex (fine for convex rings).
    for (let i = 1; i < n - 1; i++) this.tri(top[0]!, top[i + 1]!, top[i]!, lid);
  }

  /** Axis-aligned box from `min` to `max`, one colour per side group. */
  box(min: V3, max: V3, side: Color3, lid: Color3, front?: Color3): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const top: V3[] = [
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ];
    const bottom: V3[] = top.map(([x, , z]) => [x, y0, z]);
    this.prism(top, bottom, side, lid);
    // Re-paint the forward (+x) face, e.g. a windscreen.
    if (front) this.quad(top[0]!, bottom[0]!, bottom[1]!, top[1]!, front);
  }

  build(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions;
    data.colors = this.colors;
    data.indices = this.positions.map((_, i) => i).slice(0, this.positions.length / 3);
    const normals: number[] = [];
    VertexData.ComputeNormals(data.positions, data.indices, normals);
    data.normals = normals;
    data.applyToMesh(mesh);
    return mesh;
  }
}

/**
 * Hull outline: square-ish stern, straight sides, pointed bow (nose along
 * +x, like the aircraft). The keel ring is narrower and shorter, so the
 * sides slope in.
 */
function hull(b: ModelBuilder, length: number, beam: number, side: Color3, deck: Color3): void {
  const h = length / 2;
  const w = beam / 2;
  const ring = (y: number, sx: number, sw: number): V3[] => [
    [h * sx, y, 0],
    [h * 0.3, y, w * sw],
    [-h * 0.95, y, w * sw * 0.85],
    [-h * 0.95, y, -w * sw * 0.85],
    [h * 0.3, y, -w * sw],
  ];
  b.prism(ring(0.32, 1, 1), ring(-0.12, 0.8, 0.55), side, deck);
}

/** Small sloop: navy hull, wooden deck, mainsail and jib. */
function sailboatModel(scene: Scene): Mesh {
  const b = new ModelBuilder();
  hull(b, 2.8, 1.05, HULL_NAVY, DECK_WOOD);
  b.box([0.12, 0.32, -0.05], [0.22, 3.4, 0.05], MAST, MAST);
  // Mainsail: mast to boom, sweeping back towards the stern.
  b.panel([0.1, 0.55, 0], [0.1, 3.3, 0], [-1.15, 0.6, 0], SAIL);
  // Jib: forestay from masthead down to the bow.
  b.panel([0.25, 3.05, 0], [1.3, 0.4, 0], [0.25, 0.5, 0], JIB);
  return b.build("sailboat", scene);
}

/** Little cabin cruiser: white hull, grey deck, red-roofed cabin. */
function motorboatModel(scene: Scene): Mesh {
  const b = new ModelBuilder();
  hull(b, 2.6, 1.15, HULL_WHITE, DECK_GREY);
  b.box([-0.55, 0.32, -0.38], [0.35, 0.78, 0.38], HULL_WHITE, CABIN_ROOF, GLASS);
  return b.build("motorboat", scene);
}

export class BoatFleet {
  /** One hidden template per kind; each boat is a clone. */
  private readonly templates: Record<BoatKind, Mesh>;
  private readonly views = new Map<number, Mesh>();
  /** Masthead / cabin-roof lanterns, lit at night. */
  private readonly lanternMat: StandardMaterial;

  constructor(
    scene: Scene,
    private readonly shadows: ShadowGenerator,
  ) {
    const bodyMat = new StandardMaterial("boatMat", scene);
    bodyMat.diffuseColor = Color3.White(); // colour comes from the vertices
    bodyMat.specularColor = Color3.Black();
    // A touch of self-light so white sails stay white even edge-on to the sun.
    bodyMat.emissiveColor = new Color3(0.22, 0.22, 0.22);
    // Sails are single panels seen from both sides; light both faces.
    bodyMat.backFaceCulling = false;
    bodyMat.twoSidedLighting = true;

    this.lanternMat = lampMaterial("boatLantern", "#ffd27a", scene);
    // A lantern at the masthead (sailboat) or on the cabin roof: a child
    // of the template, so every clone carries its own.
    const lantern = (body: Mesh, x: number, y: number) => {
      const lamp = CreateSphere(`${body.name}-lantern`, { diameter: 0.14, segments: 6 }, scene);
      lamp.parent = body;
      lamp.position.set(x, y, 0);
      lamp.material = this.lanternMat;
      lamp.isPickable = false;
    };

    const make = (body: Mesh) => {
      body.material = bodyMat;
      body.isVisible = false; // templates only; clones are what's drawn
      body.setEnabled(false); // …and their lanterns with them
      body.isPickable = false;
      return body;
    };
    this.templates = {
      sailboat: make(sailboatModel(scene)),
      motorboat: make(motorboatModel(scene)),
    };
    lantern(this.templates.sailboat, 0.17, 3.48);
    lantern(this.templates.motorboat, -0.1, 0.86);
  }

  /** Create/move/dispose boat meshes to match `traffic`. `time` in seconds. */
  sync(traffic: BoatTraffic, world: WorldSize, time: number): void {
    const alive = new Set<number>();
    for (const boat of traffic.boats) {
      alive.add(boat.id);
      let body = this.views.get(boat.id);
      if (!body) {
        body = this.createView(boat.kind, boat.id);
        this.views.set(boat.id, body);
      }

      const pose = boatPose(traffic.route, boat);
      const yaw = headingToRotationY(pose.heading);
      // Gentle bobbing, de-synced per boat. Sailboats also heel a little
      // away from the wind.
      const phase = boat.id * 1.7;
      const heel = boat.kind === "sailboat" ? 0.1 : 0;
      toScene(pose.pos, world, WATER_Y + 0.03 * Math.sin(time * 2.1 + phase), body.position);
      body.rotation.set(
        heel + 0.05 * Math.sin(time * 1.6 + phase),
        yaw,
        0.03 * Math.sin(time * 1.9 + phase),
      );
      body.visibility = pose.opacity;
      // A child's visibility doesn't follow its parent: fade the lantern
      // (and so its halo, see glow.ts) with the boat.
      for (const child of body.getChildMeshes()) child.visibility = pose.opacity;
    }

    for (const [id, body] of this.views) {
      if (alive.has(id)) continue;
      this.disposeView(body);
      this.views.delete(id);
    }
  }

  /** 0 day … 1 night: lanterns fade in. */
  setNight(n: number): void {
    setNightLevel(this.lanternMat, n);
  }

  /** Remove every boat (e.g. before the river is rebuilt). */
  clear(): void {
    for (const body of this.views.values()) this.disposeView(body);
    this.views.clear();
  }

  private createView(kind: BoatKind, id: number): Mesh {
    const body = this.templates[kind].clone(`${kind}-${id}`);
    body.isVisible = true;
    body.setEnabled(true);
    // The lantern: halo at night, and lit at once if launched after dark.
    for (const child of body.getChildMeshes()) {
      child.isVisible = this.lanternMat.alpha > 0;
      SceneGlow.for(body.getScene()).add(child as Mesh, true);
    }
    body.scaling.setAll(BOAT_SCALE);
    this.shadows.addShadowCaster(body);
    return body;
  }

  private disposeView(body: Mesh): void {
    this.shadows.removeShadowCaster(body);
    body.dispose();
  }
}
