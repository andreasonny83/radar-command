/**
 * Airport grounds meshes, built from the layout in core/airports.ts, one
 * `AirportView` per airport:
 *
 *   - airside: mown grass inside the fence, in alternating stripes along the
 *     main runway (the classic look of an airfield from the air), and a
 *     see-through chain-link fence on posts along the perimeter;
 *   - control tower: concrete shaft, glass cab, antenna with a blinking red
 *     obstruction light; the cab is lit from inside at night;
 *   - terminal: glass-fronted low building with a roof deck, and its car
 *     park with painted bays and parked cars; lit from inside at night;
 *   - windsock: striped sock on a pole, streaming downwind (towards the
 *     approach end: planes land into the wind) and swaying gently.
 *
 * Decoration only: nothing here is read by the simulation or input.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { Scene } from "@babylonjs/core/scene";
import { CAR_BAY_DEPTH, CAR_BAY_WIDTH } from "../config";
import type { Airport, Landside } from "../core/airports";
import { clipHalfPlane } from "../core/geometry";
import { headingVector } from "../core/math";
import type { OrientedRect, RunwayColor, Vec2, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { SceneGlow } from "./glow";

// Layer heights (scene y): mown grass just over the grass (0), under the
// stream bank (0.02) and all the paving (0.05+).
const MOWN_Y = 0.012;
/**
 * Each airport's mown grass sits this much higher than the previous one's:
 * side by side (the portrait layout), the two can overlap, and stripes at
 * the same height would flicker.
 */
const MOWN_Y_STEP = 0.0015;
const CAR_PARK_Y = 0.05;
const BAY_PAINT_Y = 0.065;

/** Width of each mowing stripe (world units). */
const MOW_STRIPE = 4;
const MOWN_LIGHT = Color3.FromHexString("#8cc55a");
const MOWN_DARK = Color3.FromHexString("#7eb94d");

/** Fence: post spacing and height. */
const FENCE_POST_SPACING = 2.4;
const FENCE_HEIGHT = 0.7;

// Control tower.
const TOWER_SHAFT_H = 6.5;
const TOWER_CAB_H = 1.25;

/** Seconds per blink of the tower's red obstruction light. */
const BEACON_PERIOD = 1.6;

/** Tower cab and terminal glass: cool by day, warm lit interiors at night. */
const GLASS_DAY = new Color3(0.04, 0.1, 0.16);
const GLASS_NIGHT = new Color3(0.62, 0.46, 0.22);

/** Everything built for one airport; `update` animates the windsock and beacon. */
export class AirportView {
  /** Last `reveal` value, so repeated calls with the same one cost nothing. */
  private revealed = 1;

  constructor(
    private readonly nodes: TransformNode[],
    private readonly sock: TransformNode,
    private readonly beacon: Mesh,
    /** Downwind heading the sock streams towards (scene rotation). */
    private readonly downwind: number,
    private readonly phase: number,
    /** Colours of this airport's runways (see `reveal`). */
    readonly colors: readonly RunwayColor[],
    /** Tower and windsock roots: the parts `reveal` raises. */
    private readonly staffed: readonly TransformNode[],
  ) {}

  /**
   * Raise the control tower and windsock as the airport's first runway is
   * built (see `SceneSync`'s runway progression): 0 = not there (disabled,
   * so no shadow either), 1 = standing. They grow up from the ground.
   */
  reveal(k: number): void {
    const v = Math.max(0, Math.min(1, k));
    if (v === this.revealed) return;
    this.revealed = v;
    for (const root of this.staffed) {
      root.setEnabled(v > 0);
      // A zero scale would make the world matrix singular.
      root.scaling.y = Math.max(0.001, v);
    }
  }

  /** `time` in seconds (stands still while paused). */
  update(time: number): void {
    const t = time + this.phase;
    // Gusty sway round the wind direction, and a little lift and droop.
    this.sock.rotation.y =
      this.downwind + 0.18 * Math.sin(t * 0.9) + 0.07 * Math.sin(t * 2.3 + 1.1);
    this.sock.rotation.z = -0.12 - 0.08 * Math.sin(t * 1.4);
    this.beacon.visibility = (t % BEACON_PERIOD) / BEACON_PERIOD < 0.45 ? 1 : 0.15;
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
  }
}

export class AirportGroundsFactory {
  private readonly mown: StandardMaterial;
  private readonly fence: StandardMaterial;
  private readonly post: StandardMaterial;
  private readonly concrete: StandardMaterial;
  private readonly glass: StandardMaterial;
  private readonly roofDeck: StandardMaterial;
  private readonly plant: StandardMaterial;
  private readonly asphalt: StandardMaterial;
  private readonly paint: StandardMaterial;
  private readonly sockOrange: StandardMaterial;
  private readonly sockWhite: StandardMaterial;
  private readonly beaconMat: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator | null = null,
  ) {
    // Stripe colours live in the vertex colours.
    this.mown = matte("mownGrass", "#ffffff", scene);
    // Fans are wound whichever way the polygon runs: draw both sides.
    this.mown.backFaceCulling = false;
    this.fence = matte("fenceMesh", "#d5dbe1", scene);
    this.fence.alpha = 0.35;
    this.fence.backFaceCulling = false;
    this.post = matte("fencePost", "#9aa3ad", scene);
    this.concrete = matte("towerConcrete", "#e2e5e9", scene);
    this.glass = new StandardMaterial("towerGlass", scene);
    this.glass.diffuseColor = Color3.FromHexString("#2d5575");
    this.glass.specularColor = new Color3(0.7, 0.8, 0.9);
    this.glass.specularPower = 64;
    this.glass.emissiveColor = GLASS_DAY.clone();
    this.roofDeck = matte("roofDeck", "#b4bcc5", scene);
    this.plant = matte("roofPlant", "#6b7480", scene);
    this.asphalt = matte("carParkAsphalt", "#4c5259", scene);
    this.paint = matte("bayPaint", "#eef2f6", scene);
    this.paint.emissiveColor = new Color3(0.3, 0.3, 0.3);
    this.sockOrange = matte("sockOrange", "#f97316", scene);
    this.sockOrange.emissiveColor = new Color3(0.25, 0.1, 0);
    this.sockWhite = matte("sockWhite", "#f8fafc", scene);
    this.beaconMat = new StandardMaterial("towerBeacon", scene);
    this.beaconMat.disableLighting = true;
    this.beaconMat.emissiveColor = Color3.FromHexString("#ff2a2a");
  }

  /** 0 day … 1 night: the tower cab and terminal light up from inside. */
  setNight(n: number): void {
    Color3.LerpToRef(GLASS_DAY, GLASS_NIGHT, n, this.glass.emissiveColor);
  }

  create(airport: Airport, world: WorldSize, index: number): AirportView {
    const nodes: TransformNode[] = [];
    const mainHeading = airport.runways[0]!.heading;

    nodes.push(this.mownGrass(airport.perimeter, mainHeading, MOWN_Y + index * MOWN_Y_STEP, world));
    nodes.push(...this.fenceLine(airport.perimeter, world));

    const { root: towerRoot, beacon } = this.tower(airport.tower, world);
    nodes.push(towerRoot);

    if (airport.landside) {
      nodes.push(this.terminal(airport.landside.terminal, world));
      nodes.push(this.carPark(airport.landside, world));
    }

    // Planes land into the wind, so it blows from ahead of them and the sock
    // streams back towards the approach end.
    let wx = 0;
    let wy = 0;
    for (const r of airport.runways) {
      const d = headingVector(r.heading);
      wx -= d.x;
      wy -= d.y;
    }
    const { root: sockRoot, sock } = this.windsock(airport.windsock, world);
    nodes.push(sockRoot);

    for (const node of nodes) {
      if (node instanceof Mesh) node.isPickable = false;
      for (const child of node.getChildMeshes()) child.isPickable = false;
    }
    return new AirportView(
      nodes,
      sock,
      beacon,
      headingToRotationY(Math.atan2(wy, wx)),
      index * 1.7,
      airport.runways.map((r) => r.color),
      [towerRoot, sockRoot],
    );
  }

  // -------------------------------------------------------------------------
  // Airside
  // -------------------------------------------------------------------------

  /**
   * The perimeter polygon filled in mowing stripes running along `heading`:
   * the polygon is cut into bands (half-plane clipping), each band a flat
   * fan in one of two greens.
   */
  private mownGrass(poly: readonly Vec2[], heading: number, y: number, world: WorldSize): Mesh {
    const d = headingVector(heading);
    // Bands are measured across the heading.
    const n = { x: -d.y, y: d.x };
    let min = Infinity;
    let max = -Infinity;
    for (const p of poly) {
      const t = p.x * n.x + p.y * n.y;
      min = Math.min(min, t);
      max = Math.max(max, t);
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const v = new Vector3();
    const first = Math.floor(min / MOW_STRIPE);
    for (let k = first; k * MOW_STRIPE < max; k++) {
      let band = clipHalfPlane(poly, n, k * MOW_STRIPE);
      band = clipHalfPlane(band, { x: -n.x, y: -n.y }, -(k + 1) * MOW_STRIPE);
      if (band.length < 3) continue;
      const c = k % 2 === 0 ? MOWN_LIGHT : MOWN_DARK;
      // Fan from the first vertex: fine, every band is convex.
      for (let i = 1; i < band.length - 1; i++) {
        for (const p of [band[0]!, band[i]!, band[i + 1]!]) {
          toScene(p, world, y, v);
          positions.push(v.x, v.y, v.z);
          colors.push(c.r, c.g, c.b, 1);
        }
      }
    }

    const indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
    const normals = new Array<number>(positions.length).fill(0);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const mesh = new Mesh("mownGrass", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.colors = colors;
    data.applyToMesh(mesh);
    mesh.material = this.mown;
    mesh.receiveShadows = true;
    return mesh;
  }

  /** See-through chain-link panel along the perimeter, plus thin-instanced posts. */
  private fenceLine(poly: readonly Vec2[], world: WorldSize): Mesh[] {
    const loop = [...poly, poly[0]!];
    const bottom = loop.map((p) => toScene(p, world, 0.05));
    const top = loop.map((p) => toScene(p, world, FENCE_HEIGHT));
    const panel = CreateRibbon(
      "fence",
      { pathArray: [bottom, top], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    panel.material = this.fence;

    // Posts at a steady spacing all the way round.
    const spots: Vec2[] = [];
    let since = FENCE_POST_SPACING;
    for (let i = 1; i < loop.length; i++) {
      const a = loop[i - 1]!;
      const b = loop[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      let t = FENCE_POST_SPACING - since;
      while (t <= len) {
        spots.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
        t += FENCE_POST_SPACING;
      }
      since = len - (t - FENCE_POST_SPACING);
    }
    const post = CreateBox(
      "fencePost",
      { width: 0.1, height: FENCE_HEIGHT + 0.08, depth: 0.1 },
      this.scene,
    );
    post.bakeTransformIntoVertices(Matrix.Translation(0, (FENCE_HEIGHT + 0.08) / 2, 0));
    post.material = this.post;
    const matrices = new Float32Array(spots.length * 16);
    const pos = new Vector3();
    spots.forEach((p, i) => {
      toScene(p, world, 0, pos);
      Matrix.Translation(pos.x, pos.y, pos.z).copyToArray(matrices, i * 16);
    });
    post.thinInstanceSetBuffer("matrix", matrices, 16, true);
    post.thinInstanceRefreshBoundingInfo(false);
    return [panel, post];
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------

  /** Concrete shaft, balcony, glass cab, roof, antenna and a red beacon. */
  private tower(at: Vec2, world: WorldSize): { root: TransformNode; beacon: Mesh } {
    const root = new TransformNode("tower", this.scene);
    toScene(at, world, 0, root.position);
    const add = (mesh: Mesh, mat: StandardMaterial, y: number, shadow = true) => {
      mesh.material = mat;
      mesh.parent = root;
      mesh.position.y = y;
      mesh.receiveShadows = true;
      if (shadow) this.shadows?.addShadowCaster(mesh, false);
      return mesh;
    };
    const cyl = (name: string, h: number, top: number, bottom = top, tess = 8) =>
      CreateCylinder(
        name,
        { height: h, diameterTop: top, diameterBottom: bottom, tessellation: tess },
        this.scene,
      );

    // Footing, then a shaft that tapers slightly.
    add(cyl("towerBase", 0.6, 2.2, 2.4), this.concrete, 0.3);
    add(cyl("towerShaft", TOWER_SHAFT_H, 1.1, 1.4), this.concrete, TOWER_SHAFT_H / 2);
    const cabBase = TOWER_SHAFT_H;
    add(cyl("towerBalcony", 0.3, 3, 2.4), this.concrete, cabBase + 0.15);
    // The cab flares out towards the top, like a real tower's slanted glass.
    add(cyl("towerCab", TOWER_CAB_H, 2.9, 2.5), this.glass, cabBase + 0.3 + TOWER_CAB_H / 2);
    const roofY = cabBase + 0.3 + TOWER_CAB_H;
    add(cyl("towerRoof", 0.3, 2.7, 3.2), this.roofDeck, roofY + 0.15);
    add(cyl("towerAntenna", 1.5, 0.07, 0.1, 5), this.plant, roofY + 0.3 + 0.75, false);
    const beacon = add(
      CreateSphere("towerBeacon", { diameter: 0.28, segments: 6 }, this.scene),
      this.beaconMat,
      roofY + 0.3 + 1.55,
      false,
    );
    // The obstruction light blooms after dark (render/glow.ts).
    SceneGlow.for(this.scene).add(beacon, true);
    return { root, beacon };
  }

  /**
   * Low terminal: concrete podium, a glass storey all round, roof deck with
   * plant boxes, and a canopy over the landside entrance.
   *
   * Local frame (from the rect): +x along the frontage, +z towards the
   * landside (the car park and road), -z towards the runways.
   */
  private terminal(rect: OrientedRect, world: WorldSize): TransformNode {
    const root = new TransformNode("terminal", this.scene);
    toScene(rect.center, world, 0, root.position);
    root.rotation.y = headingToRotationY(rect.heading);
    const L = rect.length;
    const D = rect.width;
    const add = (
      w: number,
      h: number,
      d: number,
      mat: StandardMaterial,
      x: number,
      y: number,
      z: number,
    ) => {
      const box = CreateBox("terminalPart", { width: w, height: h, depth: d }, this.scene);
      box.position.set(x, y + h / 2, z);
      box.material = mat;
      box.parent = root;
      box.receiveShadows = true;
      this.shadows?.addShadowCaster(box, false);
      return box;
    };
    add(L, 0.9, D, this.concrete, 0, 0, 0);
    add(L - 0.3, 1.5, D - 0.3, this.glass, 0, 0.9, 0);
    add(L + 0.6, 0.35, D + 0.6, this.roofDeck, 0, 2.4, 0);
    // Roof plant, off-centre so it doesn't look stamped.
    add(2.2, 0.55, 1.4, this.plant, -L * 0.25, 2.75, -0.4);
    add(1.2, 0.4, 1.2, this.plant, L * 0.3, 2.75, 0.6);
    // Entrance canopy on the landside.
    add(L * 0.35, 0.18, 1.4, this.roofDeck, 0, 1.7, D / 2 + 0.7);
    return root;
  }

  /**
   * Asphalt with the bays painted on (layout from core/airports.ts, so the
   * lines are exactly where the traffic parks). The cars themselves, parked
   * or coming and going, are drawn with the rest of the traffic
   * (render/cars.ts).
   */
  private carPark(landside: Landside, world: WorldSize): TransformNode {
    const rect = landside.carPark;
    const root = new TransformNode("carPark", this.scene);
    const slab = CreateGround(
      "carParkSlab",
      { width: rect.length, height: rect.width },
      this.scene,
    );
    toScene(rect.center, world, CAR_PARK_Y, slab.position);
    slab.rotation.y = headingToRotationY(rect.heading);
    slab.material = this.asphalt;
    slab.parent = root;
    slab.receiveShadows = true;

    // A line either side of every bay (shared lines drawn once).
    const lines: Mesh[] = [];
    const drawn = new Set<string>();
    for (const bay of landside.bays) {
      const d = headingVector(bay.heading);
      const side = { x: -d.y, y: d.x };
      for (const s of [1, -1]) {
        const p = {
          x: bay.pos.x + side.x * s * (CAR_BAY_WIDTH / 2),
          y: bay.pos.y + side.y * s * (CAR_BAY_WIDTH / 2),
        };
        const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const line = CreateBox(
          "bayLine",
          { width: CAR_BAY_DEPTH, height: 0.02, depth: 0.08 },
          this.scene,
        );
        toScene(p, world, BAY_PAINT_Y, line.position);
        line.rotation.y = headingToRotationY(bay.heading);
        lines.push(line);
      }
    }
    const paint = Mesh.MergeMeshes(lines, true);
    if (paint) {
      paint.name = "bayPaint";
      paint.material = this.paint;
      paint.parent = root;
    }
    return root;
  }

  /** Pole plus a sock of alternating orange/white bands, pivoting at the pole top. */
  private windsock(at: Vec2, world: WorldSize): { root: TransformNode; sock: TransformNode } {
    const root = new TransformNode("windsock", this.scene);
    toScene(at, world, 0, root.position);
    const pole = CreateCylinder(
      "sockPole",
      { height: 3, diameter: 0.1, tessellation: 5 },
      this.scene,
    );
    pole.position.y = 1.5;
    pole.material = this.post;
    pole.parent = root;
    this.shadows?.addShadowCaster(pole, false);

    // The sock streams along its local +x from the pivot.
    const sock = new TransformNode("sock", this.scene);
    sock.parent = root;
    sock.position.y = 2.9;
    const bands = 5;
    const bandLen = 0.42;
    for (let i = 0; i < bands; i++) {
      const d0 = 0.55 - (i / bands) * 0.3;
      const d1 = 0.55 - ((i + 1) / bands) * 0.3;
      const band = CreateCylinder(
        "sockBand",
        { height: bandLen, diameterTop: d1, diameterBottom: d0, tessellation: 8 },
        this.scene,
      );
      // Lay the cylinder's axis along +x, band i out from the pole.
      band.rotation.z = -Math.PI / 2;
      band.position.x = (i + 0.5) * bandLen;
      band.material = i % 2 === 0 ? this.sockOrange : this.sockWhite;
      band.parent = sock;
      this.shadows?.addShadowCaster(band, false);
    }
    return { root, sock };
  }
}

/** Matte material (no specular highlight). */
function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  return mat;
}
