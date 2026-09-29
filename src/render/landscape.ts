/**
 * Low-poly landscape (lit for the time of day by render/dayCycle.ts; night
 * lights via `setNight`): faceted grass, the airports' grounds (fences,
 * towers, terminals; see airportGrounds.ts), a stream with sandy banks and
 * the odd boat sailing along it, and thin-instanced trees.
 *
 * The layout comes from the pure `core/scenery.ts`; this file only turns it
 * into meshes. The ground stays perfectly flat at y = 0 — input intersects
 * an analytic plane (see input/pointer.ts), and runways/paths assume it.
 */
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { Scene } from "@babylonjs/core/scene";
import { SCENERY_SEED, STREAM_BANK_WIDTH } from "../config";
import { bridgeDemand, createBoatTraffic, stepBoats, type BoatTraffic } from "../core/boats";
import { createBridgeStates, openToBoats, stepBridges, type BridgeState } from "../core/bridges";
import { carsOnBridges, createCarTraffic, stepCars, type CarTraffic } from "../core/cars";
import type { Bridge } from "../core/countryside";
import { lerp, mulberry32 } from "../core/math";
import {
  buildScenery,
  horizonFade,
  valueNoise,
  type Bounds,
  type Scenery,
  type StreamPoint,
  type Tree,
  type TreeKind,
} from "../core/scenery";
import type { Runway, RunwayColor, Vec2, WorldSize } from "../core/types";
import { AirportGroundsFactory, type AirportView } from "./airportGrounds";
import { BoatFleet } from "./boats";
import { DrawbridgeFactory, type DrawbridgeView } from "./bridges";
import { CarFleet } from "./cars";
import { CountrysideFactory, type CountrysideView } from "./countryside";
import { fromScene, toScene } from "./coords";
import { CLEAR_COLOR } from "./scene";

/** Grid resolution of the grass mesh (per side). Each cell = 2 facets. */
const GRASS_SUBDIVISIONS = 40;

/** Grass palette, blended by low-frequency noise. */
const GRASS_LIGHT = Color3.FromHexString("#7cb84a");
const GRASS_MID = Color3.FromHexString("#64a23d");
const GRASS_DARK = Color3.FromHexString("#4e8a33");
/** Grass fades towards the clear colour near the map edge. */
const GRASS_EDGE = Color3.FromHexString(CLEAR_COLOR);

/** Canopy palettes (dark → light), picked per tree by `Tree.tint`. */
const CANOPY_PALETTES: Record<TreeKind, readonly [Color3, Color3]> = {
  // Firs: deep blue-greens, darker than the grass so they stand out.
  conifer: [Color3.FromHexString("#1b4428"), Color3.FromHexString("#2f6a3a")],
  // Broadleaf: warmer, from olive to a sunlit yellow-green.
  broadleaf: [Color3.FromHexString("#2c5f22"), Color3.FromHexString("#55892c")],
};

/** A species' two meshes: shared across all instances of that species. */
interface TreeModel {
  trunk: Mesh;
  canopy: Mesh;
}

/** Heights above the grass: bank under water, both under the runways (0.05+). */
const BANK_Y = 0.02;
const WATER_Y = 0.04;

/** Base water glow; `update` pulses it for a gentle shimmer. */
const WATER_EMISSIVE = new Color3(0.05, 0.14, 0.22);
/** Water glow at full night: darker, a moonlit blue. */
const WATER_NIGHT = new Color3(0.02, 0.05, 0.1);

export class Landscape {
  /** Everything built by `setWorld`, disposed on the next rebuild. */
  private meshes: Mesh[] = [];
  /** Airport grounds (fence, tower, terminal…), rebuilt with the rest. */
  private airports: AirportView[] = [];
  private readonly airportFactory: AirportGroundsFactory;
  /** Fields, roads, bridges and village, rebuilt with the rest. */
  private countryside: CountrysideView | null = null;
  private readonly countrysideFactory: CountrysideFactory;
  /** Cars on the roads (rebuilt with them) and their meshes. */
  private cars: CarTraffic | null = null;
  private bridges: readonly Bridge[] = [];
  /** Drawbridge state (lift, barriers) and meshes, one per bridge. */
  private bridgeStates: BridgeState[] = [];
  private bridgeViews: DrawbridgeView[] = [];
  private readonly bridgeFactory: DrawbridgeFactory;
  private bounds: Bounds | null = null;
  private readonly carFleet: CarFleet;

  /** Boats on the river (rebuilt with it) and their meshes. */
  private traffic: BoatTraffic | null = null;
  private world: WorldSize | null = null;
  private readonly fleet: BoatFleet;
  /** `time` of the previous `update`, to step the boats by the difference. */
  private lastTime: number | null = null;
  /** 0 day … 1 night (see `setNight`), and the water glow before its shimmer. */
  private night = 0;
  private readonly waterBase = new Color3();

  private readonly grassMat: StandardMaterial;
  private readonly bankMat: StandardMaterial;
  private readonly waterMat: StandardMaterial;
  private readonly trunkMat: StandardMaterial;
  private readonly foliageMat: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
  ) {
    // Grass colour lives in the vertex colours; white diffuse passes it through.
    this.grassMat = matte("grassMat", Color3.White(), scene);
    this.bankMat = matte("bankMat", Color3.FromHexString("#a8905c"), scene);
    this.trunkMat = matte("trunkMat", Color3.FromHexString("#6b4a2b"), scene);
    // Canopy colour comes from the per-instance "color" buffer.
    this.foliageMat = matte("foliageMat", Color3.White(), scene);

    this.waterMat = new StandardMaterial("waterMat", scene);
    this.waterMat.diffuseColor = Color3.FromHexString("#3aa0d0");
    this.waterMat.specularColor = new Color3(0.6, 0.7, 0.8);
    this.waterMat.specularPower = 48;
    this.waterMat.emissiveColor = WATER_EMISSIVE.clone();
    this.waterMat.alpha = 0.9;

    this.fleet = new BoatFleet(scene, shadows);
    this.airportFactory = new AirportGroundsFactory(scene, shadows);
    this.countrysideFactory = new CountrysideFactory(scene, shadows);
    this.carFleet = new CarFleet(scene, shadows);
    this.bridgeFactory = new DrawbridgeFactory(scene, shadows);
  }

  /** (Re)build all scenery for a world size and runway layout. */
  setWorld(world: WorldSize, runways: readonly Runway[]): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.meshes = [];

    const scenery = buildScenery(world, runways);
    this.meshes.push(
      this.buildGrass(scenery, world),
      ...this.buildStream(scenery.stream, world),
      ...this.buildTrees(scenery.trees, world),
    );
    for (const mesh of this.meshes) mesh.isPickable = false;

    this.countryside?.dispose();
    this.countryside = this.countrysideFactory.create(scenery.countryside, world, scenery.bounds);
    const land = scenery.countryside;
    this.bridges = land.bridges;
    this.bridgeStates = createBridgeStates(land.bridges);
    for (const view of this.bridgeViews) view.dispose();
    this.bridgeViews = land.bridges.map((b) => this.bridgeFactory.create(b, world));
    this.cars = createCarTraffic(land.network, scenery.airports, this.bridgeStates, scenery.bounds);
    this.bounds = scenery.bounds;
    for (const view of this.airports) view.dispose();
    this.airports = scenery.airports.map((a, i) => this.airportFactory.create(a, world, i));

    // New river, new traffic. Boats need to know where the drawbridges are.
    this.fleet.clear();
    const gates = land.bridges.map((b) => b.points[Math.floor(b.points.length / 2)]!);
    this.traffic = createBoatTraffic(scenery.stream, world, gates);
    this.world = world;
  }

  /**
   * Colours of the runways at `color`'s airport, itself included (blue and
   * yellow share one): just `[color]` for a runway with no airport.
   */
  airportColors(color: RunwayColor): readonly RunwayColor[] {
    return this.airports.find((a) => a.colors.includes(color))?.colors ?? [color];
  }

  /**
   * Build each airport (grounds, fence, control tower, windsock) as far as
   * its most built runway (see `AirportView.reveal`): `built(color)` is 0
   * for a closed colour, 1 for an open one, in between while it's being laid.
   */
  revealAirports(built: (color: RunwayColor) => number): void {
    for (const airport of this.airports) airport.reveal(Math.max(0, ...airport.colors.map(built)));
  }

  /** 0 day … 1 night (SceneSync.setNight): passed on to the scenery. */
  setNight(n: number): void {
    this.night = n;
    this.airportFactory.setNight(n);
    this.countrysideFactory.setNight(n);
    this.countryside?.setNight(n);
    this.carFleet.setNight(n);
    this.fleet.setNight(n);
  }

  /**
   * Per-frame animation (water shimmer, boats, cars, drawbridges, windsocks). `time` is
   * in seconds and stands still while the game is paused, so everything
   * stops too.
   */
  update(time: number): void {
    for (const airport of this.airports) airport.update(time);
    const pulse = 1 + 0.35 * Math.sin(time * 1.3) * Math.sin(time * 0.7 + 1);
    Color3.LerpToRef(WATER_EMISSIVE, WATER_NIGHT, this.night, this.waterBase);
    this.waterBase.scaleToRef(pulse, this.waterMat.emissiveColor);

    // Clamped like the sim's dt, so a long frame can't teleport a boat.
    const dt = this.lastTime === null ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (!this.traffic || !this.cars || !this.world || !this.bounds) return;
    // Drawbridges open for sailboats once no car is on them; boats and cars
    // then wait for them (see core/bridges.ts).
    stepBridges(this.bridgeStates, dt, bridgeDemand(this.traffic), carsOnBridges(this.cars));
    stepBoats(this.traffic, dt, this.bridgeStates.map(openToBoats));
    stepCars(this.cars, dt);
    this.fleet.sync(this.traffic, this.world, time);
    this.carFleet.sync(this.cars, this.bridges, this.world, this.bounds);
    this.bridgeStates.forEach((state, i) => this.bridgeViews[i]?.update(state, time));
  }

  // -------------------------------------------------------------------------
  // Grass
  // -------------------------------------------------------------------------

  /**
   * A flat grid, un-indexed so every triangle owns its three vertices, then
   * coloured per triangle. Flat colour per facet is what gives the low-poly
   * look — the geometry itself is dead flat.
   */
  private buildGrass(scenery: Scenery, world: WorldSize): Mesh {
    const { bounds } = scenery;
    const size = bounds.maxX - bounds.minX;
    const center = toScene(
      { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
      world,
    );

    const grass = CreateGround(
      "grass",
      { width: size, height: size, subdivisions: GRASS_SUBDIVISIONS },
      this.scene,
    );
    grass.position.copyFrom(center);
    // Split shared vertices so each triangle can have its own colour.
    grass.convertToFlatShadedMesh();

    const positions = grass.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) throw new Error("Grass mesh has no positions");
    const colors = new Float32Array((positions.length / 3) * 4);
    const tmp = new Color3();
    const scenePoint = new Vector3();

    for (let v = 0; v < positions.length / 3; v += 3) {
      // Triangle centroid (local space), then into sim space for the noise.
      const lx = (positions[v * 3]! + positions[v * 3 + 3]! + positions[v * 3 + 6]!) / 3;
      const lz = (positions[v * 3 + 2]! + positions[v * 3 + 5]! + positions[v * 3 + 8]!) / 3;
      scenePoint.set(lx + center.x, 0, lz + center.z);
      const p = fromScene(scenePoint, world);
      grassColor(p, horizonFade(p, bounds), tmp);

      for (let k = 0; k < 3; k++) {
        const o = (v + k) * 4;
        colors[o] = tmp.r;
        colors[o + 1] = tmp.g;
        colors[o + 2] = tmp.b;
        colors[o + 3] = 1;
      }
    }
    grass.setVerticesData(VertexBuffer.ColorKind, colors);
    grass.material = this.grassMat;
    grass.receiveShadows = true;
    return grass;
  }

  // -------------------------------------------------------------------------
  // Stream
  // -------------------------------------------------------------------------

  /** Water ribbon over a wider bank ribbon, both following the centreline. */
  private buildStream(line: readonly StreamPoint[], world: WorldSize): Mesh[] {
    const bank = this.ribbon("bank", line, world, (p) => p.width / 2 + STREAM_BANK_WIDTH, BANK_Y);
    bank.material = this.bankMat;
    bank.receiveShadows = true;

    const water = this.ribbon("water", line, world, (p) => p.width / 2, WATER_Y);
    water.material = this.waterMat;
    water.receiveShadows = true;
    return [bank, water];
  }

  /**
   * A flat strip `halfWidth(p)` either side of `line` (the river's width
   * varies along it), offset along each point's normal. The tangent at a point uses its neighbours (central
   * difference) so the strip bends smoothly.
   */
  private ribbon(
    name: string,
    line: readonly StreamPoint[],
    world: WorldSize,
    halfWidth: (p: StreamPoint) => number,
    y: number,
  ): Mesh {
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    for (let i = 0; i < line.length; i++) {
      const prev = line[Math.max(0, i - 1)]!;
      const next = line[Math.min(line.length - 1, i + 1)]!;
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len;
      const ny = tx / len;
      const p = line[i]!;
      const hw = halfWidth(p);
      left.push(toScene({ x: p.x + nx * hw, y: p.y + ny * hw }, world, y));
      right.push(toScene({ x: p.x - nx * hw, y: p.y - ny * hw }, world, y));
    }
    // DOUBLESIDE so we don't have to care which way the ribbon winds.
    return CreateRibbon(
      name,
      { pathArray: [left, right], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
  }

  // -------------------------------------------------------------------------
  // Trees
  // -------------------------------------------------------------------------

  /**
   * Two species (conifer, broadleaf), each a trunk mesh plus a canopy mesh
   * drawn with thin instances: one draw call per mesh however many trees,
   * and only a matrix (plus a colour for the canopy) per tree.
   */
  private buildTrees(trees: readonly Tree[], world: WorldSize): Mesh[] {
    const meshes: Mesh[] = [];
    for (const kind of ["conifer", "broadleaf"] as const) {
      const group = trees.filter((t) => t.kind === kind);
      if (group.length === 0) continue;
      const model = kind === "conifer" ? this.coniferModel() : this.broadleafModel();
      this.instanceTrees(model, group, world, CANOPY_PALETTES[kind]);
      meshes.push(model.trunk, model.canopy);
    }
    return meshes;
  }

  /** Tall narrow fir: short trunk under three stacked 7-sided cones (~3.6 tall). */
  private coniferModel(): TreeModel {
    const trunk = this.trunk(0.7, 0.25, 0.35);
    const tiers = [
      { base: 0.5, height: 1.6, diameter: 2.3 },
      { base: 1.4, height: 1.5, diameter: 1.8 },
      { base: 2.3, height: 1.3, diameter: 1.2 },
    ].map(({ base, height, diameter }) => {
      const cone = CreateCylinder(
        "firTier",
        { height, diameterTop: 0, diameterBottom: diameter, tessellation: 7 },
        this.scene,
      );
      cone.bakeTransformIntoVertices(Matrix.Translation(0, base + height / 2, 0));
      return cone;
    });
    return { trunk, canopy: this.finishCanopy("firCanopy", tiers, 0.08, 1) };
  }

  /** Round deciduous tree: taller trunk under a lumpy cluster of spheres (~3.4 tall). */
  private broadleafModel(): TreeModel {
    const trunk = this.trunk(1.5, 0.25, 0.4);
    const blobs = [
      { x: 0, y: 2.2, z: 0, r: 1.2 },
      { x: 0.7, y: 1.9, z: 0.2, r: 0.85 },
      { x: -0.55, y: 2.05, z: -0.45, r: 0.8 },
      { x: 0.1, y: 2.8, z: 0.1, r: 0.7 },
    ].map(({ x, y, z, r }) => {
      // Smooth (indexed) spheres so vertices are shared and the jitter in
      // `finishCanopy` dents the surface without tearing it apart.
      const blob = CreateIcoSphere(
        "leafBlob",
        { radius: r, subdivisions: 2, flat: false },
        this.scene,
      );
      blob.bakeTransformIntoVertices(
        Matrix.Scaling(1, 0.85, 1).multiply(Matrix.Translation(x, y, z)),
      );
      return blob;
    });
    return { trunk, canopy: this.finishCanopy("leafCanopy", blobs, 0.18, 2) };
  }

  /** Tapered 6-sided trunk with its base at y = 0. */
  private trunk(height: number, top: number, bottom: number): Mesh {
    const trunk = CreateCylinder(
      "trunk",
      { height, diameterTop: top, diameterBottom: bottom, tessellation: 6 },
      this.scene,
    );
    // Base at y = 0 so instance matrices only need ground positions.
    trunk.bakeTransformIntoVertices(Matrix.Translation(0, height / 2, 0));
    trunk.convertToFlatShadedMesh();
    trunk.material = this.trunkMat;
    return trunk;
  }

  /**
   * Merge canopy parts, nudge every vertex a little (seeded, so identical on
   * every rebuild) to break up the perfect geometric shapes, then flat-shade
   * so each facet catches the sun differently — the low-poly look.
   *
   * The nudge is keyed on vertex *position*, not index: builders duplicate
   * vertices along UV seams and cap edges, and moving those copies apart
   * would open cracks in the surface.
   */
  private finishCanopy(name: string, parts: Mesh[], jitter: number, seed: number): Mesh {
    const canopy = Mesh.MergeMeshes(parts, true);
    if (!canopy) throw new Error(`Failed to build ${name}`);
    canopy.name = name;

    const positions = canopy.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      const rng = mulberry32(SCENERY_SEED + seed);
      const offsets = new Map<string, [number, number, number]>();
      const nudge = () => (rng() - 0.5) * 2 * jitter;
      for (let i = 0; i < positions.length; i += 3) {
        const key = `${positions[i]!.toFixed(3)},${positions[i + 1]!.toFixed(3)},${positions[i + 2]!.toFixed(3)}`;
        let offset = offsets.get(key);
        if (!offset) {
          offset = [nudge(), nudge(), nudge()];
          offsets.set(key, offset);
        }
        positions[i] = positions[i]! + offset[0];
        positions[i + 1] = positions[i + 1]! + offset[1];
        positions[i + 2] = positions[i + 2]! + offset[2];
      }
      canopy.updateVerticesData(VertexBuffer.PositionKind, positions);
    }
    canopy.convertToFlatShadedMesh();
    canopy.material = this.foliageMat;
    return canopy;
  }

  /** Upload per-tree matrices (and canopy colours) as thin instances. */
  private instanceTrees(
    model: TreeModel,
    trees: readonly Tree[],
    world: WorldSize,
    palette: readonly [Color3, Color3],
  ): void {
    const matrices = new Float32Array(trees.length * 16);
    const colors = new Float32Array(trees.length * 4);
    const m = new Matrix();
    const scale = new Vector3();
    const rot = new Quaternion();
    const pos = new Vector3();
    const tint = new Color3();

    trees.forEach((tree, i) => {
      scale.setAll(tree.scale);
      Quaternion.RotationYawPitchRollToRef(tree.rotation, 0, 0, rot);
      toScene(tree.pos, world, 0, pos);
      Matrix.ComposeToRef(scale, rot, pos, m);
      m.copyToArray(matrices, i * 16);

      Color3.LerpToRef(palette[0], palette[1], tree.tint, tint);
      colors.set([tint.r, tint.g, tint.b, 1], i * 4);
    });

    for (const mesh of [model.trunk, model.canopy]) {
      // `true` = static buffer: uploaded once, never updated.
      mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
      // Without this the mesh is culled using the template's tiny bounds at
      // the origin, and every tree vanishes when the origin leaves the view.
      mesh.thinInstanceRefreshBoundingInfo(false);
      this.shadows.addShadowCaster(mesh);
    }
    model.canopy.thinInstanceSetBuffer("color", colors, 4, true);
  }
}

/** Matte material (no specular highlight) with the given diffuse colour. */
function matte(name: string, diffuse: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = diffuse;
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * Colour of the grass facet at sim point `p`.
 * @param fade how far it has faded into the horizon (see `horizonFade`).
 */
function grassColor(p: Vec2, fade: number, out: Color3): Color3 {
  // Big soft patches of light/dark grass, plus fine per-facet jitter so
  // neighbouring triangles differ slightly (the "low-poly" sparkle).
  const patch = valueNoise(p.x / 45, p.y / 45) * 0.7 + valueNoise(p.x / 12, p.y / 12) * 0.3;
  if (patch < 0.5) Color3.LerpToRef(GRASS_DARK, GRASS_MID, patch * 2, out);
  else Color3.LerpToRef(GRASS_MID, GRASS_LIGHT, (patch - 0.5) * 2, out);
  const jitter = lerp(0.94, 1.04, valueNoise(p.x * 3.7, p.y * 3.7, 7));
  out.scaleToRef(jitter, out);

  Color3.LerpToRef(out, GRASS_EDGE, fade, out);
  return out;
}
