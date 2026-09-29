/**
 * Drawbridge meshes, built from `Countryside.bridges` and animated from
 * core/bridges.ts:
 *
 *   - ramps: the road rising from each bank up to the deck, following the
 *     road's own curve, on a solid embankment with a low parapet;
 *   - abutments: stone blocks at the water's edge, where the leaves hinge;
 *   - leaves: the two halves of the deck over the water. Low enough for a
 *     motorboat to pass under; they swing up for sailboats;
 *   - barriers: a striped boom and a blinking red light at each end, down
 *     while the bridge is closed to cars.
 *
 * `roadSurfaceHeight` gives the deck height anywhere on a bridge, so cars
 * drive up the ramps and over the leaves.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Scene } from "@babylonjs/core/scene";
import { ROAD_WIDTH } from "../config";
import { closedToCars, type BridgeState } from "../core/bridges";
import type { Bridge } from "../core/countryside";
import { arcLengths, nearestOnPolyline } from "../core/geometry";
import type { Vec2, WorldSize } from "../core/types";
import { MOTORBOAT_HEIGHT } from "./boats";
import { headingToRotationY, toScene } from "./coords";
import { SceneGlow } from "./glow";

/** Road height off the bridge (matches countryside.ts). */
const ROAD_Y = 0.03;
/** Leaf thickness (hangs below the deck surface). */
const LEAF_T = 0.16;
/** Headroom between a motorboat's highest point and the leaves' underside. */
const DECK_CLEARANCE = 0.12;
/**
 * Deck height over the water, derived from the (scaled) motorboat so the two
 * can't drift apart: a motorboat, roof lantern included, passes under the
 * leaves; a sailboat's mast needs them up.
 */
export const DECK_Y = MOTORBOAT_HEIGHT + DECK_CLEARANCE + LEAF_T;
/** How far the leaves swing up when fully open (radians, ~75°). */
const LEAF_OPEN = 1.3;
/** Deck is this much wider than the road. */
const DECK_EXTRA = 0.6;
/** Barrier boom: raised angle and how fast it swings (1 / seconds). */
const BOOM_UP = 1.45;
const BOOM_RATE = 2.5;

/** Deck surface height `t` along a bridge (its points' arc length). */
export function deckHeight(bridge: Bridge, t: number): number {
  const total = arcLengths(bridge.points).at(-1)!;
  if (t >= bridge.wetFrom && t <= bridge.wetTo) return DECK_Y;
  // Ramps: smoothstep from the road up to the deck at the water's edge.
  const f =
    t < bridge.wetFrom ? t / (bridge.wetFrom || 1) : (total - t) / (total - bridge.wetTo || 1);
  const e = Math.min(1, Math.max(0, f));
  return ROAD_Y + (DECK_Y - ROAD_Y) * e * e * (3 - 2 * e);
}

/**
 * Height of the road surface at sim point `p`: the deck (ramps included)
 * on a bridge, otherwise the road itself. Cars drive at this height.
 */
export function roadSurfaceHeight(p: Vec2, bridges: readonly Bridge[]): number {
  for (const b of bridges) {
    const near = nearestOnPolyline(p, b.points);
    if (near.distance <= ROAD_WIDTH / 2 + 0.4) return deckHeight(b, near.along);
  }
  return ROAD_Y;
}

/** One drawbridge's moving parts; `update` follows its `BridgeState`. */
export class DrawbridgeView {
  private boomAngle = BOOM_UP;
  private lastTime: number | null = null;

  constructor(
    private readonly nodes: TransformNode[],
    private readonly hinges: TransformNode[],
    private readonly booms: TransformNode[],
    private readonly lights: Mesh[],
  ) {}

  update(state: BridgeState, time: number): void {
    const dt = this.lastTime === null ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    // Leaves: ease-in-out on the lift, like a real bascule's motor.
    const l = state.lift;
    const angle = LEAF_OPEN * l * l * (3 - 2 * l);
    for (const hinge of this.hinges) hinge.rotation.z = angle;
    // Booms swing down while closed to cars, back up when it reopens.
    const closed = closedToCars(state);
    const target = closed ? 0 : BOOM_UP;
    this.boomAngle += (target - this.boomAngle) * Math.min(1, BOOM_RATE * dt);
    for (const boom of this.booms) boom.rotation.z = this.boomAngle;
    const on = closed && time % 1 < 0.5;
    for (const light of this.lights) light.visibility = on ? 1 : 0.15;
  }

  dispose(): void {
    for (const node of this.nodes) node.dispose();
  }
}

export class DrawbridgeFactory {
  private readonly asphalt: StandardMaterial;
  private readonly stone: StandardMaterial;
  private readonly steel: StandardMaterial;
  private readonly white: StandardMaterial;
  private readonly red: StandardMaterial;
  private readonly lamp: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator | null = null,
  ) {
    this.asphalt = matte("bridgeAsphalt", "#5d636b", scene);
    this.asphalt.backFaceCulling = false;
    this.stone = matte("bridgeStone", "#b9b2a4", scene);
    this.stone.backFaceCulling = false;
    this.steel = matte("bridgeSteel", "#44505c", scene);
    this.white = matte("bridgeWhite", "#f1f5f9", scene);
    this.red = matte("bridgeRed", "#d62828", scene);
    this.lamp = new StandardMaterial("bridgeLamp", scene);
    this.lamp.disableLighting = true;
    this.lamp.emissiveColor = Color3.FromHexString("#ff2a2a");
  }

  create(bridge: Bridge, world: WorldSize): DrawbridgeView {
    const nodes: TransformNode[] = [];
    const add = (mesh: Mesh) => {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      this.shadows?.addShadowCaster(mesh, false);
      nodes.push(mesh);
      return mesh;
    };
    const pts = bridge.points;
    const along = arcLengths(pts);
    const total = along.at(-1)!;

    // Ramps up to each bank, following the road.
    const up = pts.filter((_, i) => along[i]! <= bridge.wetFrom + 1e-6);
    const down = pts.filter((_, i) => along[i]! >= bridge.wetTo - 1e-6);
    const upAlong = along.filter((a) => a <= bridge.wetFrom + 1e-6);
    const downAlong = along.filter((a) => a >= bridge.wetTo - 1e-6);
    const bankA = pointAt(pts, along, bridge.wetFrom);
    const bankB = pointAt(pts, along, bridge.wetTo);
    for (const [line, arcs] of [
      [
        [...up, bankA],
        [...upAlong, bridge.wetFrom],
      ],
      [
        [bankB, ...down],
        [bridge.wetTo, ...downAlong],
      ],
    ] as const) {
      if (line.length < 2) continue;
      const h = (i: number) => deckHeight(bridge, arcs[i]!);
      add(this.strip("bridgeRamp", line, ROAD_WIDTH + DECK_EXTRA, h, h, world, this.asphalt));
      // Embankment walls from the ground to a low parapet.
      for (const side of [1, -1]) {
        add(
          this.wall(
            "bridgeEmbankment",
            line,
            side,
            () => 0,
            (i) => h(i) + 0.3,
            world,
          ),
        );
      }
    }

    // Abutments where the leaves hinge, standing in the water's edge.
    const chord = { x: bankB.x - bankA.x, y: bankB.y - bankA.y };
    const span = Math.hypot(chord.x, chord.y) || 1;
    const heading = Math.atan2(chord.y, chord.x);
    for (const bank of [bankA, bankB]) {
      const block = CreateBox(
        "bridgeAbutment",
        { width: 0.9, height: DECK_Y + 0.05, depth: ROAD_WIDTH + DECK_EXTRA + 0.3 },
        this.scene,
      );
      toScene(bank, world, (DECK_Y + 0.05) / 2, block.position);
      block.rotation.y = headingToRotationY(heading);
      block.material = this.stone;
      add(block);
    }

    // Leaves: from each bank to the middle, hinged at the bank.
    const hinges: TransformNode[] = [];
    const mid = { x: (bankA.x + bankB.x) / 2, y: (bankA.y + bankB.y) / 2 };
    for (const [bank, towards] of [
      [bankA, mid],
      [bankB, mid],
    ] as const) {
      const root = new TransformNode("leafRoot", this.scene);
      toScene(bank, world, DECK_Y, root.position);
      root.rotation.y = headingToRotationY(Math.atan2(towards.y - bank.y, towards.x - bank.x));
      const hinge = new TransformNode("leafHinge", this.scene);
      hinge.parent = root;
      const len = span / 2 - 0.05;
      const w = ROAD_WIDTH + DECK_EXTRA;
      const leaf = CreateBox("leaf", { width: len, height: LEAF_T, depth: w }, this.scene);
      leaf.position.set(len / 2, -LEAF_T / 2, 0);
      leaf.material = this.steel;
      leaf.parent = hinge;
      // Asphalt on top, white railings along the edges.
      const top = CreateBox("leafTop", { width: len, height: 0.02, depth: w - 0.2 }, this.scene);
      top.position.set(len / 2, 0.005, 0);
      top.material = this.asphalt;
      top.parent = hinge;
      for (const side of [1, -1]) {
        const rail = CreateBox("leafRail", { width: len, height: 0.07, depth: 0.07 }, this.scene);
        rail.position.set(len / 2, 0.3, side * (w / 2 - 0.05));
        rail.material = this.white;
        rail.parent = hinge;
        for (let x = 0.15; x < len; x += 0.9) {
          const post = CreateBox("leafPost", { width: 0.06, height: 0.3, depth: 0.06 }, this.scene);
          post.position.set(x, 0.15, side * (w / 2 - 0.05));
          post.material = this.white;
          post.parent = hinge;
        }
      }
      for (const mesh of hinge.getChildMeshes()) add(mesh as Mesh);
      nodes.push(root);
      hinges.push(hinge);
    }

    // Barriers at both ends, on the right-hand side of the approaching lane.
    const booms: TransformNode[] = [];
    const lights: Mesh[] = [];
    for (const end of [0, total] as const) {
      const at = pointAt(pts, along, end === 0 ? 0.4 : total - 0.4);
      const next = pointAt(pts, along, end === 0 ? 1.4 : total - 1.4);
      // Direction of travel onto the bridge from this end.
      const dx = next.x - at.x;
      const dy = next.y - at.y;
      const dl = Math.hypot(dx, dy) || 1;
      const right = { x: -dy / dl, y: dx / dl };
      const postAt = {
        x: at.x + right.x * (ROAD_WIDTH / 2 + 0.35),
        y: at.y + right.y * (ROAD_WIDTH / 2 + 0.35),
      };
      const post = CreateBox("barrierPost", { width: 0.16, height: 0.9, depth: 0.16 }, this.scene);
      toScene(postAt, world, 0.45, post.position);
      post.material = this.white;
      add(post);
      const light = CreateSphere("barrierLight", { diameter: 0.2, segments: 6 }, this.scene);
      toScene(postAt, world, 0.98, light.position);
      light.material = this.lamp;
      light.isPickable = false;
      nodes.push(light);
      lights.push(light);
      // Flashing barrier lights bloom after dark (render/glow.ts).
      SceneGlow.for(this.scene).add(light, true);

      // The boom pivots on the post and reaches across the road (local +x).
      const pivot = new TransformNode("boomPivot", this.scene);
      toScene(postAt, world, 0.78, pivot.position);
      pivot.rotation.y = headingToRotationY(Math.atan2(-right.y, -right.x));
      const boom = new TransformNode("boom", this.scene);
      boom.parent = pivot;
      const length = ROAD_WIDTH + 0.3;
      const stripes = 6;
      for (let k = 0; k < stripes; k++) {
        const seg = CreateBox(
          "boomStripe",
          { width: length / stripes, height: 0.07, depth: 0.07 },
          this.scene,
        );
        seg.position.set((k + 0.5) * (length / stripes), 0, 0);
        seg.material = k % 2 === 0 ? this.red : this.white;
        seg.parent = boom;
        add(seg);
      }
      nodes.push(pivot);
      booms.push(boom);
    }
    return new DrawbridgeView(nodes, hinges, booms, lights);
  }

  /** Flat strip along `line`, heights per point for its two edges. */
  private strip(
    name: string,
    line: readonly Vec2[],
    width: number,
    hl: (i: number) => number,
    hr: (i: number) => number,
    world: WorldSize,
    mat: StandardMaterial,
  ): Mesh {
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    line.forEach((p, i) => {
      const n = normalAt(line, i, width / 2);
      left.push(toScene({ x: p.x + n.x, y: p.y + n.y }, world, hl(i)));
      right.push(toScene({ x: p.x - n.x, y: p.y - n.y }, world, hr(i)));
    });
    const mesh = CreateRibbon(
      name,
      { pathArray: [left, right], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    mesh.material = mat;
    return mesh;
  }

  /** Vertical wall along one edge (`side` ±1) of the deck, from `bottom` to `top`. */
  private wall(
    name: string,
    line: readonly Vec2[],
    side: number,
    bottom: (i: number) => number,
    top: (i: number) => number,
    world: WorldSize,
  ): Mesh {
    const w = (ROAD_WIDTH + DECK_EXTRA) / 2;
    const lower: Vector3[] = [];
    const upper: Vector3[] = [];
    line.forEach((p, i) => {
      const n = normalAt(line, i, w * side);
      lower.push(toScene({ x: p.x + n.x, y: p.y + n.y }, world, bottom(i)));
      upper.push(toScene({ x: p.x + n.x, y: p.y + n.y }, world, top(i)));
    });
    const mesh = CreateRibbon(
      name,
      { pathArray: [lower, upper], sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    mesh.material = this.stone;
    return mesh;
  }
}

/** Left-hand normal of `line` at point `i`, scaled to `len`. */
function normalAt(line: readonly Vec2[], i: number, len: number): Vec2 {
  const prev = line[Math.max(0, i - 1)]!;
  const next = line[Math.min(line.length - 1, i + 1)]!;
  const d = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
  return { x: (-(next.y - prev.y) / d) * len, y: ((next.x - prev.x) / d) * len };
}

/** Point at distance `s` along a polyline with arc lengths `along`. */
function pointAt(line: readonly Vec2[], along: readonly number[], s: number): Vec2 {
  for (let i = 1; i < line.length; i++) {
    if (along[i]! >= s) {
      const t = (s - along[i - 1]!) / (along[i]! - along[i - 1]! || 1);
      return {
        x: line[i - 1]!.x + (line[i]!.x - line[i - 1]!.x) * t,
        y: line[i - 1]!.y + (line[i]!.y - line[i - 1]!.y) * t,
      };
    }
  }
  return { ...line[line.length - 1]! };
}

/** Matte material (no specular highlight). */
function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  return mat;
}
