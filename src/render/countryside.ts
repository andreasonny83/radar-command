/**
 * Countryside meshes, built from core/countryside.ts:
 *
 *   - fields:  flat patches in crop colours, with rows (alternating shades)
 *              along each field's long side; one merged mesh for them all;
 *   - hedges:  low dark-green hedgerows round the fields (thin instances);
 *   - roads:   grey strips with a dashed white centre line;
 *              (bridges over the river are drawbridges: render/bridges.ts);
 *   - village: houses, cottages and barns (thin-instanced walls and gabled
 *              roofs, coloured per house), and a church with a spire;
 *   - night:   lit windows (house by house from dusk), street lamps with
 *              pools of light along the village roads (see nightLights.ts).
 *
 * Everything is static and low-poly, and sits flat on the ground below the
 * airports' paving, so it never gets in the way of reading the board.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { Scene } from "@babylonjs/core/scene";
import { ROAD_WIDTH, VILLAGE_RADIUS } from "../config";
import type {
  Bridge,
  Countryside,
  CropKind,
  Field,
  House,
  HouseKind,
  Road,
} from "../core/countryside";
import { clipHalfPlane } from "../core/geometry";
import { horizonFade, type Bounds } from "../core/scenery";
import { headingVector, mulberry32 } from "../core/math";
import type { Vec2, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { SceneGlow } from "./glow";
import { createPoolMesh, lampMaterial, litNow, poolMaterial, setNightLevel } from "./nightLights";
import { CLEAR_COLOR } from "./scene";

// Layer heights (scene y): fields just over the grass (0), under the
// airports' mown grass (0.012) and the stream bank (0.02); roads over the
// bank but under the water (0.04), so a bridge deck always covers them.
const FIELD_Y = 0.006;
const ROAD_Y = 0.03;
const ROAD_PAINT_Y = 0.034;

/** Road asphalt; fades towards the horizon colour with the grass. */
const ROAD_COLOR = Color3.FromHexString("#5d636b");
const HORIZON = Color3.FromHexString(CLEAR_COLOR);
/** No centre-line dashes once a road has faded this far into the horizon. */
const DASH_FADE_LIMIT = 0.25;

/** Width of one crop row stripe. */
const ROW_WIDTH = 1.5;

/** Two shades per crop: rows alternate between them. Muted, so plane paths stay readable. */
const CROP_COLORS: Record<CropKind, readonly [string, string]> = {
  wheat: ["#cdb768", "#c3ac5d"],
  greenCrop: ["#90c057", "#86b64e"],
  soil: ["#8b6b49", "#7f6142"],
  hay: ["#b8c46c", "#aebb62"],
};

const HEDGE_COLORS = ["#3a6b31", "#427638", "#4b8040"];

/** Wall and roof palettes, picked per house by `House.tint`. */
const WALL_COLORS = ["#efe7d4", "#f5f4ef", "#e9dcb2", "#d8d4cb", "#c98f6c"];
const ROOF_COLORS = ["#b0553b", "#7b4b33", "#4d5563", "#8f3d30", "#a0674a"];
const BARN_WALLS = ["#8a3b2f", "#6e5641"];
const BARN_ROOF = "#4b5058";

/** House sizes: walls (length along the ridge, depth, height) and roof rise. */
const HOUSE_SIZES: Record<
  Exclude<HouseKind, "church">,
  { l: number; d: number; h: number; rise: number }
> = {
  house: { l: 2.5, d: 1.8, h: 1.3, rise: 0.9 },
  cottage: { l: 1.9, d: 1.5, h: 1.05, rise: 0.8 },
  barn: { l: 4.2, d: 2.8, h: 1.8, rise: 1.3 },
};

/** Window panes: dark glass when unlit, warm when someone's home. */
const WINDOW_DARK = Color3.FromHexString("#1a2230");
const WINDOW_LIT = Color3.FromHexString("#ffc86b");
/**
 * Each house switches its lights on at its own `night` level, from dusk
 * onwards; above 1 it stays dark all night (nobody home).
 */
const WINDOW_THRESHOLD_MIN = 0.08;
const WINDOW_THRESHOLD_RANGE = 1.05;

/** Street lamps along the village roads: spacing, bulb height, pool size. */
const LAMP_SPACING = 5;
const LAMP_HEIGHT = 1.25;
const LAMP_POOL_RADIUS = 1.6;
const LAMP_POOL_STRENGTH = 0.5;

/** Lit-window state for the village's thin-instanced panes. */
interface VillageWindows {
  mesh: Mesh;
  /** Per-instance "color" buffer (rgba), rewritten when lights change. */
  colors: Float32Array;
  /** Per-instance `night` level the pane lights up at. */
  thresholds: Float32Array;
}

/** Static countryside meshes, disposed together on a rebuild. */
export class CountrysideView {
  /** Last `night` step applied to the windows (-1 = none yet). */
  private windowStep = -1;

  constructor(
    private readonly meshes: Mesh[],
    private readonly windows: VillageWindows | null,
  ) {}

  /**
   * 0 day … 1 night: windows light up house by house. Recoloured only when
   * `n` moves a step (1/40), not every frame.
   */
  setNight(n: number): void {
    const w = this.windows;
    if (!w) return;
    w.mesh.isVisible = n > 0;
    const step = Math.round(n * 40);
    if (step === this.windowStep) return;
    this.windowStep = step;
    for (let i = 0; i < w.thresholds.length; i++) {
      const c = n > w.thresholds[i]! ? WINDOW_LIT : WINDOW_DARK;
      w.colors.set([c.r, c.g, c.b, 1], i * 4);
    }
    w.mesh.thinInstanceBufferUpdated("color");
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
  }
}

export class CountrysideFactory {
  private readonly vertexColored: StandardMaterial;
  private readonly fieldMat: StandardMaterial;
  private readonly road: StandardMaterial;
  private readonly roadPaint: StandardMaterial;
  private readonly stone: StandardMaterial;
  private readonly churchWall: StandardMaterial;
  private readonly churchRoof: StandardMaterial;
  /** Unlit panes (colour per instance), street-lamp bulbs and their pools. */
  private readonly windowMat: StandardMaterial;
  private readonly lampMat: StandardMaterial;
  private readonly lampPool: StandardMaterial;
  /** Current `night`, applied to views built later (see `create`). */
  private night = 0;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator | null = null,
  ) {
    // Colour from vertex / instance colours (white diffuse passes it through).
    this.vertexColored = matte("countryColored", "#ffffff", scene);
    // Roof slopes and gables are wound either way: light both sides alike.
    this.vertexColored.backFaceCulling = false;
    this.vertexColored.twoSidedLighting = true;
    // Fields are flat and face up: lit like the grass (two-sided lighting
    // would flip their normals when seen from "behind" the fan winding).
    this.fieldMat = matte("countryFields", "#ffffff", scene);
    this.fieldMat.backFaceCulling = false;
    // Colour comes from the vertex colours (see `fadeColors`).
    this.road = matte("countryRoad", "#ffffff", scene);
    this.road.backFaceCulling = false;
    this.roadPaint = matte("countryRoadPaint", "#f1f5f9", scene);
    this.roadPaint.emissiveColor = new Color3(0.3, 0.3, 0.3);
    this.stone = matte("bridgeStone", "#b9b2a4", scene);
    this.stone.backFaceCulling = false;
    this.churchWall = matte("churchWall", "#d9d2c2", scene);
    this.churchRoof = matte("churchRoof", "#4d5563", scene);
    this.churchRoof.backFaceCulling = false;
    this.churchRoof.twoSidedLighting = true;
    this.windowMat = new StandardMaterial("villageWindows", scene);
    this.windowMat.disableLighting = true;
    this.windowMat.emissiveColor = Color3.White(); // × the instance colour
    this.lampMat = lampMaterial("streetLamp", "#ffe0a0", scene);
    this.lampPool = poolMaterial("streetLampPool", "#ffd890", scene);
  }

  /** @param bounds  the scenery map, for fading roads into the horizon. */
  create(land: Countryside, world: WorldSize, bounds: Bounds): CountrysideView {
    const meshes: Mesh[] = [];
    const fields = this.fields(land.fields, world);
    if (fields) meshes.push(fields);
    const hedges = this.hedges(land, world);
    if (hedges) meshes.push(hedges);
    const junctions = land.network.nodes.filter((n) => n.kind === "junction").map((n) => n.pos);
    land.roads.forEach((road, i) => {
      const spans = land.bridges.filter((b) => b.road === i);
      meshes.push(...this.roadMeshes(road, spans, junctions, world, bounds));
    });
    const village = this.houses(land.houses, world);
    meshes.push(...village.meshes, ...this.streetLamps(land, world));
    for (const mesh of meshes) mesh.isPickable = false;
    const view = new CountrysideView(meshes, village.windows);
    // Built at night: windows lit straight away.
    view.setNight(this.night);
    return view;
  }

  // -------------------------------------------------------------------------
  // Fields & hedges
  // -------------------------------------------------------------------------

  /** Every field in one mesh: each cut into crop rows (convex clipping), flat colours. */
  private fields(fields: readonly Field[], world: WorldSize): Mesh | null {
    if (fields.length === 0) return null;
    const positions: number[] = [];
    const colors: number[] = [];
    const v = new Vector3();
    for (const field of fields) {
      const [a, b] = CROP_COLORS[field.crop].map((hex) => Color3.FromHexString(hex));
      const d = headingVector(field.rowHeading);
      const n = { x: -d.y, y: d.x };
      let min = Infinity;
      let max = -Infinity;
      for (const p of field.corners) {
        const t = p.x * n.x + p.y * n.y;
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
      for (let k = Math.floor(min / ROW_WIDTH); k * ROW_WIDTH < max; k++) {
        let row = clipHalfPlane(field.corners, n, k * ROW_WIDTH);
        row = clipHalfPlane(row, { x: -n.x, y: -n.y }, -(k + 1) * ROW_WIDTH);
        if (row.length < 3) continue;
        const c = k % 2 === 0 ? a! : b!;
        for (let i = 1; i < row.length - 1; i++) {
          for (const p of [row[0]!, row[i]!, row[i + 1]!]) {
            toScene(p, world, FIELD_Y, v);
            positions.push(v.x, v.y, v.z);
            colors.push(c.r, c.g, c.b, 1);
          }
        }
      }
    }
    const mesh = flatMesh("fields", positions, colors, this.scene);
    mesh.material = this.fieldMat;
    mesh.receiveShadows = true;
    return mesh;
  }

  /** Hedgerows: one box per field edge, thin-instanced and coloured per hedge. */
  private hedges(land: Countryside, world: WorldSize): Mesh | null {
    if (land.hedges.length === 0) return null;
    const box = CreateBox("hedge", { size: 1 }, this.scene);
    box.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    box.material = this.vertexColored;
    box.receiveShadows = true;
    const rng = mulberry32(0x4ed9e);
    const matrices = new Float32Array(land.hedges.length * 16);
    const colors = new Float32Array(land.hedges.length * 4);
    const m = new Matrix();
    const rot = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();
    land.hedges.forEach((h, i) => {
      const len = Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y);
      const mid = { x: (h.a.x + h.b.x) / 2, y: (h.a.y + h.b.y) / 2 };
      scale.set(len, 0.4 + rng() * 0.25, 0.65);
      Quaternion.RotationYawPitchRollToRef(
        headingToRotationY(Math.atan2(h.b.y - h.a.y, h.b.x - h.a.x)),
        0,
        0,
        rot,
      );
      toScene(mid, world, 0, pos);
      Matrix.ComposeToRef(scale, rot, pos, m);
      m.copyToArray(matrices, i * 16);
      const c = Color3.FromHexString(HEDGE_COLORS[Math.floor(rng() * HEDGE_COLORS.length)]!);
      colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    box.thinInstanceSetBuffer("matrix", matrices, 16, true);
    box.thinInstanceSetBuffer("color", colors, 4, true);
    box.thinInstanceRefreshBoundingInfo(false);
    this.shadows?.addShadowCaster(box, false);
    return box;
  }

  // -------------------------------------------------------------------------
  // Roads & bridges
  // -------------------------------------------------------------------------

  /**
   * Road strip plus dashed centre line. Roads run to the edge of the map, so
   * both fade into the horizon exactly like the grass beneath them.
   *
   * Where the road crosses the river the drawbridge (render/bridges.ts)
   * carries it, so the strip stops at each end of the bridge. No dashes
   * inside junctions (`junctions`), as on real roads.
   */
  private roadMeshes(
    road: Road,
    bridges: readonly Bridge[],
    junctions: readonly Vec2[],
    world: WorldSize,
    bounds: Bounds,
  ): Mesh[] {
    const pts = road.points;
    const onBridge = (i: number) => bridges.some((b) => i > b.from && i < b.to);
    const meshes: Mesh[] = [];
    // Strips between bridges: each includes the bridge's end point, where the ramp starts.
    let run: Vec2[] = [];
    pts.forEach((p, i) => {
      if (!onBridge(i)) run.push(p);
      if ((onBridge(i + 1) || i === pts.length - 1) && run.length >= 2) {
        const strip = this.ribbon("road", run, ROAD_WIDTH, () => ROAD_Y, world);
        fadeColors(strip, run, bounds);
        strip.material = this.road;
        strip.receiveShadows = true;
        meshes.push(strip);
      }
      if (onBridge(i + 1)) run = [];
    });

    // Dashes: ~1 unit long every 3 (the points are 1 apart).
    const dashes: Mesh[] = [];
    const inJunction = (p: Vec2) =>
      junctions.some((j) => Math.hypot(j.x - p.x, j.y - p.y) < ROAD_WIDTH + 0.8);
    for (let i = 2; i < pts.length - 2; i += 3) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (horizonFade(a, bounds) > DASH_FADE_LIMIT) continue;
      if (onBridge(i) || onBridge(i + 1) || inJunction(a) || inJunction(b)) continue;
      const dash = CreateBox("roadDash", { width: 1, height: 0.01, depth: 0.12 }, this.scene);
      toScene({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, world, ROAD_PAINT_Y, dash.position);
      dash.rotation.y = headingToRotationY(Math.atan2(b.y - a.y, b.x - a.x));
      dashes.push(dash);
    }
    const paint = dashes.length > 0 ? Mesh.MergeMeshes(dashes, true) : null;
    if (paint) {
      paint.name = "roadPaint";
      paint.material = this.roadPaint;
      meshes.push(paint);
    }
    return meshes;
  }

  /** Flat strip `width` wide along `line`, with a height per point. */
  private ribbon(
    name: string,
    line: readonly Vec2[],
    width: number,
    height: (i: number) => number,
    world: WorldSize,
  ): Mesh {
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    for (let i = 0; i < line.length; i++) {
      const prev = line[Math.max(0, i - 1)]!;
      const next = line[Math.min(line.length - 1, i + 1)]!;
      const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      const nx = (-(next.y - prev.y) / len) * (width / 2);
      const ny = ((next.x - prev.x) / len) * (width / 2);
      const p = line[i]!;
      left.push(toScene({ x: p.x + nx, y: p.y + ny }, world, height(i)));
      right.push(toScene({ x: p.x - nx, y: p.y - ny }, world, height(i)));
    }
    return CreateRibbon(
      name,
      { pathArray: [left, right], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
  }

  // -------------------------------------------------------------------------
  // Village
  // -------------------------------------------------------------------------

  /** Houses, cottages and barns as thin instances; the church built on its own. */
  private houses(
    houses: readonly House[],
    world: WorldSize,
  ): { meshes: Mesh[]; windows: VillageWindows | null } {
    const plain = houses.filter((h) => h.kind !== "church");
    const meshes: Mesh[] = [];
    let windows: VillageWindows | null = null;
    if (plain.length > 0) {
      const walls = CreateBox("houseWalls", { size: 1 }, this.scene);
      walls.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
      const roof = prismMesh("houseRoof", this.scene);
      const wallM = new Float32Array(plain.length * 16);
      const roofM = new Float32Array(plain.length * 16);
      const wallC = new Float32Array(plain.length * 4);
      const roofC = new Float32Array(plain.length * 4);
      const m = new Matrix();
      const rot = new Quaternion();
      const scale = new Vector3();
      const pos = new Vector3();
      plain.forEach((h, i) => {
        const size = HOUSE_SIZES[h.kind as Exclude<HouseKind, "church">];
        Quaternion.RotationYawPitchRollToRef(headingToRotationY(h.heading), 0, 0, rot);
        toScene(h.pos, world, 0, pos);
        scale.set(size.l, size.h, size.d);
        Matrix.ComposeToRef(scale, rot, pos, m);
        m.copyToArray(wallM, i * 16);
        // Roof overhangs the walls a little all round.
        pos.y = size.h;
        scale.set(size.l + 0.25, size.rise, size.d + 0.35);
        Matrix.ComposeToRef(scale, rot, pos, m);
        m.copyToArray(roofM, i * 16);
        const barn = h.kind === "barn";
        const pick = (list: readonly string[]) =>
          list[Math.floor(h.tint * list.length) % list.length]!;
        const wc = Color3.FromHexString(barn ? pick(BARN_WALLS) : pick(WALL_COLORS));
        // Roof colour from a different slice of the tint so it doesn't follow the walls.
        const rc = Color3.FromHexString(
          barn ? BARN_ROOF : ROOF_COLORS[Math.floor(h.tint * 37) % ROOF_COLORS.length]!,
        );
        wallC.set([wc.r, wc.g, wc.b, 1], i * 4);
        roofC.set([rc.r, rc.g, rc.b, 1], i * 4);
      });
      for (const [mesh, mats, cols] of [
        [walls, wallM, wallC],
        [roof, roofM, roofC],
      ] as const) {
        mesh.material = this.vertexColored;
        mesh.receiveShadows = true;
        mesh.thinInstanceSetBuffer("matrix", mats, 16, true);
        mesh.thinInstanceSetBuffer("color", cols, 4, true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        this.shadows?.addShadowCaster(mesh, false);
        meshes.push(mesh);
      }
      windows = this.windowPanes(plain, world);
      meshes.push(windows.mesh);
    }
    for (const church of houses.filter((h) => h.kind === "church")) {
      meshes.push(...this.church(church, world));
    }
    return { meshes, windows };
  }

  /**
   * Two panes per house (barns have none), each a thin box through the
   * house so it shows on both long walls: four windows. Hidden by day
   * (CountrysideView.setNight shows and colours them).
   */
  private windowPanes(houses: readonly House[], world: WorldSize): VillageWindows {
    const homes = houses.filter((h) => h.kind !== "barn");
    const mesh = CreateBox("villageWindows", { size: 1 }, this.scene);
    mesh.material = this.windowMat;
    mesh.isPickable = false;
    const matrices = new Float32Array(homes.length * 2 * 16);
    const colors = new Float32Array(homes.length * 2 * 4);
    const thresholds = new Float32Array(homes.length * 2);
    const rng = mulberry32(0x3d0ff);
    const m = new Matrix();
    const rot = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();
    homes.forEach((h, i) => {
      const size = HOUSE_SIZES[h.kind as Exclude<HouseKind, "church">];
      const d = headingVector(h.heading);
      Quaternion.RotationYawPitchRollToRef(headingToRotationY(h.heading), 0, 0, rot);
      scale.set(size.l * 0.18, size.h * 0.26, size.d + 0.04);
      const threshold = WINDOW_THRESHOLD_MIN + WINDOW_THRESHOLD_RANGE * rng();
      [-0.22, 0.22].forEach((along, k) => {
        const x = along * size.l;
        toScene({ x: h.pos.x + d.x * x, y: h.pos.y + d.y * x }, world, size.h * 0.55, pos);
        Matrix.ComposeToRef(scale, rot, pos, m);
        m.copyToArray(matrices, (i * 2 + k) * 16);
        thresholds[i * 2 + k] = threshold;
      });
    });
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.thinInstanceSetBuffer("color", colors, 4, false);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.isVisible = false;
    return { mesh, colors, thresholds };
  }

  /**
   * Street lamps every `LAMP_SPACING` along the roads within the village,
   * alternating sides: a bulb (glows at night) and a pool of light under
   * it. Both hidden by day.
   */
  private streetLamps(land: Countryside, world: WorldSize): Mesh[] {
    const village = land.village;
    if (!village) return [];
    const spots: Vec2[] = [];
    for (const road of land.roads) {
      let run = 0;
      let side = 1;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!;
        const b = road.points[i]!;
        run += Math.hypot(b.x - a.x, b.y - a.y);
        if (run < LAMP_SPACING) continue;
        run = 0;
        if (Math.hypot(b.x - village.x, b.y - village.y) > VILLAGE_RADIUS) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const off = (ROAD_WIDTH / 2 + 0.4) * side;
        spots.push({ x: b.x - ((b.y - a.y) / len) * off, y: b.y + ((b.x - a.x) / len) * off });
        side = -side;
      }
    }
    if (spots.length === 0) return [];
    const bulb = CreateBox("streetLampBulb", { size: 0.22 }, this.scene);
    bulb.material = this.lampMat;
    const pool = createPoolMesh("streetLampPool", this.scene);
    pool.material = this.lampPool;
    const bulbM = new Float32Array(spots.length * 16);
    const poolM = new Float32Array(spots.length * 16);
    const m = new Matrix();
    const pos = new Vector3();
    const one = Vector3.One();
    const poolScale = new Vector3(LAMP_POOL_RADIUS, 1, LAMP_POOL_RADIUS);
    spots.forEach((p, i) => {
      toScene(p, world, LAMP_HEIGHT, pos);
      Matrix.ComposeToRef(one, Quaternion.Identity(), pos, m);
      m.copyToArray(bulbM, i * 16);
      pos.y = ROAD_PAINT_Y + 0.006;
      Matrix.ComposeToRef(poolScale, Quaternion.Identity(), pos, m);
      m.copyToArray(poolM, i * 16);
    });
    for (const [mesh, mats, mat] of [
      [bulb, bulbM, this.lampMat],
      [pool, poolM, this.lampPool],
    ] as const) {
      mesh.thinInstanceSetBuffer("matrix", mats, 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.isPickable = false;
      mesh.isVisible = litNow(mat);
    }
    SceneGlow.for(this.scene).add(bulb, true);
    return [bulb, pool];
  }

  /** 0 day … 1 night: lamps fade in (windows are per view, see CountrysideView). */
  setNight(n: number): void {
    this.night = n;
    setNightLevel(this.lampMat, n);
    setNightLevel(this.lampPool, n * LAMP_POOL_STRENGTH);
  }

  /** Nave with a pitched roof, and a square tower with a spire at the west end. */
  private church(h: House, world: WorldSize): Mesh[] {
    const parts: Mesh[] = [];
    const place = (mesh: Mesh, mat: StandardMaterial, x: number, y: number) => {
      const d = headingVector(h.heading);
      toScene({ x: h.pos.x + d.x * x, y: h.pos.y + d.y * x }, world, y, mesh.position);
      mesh.rotation.y = headingToRotationY(h.heading);
      mesh.material = mat;
      mesh.receiveShadows = true;
      this.shadows?.addShadowCaster(mesh, false);
      parts.push(mesh);
    };
    const nave = CreateBox("churchNave", { width: 4.2, height: 2, depth: 2.2 }, this.scene);
    place(nave, this.churchWall, 0.4, 1);
    const roof = prismMesh("churchRoof", this.scene);
    roof.scaling.set(4.4, 1.2, 2.6);
    place(roof, this.churchRoof, 0.4, 2);
    const tower = CreateBox("churchTower", { width: 1.5, height: 3.8, depth: 1.5 }, this.scene);
    place(tower, this.churchWall, -2.3, 1.9);
    const spire = CreateCylinder(
      "churchSpire",
      { height: 2.2, diameterTop: 0, diameterBottom: 1.7, tessellation: 4 },
      this.scene,
    );
    place(spire, this.churchRoof, -2.3, 3.8 + 1.1);
    // `place` set rotation.y; add the 45° that squares the pyramid to the tower.
    spire.rotation.y += Math.PI / 4;
    return parts;
  }
}

/**
 * Give a strip built by `ribbon` vertex colours: road asphalt fading into
 * the horizon colour along `line` (see `horizonFade`). The ribbon's vertices
 * are both edges point by point (left edge, then right edge), and doubled
 * for the back side.
 */
function fadeColors(mesh: Mesh, line: readonly Vec2[], bounds: Bounds): void {
  const one = line.map((p) => {
    const c = Color3.Lerp(ROAD_COLOR, HORIZON, horizonFade(p, bounds));
    return [c.r, c.g, c.b, 1];
  });
  const edges = [...one, ...one].flat();
  const total = mesh.getTotalVertices();
  const colors: number[] = [];
  while (colors.length < total * 4) colors.push(...edges);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors.slice(0, total * 4));
}

/**
 * Unit gabled-roof prism: ridge along x (-0.5..0.5), eaves at z = ±0.5,
 * y from 0 (eaves) to 1 (ridge). Flat-shaded.
 */
function prismMesh(name: string, scene: Scene): Mesh {
  const L = 0.5;
  const W = 0.5;
  // prettier-ignore
  const corners = [
    [-L, 0, -W], [L, 0, -W], [L, 1, 0], [-L, 1, 0], // slope facing -z
    [-L, 0, W], [L, 0, W], [L, 1, 0], [-L, 1, 0],   // slope facing +z
  ];
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    for (const p of [a, b, c, a, c, d]) positions.push(p[0]!, p[1]!, p[2]!);
  };
  quad(corners[0]!, corners[3]!, corners[2]!, corners[1]!);
  quad(corners[4]!, corners[5]!, corners[6]!, corners[7]!);
  // Gable ends (triangles).
  for (const x of [-L, L]) positions.push(x, 0, -W, x, 1, 0, x, 0, W);
  const indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

/** Un-indexed triangle soup with upward normals and per-vertex colours. */
function flatMesh(name: string, positions: number[], colors: number[], scene: Scene): Mesh {
  const indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const normals = new Array<number>(positions.length).fill(0);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;
  data.applyToMesh(mesh);
  return mesh;
}

/** Matte material (no specular highlight). */
function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  return mat;
}
