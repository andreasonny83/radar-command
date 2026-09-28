/**
 * Airfield meshes: taxiways, aprons, ground markings and hangars.
 *
 * Built from the layout in core/airfield.ts, one `AirfieldView` per runway:
 *
 *   - pavement: the turnoff and parallel taxiway as a strip following the
 *     exact curve planes drive (core/route.ts `filletPath`), plus the apron;
 *   - paint:    yellow taxi centrelines and stand lead-in lines (the lines
 *     planes follow), hold-short bars, and a stop bar in the runway colour
 *     at each stand;
 *   - lights:   small blue taxiway edge lights (glowing after dark), and
 *               warm floodlight pools on the stands at night;
 *   - hangars:  arched-roof hangars with a roof stripe in the runway colour
 *     and an open doorway: planes roll straight in.
 *
 * Everything draws in the default rendering group (not `OVERLAY_GROUP`), so
 * hangars hide the planes that roll into them. Planes switch to this group
 * on touchdown (see sceneSync.ts).
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { Scene } from "@babylonjs/core/scene";
import { STAND_TURN_RADIUS, TAXI_TURN_RADIUS, TAXIWAY_OFFSET, TAXIWAY_WIDTH } from "../config";
import { headingVector, lerp } from "../core/math";
import { filletPath } from "../core/route";
import type { OrientedRect, Runway, RunwayColor, Stand, Vec2, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { SceneGlow } from "./glow";
import { createPoolMesh, litNow, poolMaterial, setNightLevel } from "./nightLights";

// Layer heights (scene y). Pavement sits over the grass (0) and stream
// (≤ 0.05) but under the runway shoulder (0.06) and asphalt (0.08), so
// where the turnoff meets the runway the runway draws on top.
const PAVE_Y = 0.055;
const APRON_Y = 0.05;
const PAINT_Y = 0.068;
const LIGHT_Y = 0.12;

/** Floodlight pools on the stands at night: height (above the paint) and radius. */
const FLOOD_Y = PAINT_Y + 0.01;
const FLOOD_RADIUS = 2.4;
/** How bright a floodlight pool gets at full night (its material alpha). */
const FLOOD_STRENGTH = 0.65;

/** Taxi line width (world units). */
const LINE_WIDTH = 0.16;
/** Spacing of the blue taxiway edge lights. */
const EDGE_LIGHT_SPACING = 3;

// Hangar shape.
const WALL_H = 2.6;
const WALL_T = 0.25;
/** Height of the arched roof above the walls. */
const ROOF_RISE = 1.4;
/** Roof overhang past the walls, front and back. */
const ROOF_OVERHANG = 0.25;
/** Height of the coloured trim across the top of the doorway. */
const LINTEL_H = 0.45;
const ROOF_SEGMENTS = 14;
/** Half-angle of the coloured stripe along the roof's crown (radians). */
const ROOF_STRIPE_HALF_ANGLE = 0.18;

/** Sim point + heading, as produced by `filletPath`. */
interface Sample {
  p: Vec2;
  heading: number;
}

/** Everything built for one runway's airfield (static: nothing animates). */
export class AirfieldView {
  constructor(private readonly meshes: TransformNode[]) {}

  /**
   * Fade a newly opened runway's taxiways and hangars in, 0 (invisible) to
   * 1 (solid). Only while revealing: below 1 the meshes are alpha-blended.
   */
  reveal(k: number): void {
    const visibility = Math.max(0, Math.min(1, k));
    for (const node of this.meshes) {
      if (node instanceof AbstractMesh) node.visibility = visibility;
      for (const mesh of node.getChildMeshes()) mesh.visibility = visibility;
    }
  }

  dispose(): void {
    for (const node of this.meshes) node.dispose();
  }
}

export class AirfieldFactory {
  private readonly pavement: StandardMaterial;
  private readonly apron: StandardMaterial;
  private readonly taxiPaint: StandardMaterial;
  private readonly edgeLight: StandardMaterial;
  private readonly wall: StandardMaterial;
  private readonly roof: StandardMaterial;
  private readonly floor: StandardMaterial;
  /** Warm apron floodlight pools (render/nightLights.ts), lit at night. */
  private readonly flood: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    /** Shared runway/plane colour material. */
    private readonly colorMaterial: (color: RunwayColor) => StandardMaterial,
    private readonly shadows: ShadowGenerator | null = null,
  ) {
    this.pavement = matte("twyPavement", "#3a3f46", scene);
    this.apron = matte("twyApron", "#565c63", scene);
    this.taxiPaint = matte("twyPaint", "#f5c518", scene);
    this.taxiPaint.emissiveColor = new Color3(0.3, 0.24, 0.02); // readable in shade
    this.edgeLight = new StandardMaterial("twyEdgeLight", scene);
    this.edgeLight.disableLighting = true;
    this.edgeLight.emissiveColor = Color3.FromHexString("#4f8cff");
    this.wall = matte("hangarWall", "#d9dee4", scene);
    this.roof = matte("hangarRoof", "#9ea8b3", scene);
    this.roof.specularColor = new Color3(0.25, 0.25, 0.25); // a bit of metal sheen
    this.floor = matte("hangarFloor", "#23272d", scene);
    this.flood = poolMaterial("standFlood", "#ffe2a8", scene);
    // Ribbons and flat strips are built without caring about winding.
    for (const mat of [this.pavement, this.apron, this.taxiPaint, this.roof, this.wall]) {
      mat.backFaceCulling = false;
    }
  }

  /** 0 day … 1 night: the stand floodlights fade in. */
  setNight(n: number): void {
    setNightLevel(this.flood, n * FLOOD_STRENGTH);
  }

  create(runway: Runway, world: WorldSize): AirfieldView {
    const { airfield } = runway;
    const nodes: TransformNode[] = [];

    // The taxi route every plane drives: from a little way back along the
    // runway centreline, round the turnoff, to the end of the taxiway. The
    // same corners and radii as core/ground.ts, so the paint is the path.
    const along = headingVector(runway.heading);
    const runwayLead = {
      x: airfield.exit.x - along.x * 4,
      y: airfield.exit.y - along.y * 4,
    };
    const taxiLine = filletPath(
      [runwayLead, airfield.exit, airfield.turnoff, airfield.taxiwayEnd],
      TAXI_TURN_RADIUS,
    );
    // Departures' connector (core/departures.ts): a U from the taxiway onto
    // the far end of the runway, rounded like the departure route itself.
    const { departureEntry: entry, departureJoin: join } = airfield;
    const connectorLine = filletPath(
      [
        { x: entry.x - along.x * 4, y: entry.y - along.y * 4 },
        entry,
        join,
        { x: join.x - along.x * 4, y: join.y - along.y * 4 },
      ],
      TAXI_TURN_RADIUS,
    );
    const standLines = airfield.stands.map((stand) => {
      const before = {
        x: stand.leadIn.x - along.x * STAND_TURN_RADIUS * 1.5,
        y: stand.leadIn.y - along.y * STAND_TURN_RADIUS * 1.5,
      };
      return filletPath([before, stand.leadIn, stand.pos], STAND_TURN_RADIUS);
    });

    // Pavement: taxiway strip + apron slab.
    const strip = this.ribbon("taxiway", taxiLine, TAXIWAY_WIDTH, PAVE_Y, world);
    strip.material = this.pavement;
    const connector = this.ribbon("connector", connectorLine, TAXIWAY_WIDTH, PAVE_Y, world);
    connector.material = this.pavement;
    const apron = this.rect("apron", airfield.apron, APRON_Y, world);
    apron.material = this.apron;
    nodes.push(strip, connector, apron);

    // Paint: centrelines, lead-in lines, hold-short bars (yellow), and a
    // stop bar per stand in the runway's colour.
    const paintParts = [
      this.ribbon("taxiLine", taxiLine, LINE_WIDTH, PAINT_Y, world),
      this.ribbon("connectorLine", connectorLine, LINE_WIDTH, PAINT_Y, world),
      ...standLines.map((line) => this.ribbon("leadIn", line, LINE_WIDTH, PAINT_Y, world)),
      ...this.holdShortBars(runway, connectorLine, world),
    ];
    const paint = Mesh.MergeMeshes(paintParts, true);
    if (paint) {
      paint.name = "taxiPaint";
      paint.material = this.taxiPaint;
      nodes.push(paint);
    }
    const stopBars = Mesh.MergeMeshes(
      airfield.stands.map((s) => this.stopBar(s, world)),
      true,
    );
    if (stopBars) {
      stopBars.name = "stopBars";
      stopBars.material = this.colorMaterial(runway.color);
      nodes.push(stopBars);
    }

    // Blue edge lights along both sides of the taxi route, off the runway.
    for (const line of [taxiLine, connectorLine]) {
      const lights = this.edgeLights(line, runway, world);
      if (lights) {
        SceneGlow.for(this.scene).add(lights, true);
        nodes.push(lights);
      }
    }

    for (const node of nodes) {
      if (node instanceof Mesh) {
        node.isPickable = false;
        node.receiveShadows = true;
      }
    }

    // Apron floodlights: a pool of light on each stand after dark.
    const pools = createPoolMesh("standFlood", this.scene);
    pools.material = this.flood;
    const m = new Matrix();
    const scale = new Vector3(FLOOD_RADIUS, 1, FLOOD_RADIUS);
    const at = new Vector3();
    const matrices = new Float32Array(airfield.stands.length * 16);
    airfield.stands.forEach((stand, i) => {
      toScene(stand.pos, world, FLOOD_Y, at);
      Matrix.ComposeToRef(scale, Quaternion.Identity(), at, m);
      m.copyToArray(matrices, i * 16);
    });
    pools.thinInstanceSetBuffer("matrix", matrices, 16, true);
    pools.thinInstanceRefreshBoundingInfo(false);
    // Built at night (a runway opening after dark): lit straight away.
    pools.isVisible = litNow(this.flood);
    nodes.push(pools);

    for (const stand of airfield.stands) nodes.push(this.hangar(stand, runway.color, world));
    return new AirfieldView(nodes);
  }

  // -------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------

  /** Flat strip of `width` centred on a sampled line, at height `y`. */
  private ribbon(
    name: string,
    line: readonly Sample[],
    width: number,
    y: number,
    world: WorldSize,
  ): Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const half = width / 2;
    line.forEach(({ p, heading }, i) => {
      // Sideways offset (sim coordinates), perpendicular to the heading.
      const nx = -Math.sin(heading) * half;
      const ny = Math.cos(heading) * half;
      for (const side of [1, -1]) {
        const v = toScene({ x: p.x + nx * side, y: p.y + ny * side }, world, y);
        positions.push(v.x, v.y, v.z);
        normals.push(0, 1, 0);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const mesh = new Mesh(name, this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    // Untextured, but UVs let it merge with box-built paint (bars).
    data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
    data.applyToMesh(mesh);
    return mesh;
  }

  /** Flat rectangle on the ground at height `y`. */
  private rect(name: string, r: OrientedRect, y: number, world: WorldSize): Mesh {
    const mesh = CreateGround(name, { width: r.length, height: r.width }, this.scene);
    toScene(r.center, world, y, mesh.position);
    mesh.rotation.y = headingToRotationY(r.heading);
    return mesh;
  }

  /**
   * Hold-short markings, just clear of the runway, across the turnoff (on
   * its straight 45° part) and across the departures' connector (on its
   * curve, square to it).
   */
  private holdShortBars(runway: Runway, connector: readonly Sample[], world: WorldSize): Mesh[] {
    const { exit, turnoff } = runway.airfield;
    const clear = runway.width / 2 + 1.6; // sideways from the centreline
    const heading = Math.atan2(turnoff.y - exit.y, turnoff.x - exit.x);
    const dir = headingVector(heading);
    // Distance along the turnoff where it's `v` sideways from the centreline.
    const alongFor = (v: number) =>
      (v / TAXIWAY_OFFSET) * Math.hypot(turnoff.x - exit.x, turnoff.y - exit.y);
    const base = alongFor(clear);
    const bars = this.holdBarSet(
      { x: exit.x + dir.x * base, y: exit.y + dir.y * base },
      heading,
      world,
    );

    // The connector runs from the taxiway to the runway: the first point on
    // it that close to the centreline, facing away from the runway.
    const rdir = headingVector(runway.heading);
    const lateral = (p: Vec2) =>
      Math.abs(-(p.x - runway.center.x) * rdir.y + (p.y - runway.center.y) * rdir.x);
    const hit = connector.find((s) => lateral(s.p) <= clear);
    if (hit) bars.push(...this.holdBarSet(hit.p, hit.heading + Math.PI, world));
    return bars;
  }

  /**
   * One hold-short marking centred on `c`: two solid bars on the taxiway
   * side, two dashed on the runway side, as on a real airfield. `heading`
   * points along the taxiway, away from the runway.
   */
  private holdBarSet(c0: Vec2, heading: number, world: WorldSize): Mesh[] {
    const dir = headingVector(heading);
    const bars: Mesh[] = [];
    const across = TAXIWAY_WIDTH - 0.4;
    // Offsets along the turnoff: solid bars further from the runway, dashed
    // ones nearer it.
    for (const [offset, dashed] of [
      [0.65, false],
      [0.35, false],
      [0.05, true],
      [-0.25, true],
    ] as const) {
      const c = { x: c0.x + dir.x * offset, y: c0.y + dir.y * offset };
      const pieces = dashed ? 4 : 1;
      const len = dashed ? across / (pieces * 2 - 1) : across;
      for (let i = 0; i < pieces; i++) {
        // Position across the line: dashes spread evenly, gaps between.
        const t = dashed ? -across / 2 + len / 2 + i * len * 2 : 0;
        const p = { x: c.x - dir.y * t, y: c.y + dir.x * t };
        const bar = CreateBox("holdBar", { width: 0.14, height: 0.02, depth: len }, this.scene);
        toScene(p, world, PAINT_Y, bar.position);
        bar.rotation.y = headingToRotationY(heading);
        bars.push(bar);
      }
    }
    return bars;
  }

  /** Stop bar across the stand, under the parked plane's nose wheel. */
  private stopBar(stand: Stand, world: WorldSize): Mesh {
    const bar = CreateBox("stopBar", { width: 0.3, height: 0.02, depth: 2.4 }, this.scene);
    const dir = headingVector(stand.heading);
    toScene(
      { x: stand.pos.x + dir.x * 1.6, y: stand.pos.y + dir.y * 1.6 },
      world,
      PAINT_Y,
      bar.position,
    );
    bar.rotation.y = headingToRotationY(stand.heading);
    return bar;
  }

  /**
   * Blue edge lights along both sides of the taxi route, every
   * `EDGE_LIGHT_SPACING` units, skipping the stretch on the runway itself.
   */
  private edgeLights(line: readonly Sample[], runway: Runway, world: WorldSize): Mesh | null {
    const dir = headingVector(runway.heading);
    const offRunway = (p: Vec2) =>
      Math.abs(-(p.x - runway.center.x) * dir.y + (p.y - runway.center.y) * dir.x) >
      runway.width / 2 + 1.2;
    const lights: Mesh[] = [];
    let since = EDGE_LIGHT_SPACING; // place one at the first eligible point
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      since += Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
      if (since < EDGE_LIGHT_SPACING) continue;
      since = 0;
      const nx = -Math.sin(b.heading) * (TAXIWAY_WIDTH / 2 + 0.25);
      const ny = Math.cos(b.heading) * (TAXIWAY_WIDTH / 2 + 0.25);
      for (const side of [1, -1]) {
        const p = { x: b.p.x + nx * side, y: b.p.y + ny * side };
        if (!offRunway(p)) continue;
        const light = CreateBox("twyLight", { size: 0.16 }, this.scene);
        toScene(p, world, LIGHT_Y, light.position);
        lights.push(light);
      }
    }
    if (lights.length === 0) return null;
    const merged = Mesh.MergeMeshes(lights, true);
    if (!merged) return null;
    merged.name = "twyEdgeLights";
    merged.material = this.edgeLight;
    return merged;
  }

  // -------------------------------------------------------------------------
  // Hangars
  // -------------------------------------------------------------------------

  /**
   * An arched-roof hangar behind `stand`. Local frame: +x points into the
   * hangar (the parked plane's heading), the open doorway is the -x face,
   * z runs across the width.
   */
  private hangar(stand: Stand, color: RunwayColor, world: WorldSize): TransformNode {
    const { hangar } = stand;
    const D = hangar.length;
    const W = hangar.width;
    const root = new TransformNode(`hangar-${stand.id}`, this.scene);
    toScene(hangar.center, world, 0, root.position);
    root.rotation.y = headingToRotationY(hangar.heading);

    const parts: Mesh[] = [];
    const add = (mesh: Mesh, mat: StandardMaterial, castsShadow = true) => {
      mesh.material = mat;
      mesh.parent = root;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      if (castsShadow) this.shadows?.addShadowCaster(mesh, false);
      parts.push(mesh);
      return mesh;
    };

    // Dark floor inside, so the open doorway reads as a deep interior.
    const floor = CreateGround("hangarFloor", { width: D, height: W }, this.scene);
    floor.position.y = 0.075;
    add(floor, this.floor, false);

    // Side and back walls.
    for (const side of [1, -1]) {
      const wall = CreateBox("hangarWall", { width: D, height: WALL_H, depth: WALL_T }, this.scene);
      wall.position.set(0, WALL_H / 2, side * (W / 2 - WALL_T / 2));
      add(wall, this.wall);
    }
    const backWall = CreateBox(
      "hangarBack",
      { width: WALL_T, height: WALL_H, depth: W },
      this.scene,
    );
    backWall.position.set(D / 2 - WALL_T / 2, WALL_H / 2, 0);
    add(backWall, this.wall);

    // Arched roof: a half-ellipse profile swept along the hangar's depth.
    const arc = (x: number, from = 0, to = Math.PI, lift = 0) => {
      const pts: Vector3[] = [];
      for (let i = 0; i <= ROOF_SEGMENTS; i++) {
        const a = lerp(from, to, i / ROOF_SEGMENTS);
        pts.push(
          new Vector3(
            x,
            WALL_H + Math.sin(a) * (ROOF_RISE + lift),
            Math.cos(a) * (W / 2 + 0.1 + lift),
          ),
        );
      }
      return pts;
    };
    const xFront = -D / 2 - ROOF_OVERHANG;
    const xBack = D / 2 + ROOF_OVERHANG;
    const roof = CreateRibbon(
      "hangarRoof",
      { pathArray: [arc(xFront), arc(xBack)], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    add(roof, this.roof);

    // Stripe along the crown in the runway colour: readable from above.
    const h = ROOF_STRIPE_HALF_ANGLE;
    const stripe = CreateRibbon(
      "hangarStripe",
      {
        pathArray: [
          arc(xFront, Math.PI / 2 - h, Math.PI / 2 + h, 0.03),
          arc(xBack, Math.PI / 2 - h, Math.PI / 2 + h, 0.03),
        ],
        sideOrientation: Mesh.DOUBLESIDE,
      },
      this.scene,
    );
    add(stripe, this.colorMaterial(color), false);

    // Gable ends: fill the arch above the walls, front (over the doorway) and back.
    for (const x of [-D / 2, D / 2]) add(this.gable(x, W), this.wall);

    // Trim over the doorway, in the runway colour.
    const lintel = CreateBox(
      "hangarLintel",
      { width: 0.2, height: LINTEL_H, depth: W },
      this.scene,
    );
    lintel.position.set(-D / 2 - 0.05, WALL_H - LINTEL_H / 2, 0);
    add(lintel, this.colorMaterial(color));
    return root;
  }

  /** Half-ellipse wall filling the roof arch at local `x`. */
  private gable(x: number, W: number): Mesh {
    const positions = [x, WALL_H, 0];
    const indices: number[] = [];
    for (let i = 0; i <= ROOF_SEGMENTS; i++) {
      const a = (i / ROOF_SEGMENTS) * Math.PI;
      positions.push(x, WALL_H + Math.sin(a) * ROOF_RISE, Math.cos(a) * (W / 2));
      if (i > 0) indices.push(0, i, i + 1);
    }
    const mesh = new Mesh("hangarGable", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;
    data.applyToMesh(mesh);
    return mesh;
  }
}

/** Lit material with no specular highlight. */
function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  return mat;
}
