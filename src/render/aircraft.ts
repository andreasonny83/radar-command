/**
 * Aircraft models: three low-poly types with painted liveries and a few
 * moving parts.
 *
 * Purely visual — the sim treats every plane the same (one radius, one
 * speed). Each model is a root mesh (fuselage + tail, the part the sync layer
 * moves and rotates) with child meshes for anything animated:
 *
 *   - wings:  hinged at the fuselage, flex up under load and in turbulence;
 *   - props:  spin about the nose axis, with a faint blur disc behind them;
 *   - lights: steady red/green nav lights on the wingtips, white strobes and
 *             a red beacon that flash (these feed the glow layer);
 *   - headlights: white landing lights on the nose and wings, each plane
 *             throwing a cone of light ahead of it. Night only: their
 *             materials fade in with `night` (see meshes.ts `setNight`),
 *             and the sync layer switches them off in the hangar;
 *   - gear:   tricycle landing gear (a strut and a wheel per leg). The
 *             airliner's main legs fold inward and its nose leg forward; the
 *             turboprop's legs all fold forward; the light plane's gear is
 *             fixed. Driven by `AircraftMotion.gear` (see `animateAircraft`).
 *
 * Detail comes from per-vertex colours rather than bitmap textures: a plane
 * is ~40 px long at game zoom, where a painted cheatline, dark windscreen and
 * grey nacelles read clearly but a texture would blur into mush. It also lets
 * every part share one material.
 *
 * Models face +x (nose), +y is up and +z is the plane's LEFT (see coords.ts:
 * sim +y, the plane's right when heading along +x, maps to scene -z).
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import { PLANE_RADIUS } from "../config";
import type { AircraftKind } from "../core/fleet";
import { flightTuning, kindFlex, kindSpin } from "./flightTuning";

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

// The fleet (which type each plane is) lives in core, shared with the
// sound; re-exported here for the renderer.
export { aircraftKindFor, type AircraftKind } from "../core/fleet";

/**
 * Visual size of each model relative to `PLANE_RADIUS` (collision radius is
 * unchanged). Baked into the geometry, so it lives here rather than in the
 * live animation tuning (flightTuning.ts: wing flex, props, lights).
 */
const KIND_SIZE: Record<AircraftKind, number> = {
  airliner: 1.05,
  turboprop: 0.92,
  light: 0.75,
};

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const WHITE = Color3.FromHexString("#f1f5f9");
const LIGHT_GREY = Color3.FromHexString("#cbd5e1");
const GREY = Color3.FromHexString("#94a3b8");
const DARK = Color3.FromHexString("#1e293b");
/** Windscreen: near-black with a blue tint, so it reads as glass. */
const GLASS = Color3.FromHexString("#1d3557");

/** Roles of child meshes, stored in `metadata` (copied by reference on clone). */
type PartRole =
  "wing" | "prop" | "disc" | "nav" | "strobe" | "beacon" | "gear" | "headlight" | "headBeam";

/**
 * How a landing-gear leg retracts: swinging in towards the centreline
 * (about the fore-aft axis), forward (about the side-to-side axis), or not
 * at all.
 */
export type GearFold = "inward" | "forward" | "fixed";

interface PartMeta {
  role: PartRole;
  /** Wings and gear legs: +1 for the left side (+z), -1 for the right (0: centreline). */
  side?: 1 | -1;
  /** Gear legs: how the leg retracts. */
  fold?: GearFold;
}

/**
 * How far below the root (the fuselage axis) the wheels reach, as a share
 * of the model's size `r`. Every model sits on its wheels at this depth
 * (see `wheelDepth`).
 */
const GEAR_BOTTOM = 0.27;

/** Shared materials the builders assign to parts. */
export interface AircraftMaterials {
  /** Vertex-coloured, lit paint used by every solid part. */
  paint: Material;
  /** Faint translucent disc behind a spinning prop. */
  propDisc: Material;
  navRed: Material;
  navGreen: Material;
  strobe: Material;
  beacon: Material;
  /** Landing-light lamps: off (alpha 0) by day, see meshes.ts `setNight`. */
  headlight: Material;
  /** Additive cone of light ahead of the nose, faded like `headlight`. */
  headBeam: Material;
}

/** A live plane's meshes, sorted by what the animation does with them. */
export interface AircraftRig {
  kind: AircraftKind;
  /** Moved/rotated by the sync layer; everything else hangs off it. */
  root: Mesh;
  wings: { mesh: Mesh; side: 1 | -1 }[];
  props: Mesh[];
  strobes: Mesh[];
  beacons: Mesh[];
  /** Steady red/green wingtip lights. */
  navs: Mesh[];
  /** Landing-gear legs, each hinged where it meets the airframe. */
  gear: { mesh: Mesh; side: 1 | -1; fold: GearFold }[];
  /** Root + every child, for fading the whole plane out together. */
  all: Mesh[];
  /** Solid parts that should cast a shadow (no discs or lights). */
  shadowCasters: Mesh[];
  /** Emissive lights, to register with the glow layer. */
  lights: Mesh[];
  /** Landing-light lamps (night-only glow; not in `lights`). */
  headlights: Mesh[];
  /** The cone of light ahead of the nose (one per plane). */
  headBeams: Mesh[];
  /** Per-plane offset (seconds) so the fleet's strobes don't flash in sync. */
  phase: number;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Paint every vertex of `mesh` one colour. */
function paint(mesh: Mesh, color: Color3): Mesh {
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    colors.set([color.r, color.g, color.b, 1], i * 4);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/**
 * Flat slab from a convex 2D outline — wings, tailplanes and fins.
 *
 * `horizontal`: outline is (x, z), thickness along y (wings, tailplanes).
 * `vertical`:   outline is (x, y), thickness along z (fins, winglets).
 *
 * Each face gets its own vertices, so shading is flat and faceted like the
 * rest of the low-poly scene. The paint material is double-sided, so winding
 * doesn't matter; normals are computed to point outwards explicitly.
 */
function slab(
  scene: Scene,
  outline: ReadonlyArray<readonly [number, number]>,
  thickness: number,
  orientation: "horizontal" | "vertical",
  offset: number,
  color: Color3,
): Mesh {
  const half = thickness / 2;
  // (u, v, w) → scene (x, y, z); w is the thickness axis.
  const to3 = (u: number, v: number, w: number): [number, number, number] =>
    orientation === "horizontal" ? [u, offset + w, v] : [u, v, offset + w];
  const axis: [number, number, number] = orientation === "horizontal" ? [0, 1, 0] : [0, 0, 1];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const face = (verts: [number, number, number][], n: [number, number, number]) => {
    const base = positions.length / 3;
    for (const v of verts) {
      positions.push(...v);
      normals.push(...n);
    }
    // Fan triangulation: fine for the convex outlines used here.
    for (let i = 1; i < verts.length - 1; i++) indices.push(base, base + i, base + i + 1);
  };

  // Top and bottom caps.
  face(
    outline.map(([u, v]) => to3(u, v, half)),
    axis,
  );
  face(
    outline.map(([u, v]) => to3(u, v, -half)),
    [-axis[0], -axis[1], -axis[2]],
  );

  // Side walls, normals pointing away from the outline's centroid.
  const cu = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const cv = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  for (let i = 0; i < outline.length; i++) {
    const [u0, v0] = outline[i]!;
    const [u1, v1] = outline[(i + 1) % outline.length]!;
    let nu = v1 - v0;
    let nv = -(u1 - u0);
    if (nu * ((u0 + u1) / 2 - cu) + nv * ((v0 + v1) / 2 - cv) < 0) {
      nu = -nu;
      nv = -nv;
    }
    const len = Math.hypot(nu, nv) || 1;
    const n: [number, number, number] =
      orientation === "horizontal" ? [nu / len, 0, nv / len] : [nu / len, nv / len, 0];
    face([to3(u0, v0, -half), to3(u1, v1, -half), to3(u1, v1, half), to3(u0, v0, half)], n);
  }

  const mesh = new Mesh("slab", scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  // Unused, but MergeMeshes needs every part to carry the same attributes.
  data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
  data.applyToMesh(mesh);
  return paint(mesh, color);
}

/** Outline given in units of `r`, mapped through per-axis scale functions. */
function pts(
  su: (v: number) => number,
  sv: (v: number) => number,
  outline: ReadonlyArray<readonly [number, number]>,
): [number, number][] {
  return outline.map(([u, v]) => [su(u), sv(v)]);
}

/** Mirror a left-side (+z) outline to the right side. */
function mirrorZ(outline: ReadonlyArray<readonly [number, number]>): [number, number][] {
  return outline.map(([x, z]) => [x, -z]);
}

/**
 * Tube along x from `x0` (rear) to `x1` (front): fuselage sections,
 * nacelles, spinners. Diameters taper linearly from rear to front.
 */
function tube(
  scene: Scene,
  x0: number,
  x1: number,
  dRear: number,
  dFront: number,
  y: number,
  z: number,
  color: Color3,
  tessellation = 10,
): Mesh {
  const m = CreateCylinder(
    "tube",
    { height: x1 - x0, diameterTop: dFront, diameterBottom: dRear, tessellation },
    scene,
  );
  // Cylinders are built along +y; rotating -90° about z lays "top" along +x.
  m.rotation.z = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, z);
  return paint(m, color);
}

/**
 * Shear `mesh` so its centreline rises from y = 0 at `x1` (front) to `rise`
 * at `x0` (rear): y += rise · (x1 − x) / (x1 − x0). Used for upswept tail
 * cones and anything painted on them, so decals follow the cone's axis.
 */
function shearUp(mesh: Mesh, x0: number, x1: number, rise: number): Mesh {
  mesh.bakeCurrentTransformIntoVertices();
  const k = rise / (x1 - x0);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nrm) return mesh;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i + 1] = (pos[i + 1] ?? 0) + k * (x1 - (pos[i] ?? 0));
    // Normals follow the shear's inverse transpose: nx += k · ny, renormalised.
    const nx = (nrm[i] ?? 0) + k * (nrm[i + 1] ?? 0);
    const ny = nrm[i + 1] ?? 0;
    const nz = nrm[i + 2] ?? 0;
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm[i] = nx / len;
    nrm[i + 1] = ny / len;
    nrm[i + 2] = nz / len;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
  mesh.setVerticesData(VertexBuffer.NormalKind, nrm);
  return mesh;
}

/**
 * Upswept tail cone along x from `x0` (rear) to `x1` (front, joining the
 * fuselage). The front stays centred on the fuselage axis (y = 0), so the
 * joint is seamless; the centreline then rises to `rise` at the rear,
 * lifting the tail like a real airliner's.
 *
 * (Offsetting a whole tube by `rise` instead would leave a visible step at
 * the joint, since both ends of the tube would move up.)
 */
function tailCone(
  scene: Scene,
  x0: number,
  x1: number,
  dRear: number,
  dFront: number,
  rise: number,
  color: Color3,
  tessellation: number,
): Mesh {
  const m = tube(scene, x0, x1, dRear, dFront, 0, 0, color, tessellation);
  return shearUp(m, x0, x1, rise);
}

/**
 * Band hugging a nose cone that runs from `x0` (diameter `d0`) to `x1`
 * (diameter `d1`), covering `from`..`to`: a windscreen that follows the
 * nose's slope instead of sticking out of it.
 */
function noseBand(
  scene: Scene,
  x0: number,
  x1: number,
  d0: number,
  d1: number,
  from: number,
  to: number,
  color: Color3,
): Mesh {
  // Slightly proud of the skin, so it doesn't z-fight with the cone.
  const d = (x: number) => (d0 + ((d1 - d0) * (x - x0)) / (x1 - x0)) * 1.04;
  return tube(scene, from, to, d(from), d(to), 0, 0, color, 12);
}

/** Axis-aligned box centred at (x, y, z): sizes along x, y, z. */
function block(
  scene: Scene,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  color: Color3,
): Mesh {
  const m = CreateBox("block", { width: sx, height: sy, depth: sz }, scene);
  m.position.set(x, y, z);
  return paint(m, color);
}

/**
 * Merge `parts` into one child mesh of `parent`, hinged at `pivot`
 * (given in model space, like the parts).
 *
 * The pivot is baked into the vertices (geometry re-centred on it, position
 * set to it) rather than using `setPivotPoint`, because clones reliably copy
 * a mesh's position but not its pivot matrix.
 */
function attach(
  parts: Mesh[],
  parent: Mesh,
  parentPivot: Vector3,
  pivot: Vector3,
  meta: PartMeta,
  material: Material,
): Mesh {
  const mesh = parts.length === 1 ? parts[0]! : Mesh.MergeMeshes(parts, true);
  if (!mesh) throw new Error("Failed to build aircraft part");
  if (parts.length === 1) mesh.bakeCurrentTransformIntoVertices();
  mesh.name = meta.role;
  mesh.bakeTransformIntoVertices(Matrix.Translation(-pivot.x, -pivot.y, -pivot.z));
  mesh.parent = parent;
  mesh.position.copyFrom(pivot.subtract(parentPivot));
  mesh.metadata = meta;
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

/** Small emissive light at a model-space point. */
function light(
  scene: Scene,
  parent: Mesh,
  parentPivot: Vector3,
  at: Vector3,
  size: number,
  role: "nav" | "strobe" | "beacon",
  material: Material,
): Mesh {
  const box = CreateBox(role, { size }, scene);
  // Place the box at its model-space spot first: `attach` bakes this into the
  // vertices and then re-centres them on `at`. Left at the origin, every lamp
  // would collapse onto its parent's pivot (fuselage centre / wing root).
  box.position.copyFrom(at);
  return attach([box], parent, parentPivot, at, { role }, material);
}

/** Landing-light lamp at a model-space point (a `light`, night only). */
function headlight(
  scene: Scene,
  parent: Mesh,
  parentPivot: Vector3,
  at: Vector3,
  size: number,
  mats: AircraftMaterials,
): Mesh {
  const box = CreateBox("headlight", { size }, scene);
  box.position.copyFrom(at);
  return attach([box], parent, parentPivot, at, { role: "headlight" }, mats.headlight);
}

/** Segments round the rim of a headlight cone. */
const BEAM_SEGMENTS = 14;
/**
 * Headlight cone, in units of the model size `r`: how far ahead of the
 * lamp it reaches, its radius at the far end, and how far it's aimed
 * below the nose (radians; landing lights point a little down).
 */
const BEAM_REACH = 2.6;
const BEAM_SPREAD = 0.55;
const BEAM_TILT = 0.14;

/**
 * Cone of light from the lamp at `at` (model space, on the root), along
 * the nose and tilted down. Bright at the lamp and fading to nothing at
 * the far rim (vertex alpha), drawn additively: seen from above it reads
 * as a soft wedge of light ahead of the plane.
 */
function headBeam(scene: Scene, root: Mesh, at: Vector3, r: number, mats: AircraftMaterials): Mesh {
  const reach = BEAM_REACH * r;
  const spread = BEAM_SPREAD * r;
  // Apex at the origin, rim `reach` ahead along +x: one fan of triangles.
  const positions = [0, 0, 0];
  const colors = [1, 1, 1, 1];
  const indices: number[] = [];
  for (let i = 0; i < BEAM_SEGMENTS; i++) {
    const a = (i / BEAM_SEGMENTS) * Math.PI * 2;
    positions.push(reach, Math.sin(a) * spread * 0.6, Math.cos(a) * spread);
    colors.push(1, 1, 1, 0);
  }
  for (let i = 0; i < BEAM_SEGMENTS; i++) indices.push(0, 1 + i, 1 + ((i + 1) % BEAM_SEGMENTS));
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const cone = new Mesh("headBeam", scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.normals = normals;
  data.indices = indices;
  data.applyToMesh(cone);
  // Aim it: tilt the nose axis down, then move the apex onto the lamp.
  // `attach` bakes this transform into the vertices.
  cone.rotation.z = -BEAM_TILT;
  cone.position.copyFrom(at);
  const mesh = attach([cone], root, Vector3.Zero(), at, { role: "headBeam" }, mats.headBeam);
  mesh.hasVertexAlpha = true;
  return mesh;
}

/**
 * Propeller at `hub` (model space): `blades` flat blades plus a spinner cone
 * and a translucent blur disc. Returns the spinning mesh.
 */
function propeller(
  scene: Scene,
  mats: AircraftMaterials,
  parent: Mesh,
  parentPivot: Vector3,
  hub: Vector3,
  radius: number,
  blades: number,
): Mesh {
  const parts: Mesh[] = [];
  for (let i = 0; i < blades; i++) {
    // Each blade: a thin paddle from the hub outwards, rotated about x.
    const blade = block(scene, radius * 0.06, radius, radius * 0.16, 0, radius / 2, 0, DARK);
    blade.bakeCurrentTransformIntoVertices();
    blade.rotation.x = (i / blades) * Math.PI * 2;
    blade.position.copyFrom(hub);
    parts.push(blade);
  }
  parts.push(
    tube(
      scene,
      hub.x - radius * 0.1,
      hub.x + radius * 0.35,
      radius * 0.4,
      0.02,
      hub.y,
      hub.z,
      LIGHT_GREY,
      8,
    ),
  );
  const prop = attach(parts, parent, parentPivot, hub, { role: "prop" }, mats.paint);

  // Blur disc: built in the xy plane facing z; turn it to face along x.
  const disc = CreateDisc("disc", { radius, tessellation: 24 }, scene);
  disc.rotation.y = Math.PI / 2;
  disc.position.copyFrom(hub);
  attach([disc], prop, hub, hub, { role: "disc" }, mats.propDisc);
  return prop;
}

/**
 * One landing-gear leg hinged at `pivot` (model space): a grey strut down
 * to a dark wheel whose bottom sits `GEAR_BOTTOM` below the fuselage axis.
 * `side` is +1 / -1 for a left / right main leg, and ignored (0) for a
 * leg on the centreline.
 */
function gearLeg(
  scene: Scene,
  mats: AircraftMaterials,
  root: Mesh,
  r: number,
  pivot: Vector3,
  wheel: number,
  side: 1 | -1,
  fold: GearFold,
): Mesh {
  const bottom = -GEAR_BOTTOM * r;
  const axle = bottom + wheel / 2;
  const len = pivot.y - axle;
  const strut = block(
    scene,
    wheel * 0.3,
    len,
    wheel * 0.3,
    pivot.x,
    pivot.y - len / 2,
    pivot.z,
    GREY,
  );
  const tyre = CreateCylinder(
    "wheel",
    { diameter: wheel, height: wheel * 0.55, tessellation: 10 },
    scene,
  );
  tyre.rotation.x = Math.PI / 2; // axle across the plane (z)
  tyre.position.set(pivot.x, axle, pivot.z);
  paint(tyre, DARK);
  return attach(
    [strut, tyre],
    root,
    Vector3.Zero(),
    pivot,
    { role: "gear", side, fold },
    mats.paint,
  );
}

/**
 * How far below its root a model's wheels reach (world units, before the
 * sync layer's altitude scaling): the height to sit it at on the ground.
 */
export function wheelDepth(kind: AircraftKind): number {
  return GEAR_BOTTOM * PLANE_RADIUS * KIND_SIZE[kind];
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * Build the hidden template for one kind + team colour. Clones share its
 * geometry; call `rigFromClone` on each clone to find the animated parts.
 */
export function buildAircraftTemplate(
  scene: Scene,
  kind: AircraftKind,
  team: Color3,
  mats: AircraftMaterials,
  name: string,
): Mesh {
  const r = PLANE_RADIUS * KIND_SIZE[kind];
  // A slightly darker team shade for wings/tail, so surfaces separate.
  const teamDark = team.scale(0.82);
  const build = { airliner: buildAirliner, turboprop: buildTurboprop, light: buildLight }[kind];

  const root = new Mesh(name, scene);
  root.isPickable = false;
  build(scene, root, r, team, teamDark, mats);
  root.setEnabled(false);
  return root;
}

type Builder = (
  scene: Scene,
  root: Mesh,
  r: number,
  team: Color3,
  teamDark: Color3,
  mats: AircraftMaterials,
) => void;

/**
 * Give `root` the merged body geometry. The root starts as an empty mesh;
 * merging into a temporary and copying its vertex data keeps the root's
 * identity (name, children) intact.
 */
function setBody(root: Mesh, parts: Mesh[], mats: AircraftMaterials): void {
  const body = Mesh.MergeMeshes(parts, true);
  if (!body) throw new Error("Failed to build aircraft body");
  VertexData.ExtractFromMesh(body).applyToMesh(root);
  body.dispose();
  root.material = mats.paint;
}

/** Twin-jet airliner: team-coloured fuselage, white cheatline, swept wings. */
const buildAirliner: Builder = (scene, root, r, team, teamDark, mats) => {
  const s = (v: number) => v * r;
  const O = Vector3.Zero();
  const f = s(0.3); // fuselage diameter

  const body = [
    tube(scene, s(-0.7), s(0.8), f, f, 0, 0, team, 12),
    tube(scene, s(0.8), s(1.02), f, s(0.07), 0, 0, team, 12), // nose
    tailCone(scene, s(-1.08), s(-0.7), s(0.08), f, s(0.04), team, 12),
    // White cheatline down each side, just proud of the skin. It spans the
    // straight fuselage only: a box would poke out of the tapering cones.
    block(scene, s(1.5), s(0.05), f * 1.03, s(0.05), s(0.01), 0, WHITE),
    // Windscreen: a dark band wrapped round the nose cone.
    noseBand(scene, s(0.8), s(1.02), f, s(0.07), s(0.84), s(0.91), GLASS),
    // Swept fin (team colour) with a white tip band. Its root sits a little
    // below the cone's skin (trailing edge extended to match), so it never
    // floats above the thin end of the cone.
    slab(
      scene,
      pts(s, s, [
        [-0.7, 0.08],
        [-1.014, 0.08],
        [-1.14, 0.5],
        [-0.98, 0.5],
      ]),
      s(0.04),
      "vertical",
      0,
      teamDark,
    ),
    slab(
      scene,
      pts(s, s, [
        [-0.98, 0.5],
        [-1.14, 0.5],
        [-1.16, 0.58],
        [-1.02, 0.58],
      ]),
      s(0.04),
      "vertical",
      0,
      WHITE,
    ),
  ];
  // Swept tailplanes.
  const stab = pts(s, s, [
    [-0.8, 0.05],
    [-1.0, 0.05],
    [-1.1, 0.42],
    [-1.0, 0.42],
  ]);
  body.push(slab(scene, stab, s(0.035), "horizontal", s(0.03), teamDark));
  body.push(slab(scene, mirrorZ(stab), s(0.035), "horizontal", s(0.03), teamDark));
  setBody(root, body, mats);

  // Beacon on the spine, strobe at the back of the fin tip.
  light(scene, root, O, new Vector3(0, f / 2 + s(0.03), 0), s(0.08), "beacon", mats.beacon);
  light(scene, root, O, new Vector3(s(-1.13), s(0.6), 0), s(0.08), "strobe", mats.strobe);

  // Landing lights: one under the nose, one in each wing root's leading
  // edge; the beam starts at the nose lamp.
  const noseLamp = new Vector3(s(0.9), s(-0.08), 0);
  headlight(scene, root, O, noseLamp, s(0.06), mats);
  for (const side of [1, -1] as const) {
    headlight(scene, root, O, new Vector3(s(0.27), s(-0.06), side * s(0.22)), s(0.06), mats);
  }
  headBeam(scene, root, noseLamp, r, mats);

  // Wings: swept, low-mounted, each with an engine and winglet.
  const wingY = s(-0.06);
  for (const side of [1, -1] as const) {
    const z = (v: number) => side * s(v);
    const outline = pts(s, z, [
      [0.3, 0.1],
      [-0.22, 0.1],
      [-0.52, 1.1],
      [-0.36, 1.1],
    ]);
    const parts = [
      slab(scene, outline, s(0.05), "horizontal", wingY, teamDark),
      // Winglet, swept up at the tip.
      slab(
        scene,
        pts(s, (v) => wingY + s(v), [
          [-0.36, 0],
          [-0.52, 0],
          [-0.56, 0.16],
          [-0.47, 0.16],
        ]),
        s(0.02),
        "vertical",
        z(1.1),
        teamDark,
      ),
      // Engine: nacelle, dark intake and pylon.
      tube(scene, s(0.0), s(0.38), s(0.1), s(0.15), wingY - s(0.1), z(0.4), LIGHT_GREY, 10),
      tube(scene, s(0.38), s(0.4), s(0.13), s(0.13), wingY - s(0.1), z(0.4), DARK, 10),
      block(scene, s(0.2), s(0.07), s(0.03), s(0.1), wingY - s(0.04), z(0.4), GREY),
    ];
    const pivot = new Vector3(0, wingY, z(0.15));
    const wing = attach(parts, root, O, pivot, { role: "wing", side }, mats.paint);
    const tip = new Vector3(s(-0.44), wingY, z(1.12));
    light(scene, wing, pivot, tip, s(0.08), "nav", side === 1 ? mats.navRed : mats.navGreen);
    light(scene, wing, pivot, tip.add(new Vector3(s(-0.1), 0, 0)), s(0.06), "strobe", mats.strobe);
  }

  // Gear: nose leg folding forward, main legs under the wing roots folding
  // inward into the belly.
  gearLeg(scene, mats, root, r, new Vector3(s(0.62), s(-0.12), 0), s(0.08), 1, "forward");
  for (const side of [1, -1] as const) {
    gearLeg(
      scene,
      mats,
      root,
      r,
      new Vector3(s(-0.12), s(-0.08), side * s(0.24)),
      s(0.1),
      side,
      "inward",
    );
  }
};

/** Regional turboprop: white fuselage, team high wing, T-tail, twin props. */
const buildTurboprop: Builder = (scene, root, r, team, teamDark, mats) => {
  const s = (v: number) => v * r;
  const O = Vector3.Zero();
  const f = s(0.27);

  const body = [
    tube(scene, s(-0.6), s(0.78), f, f, 0, 0, WHITE, 12),
    tube(scene, s(0.78), s(0.98), f, s(0.08), 0, 0, WHITE, 12), // nose
    tailCone(scene, s(-1.08), s(-0.6), s(0.07), f, s(0.05), WHITE, 12),
    // Team cheatline along the windows, on the straight fuselage only.
    block(scene, s(1.38), s(0.06), f * 1.03, s(0.09), s(0.02), 0, team),
    noseBand(scene, s(0.78), s(0.98), f, s(0.08), s(0.82), s(0.89), GLASS),
    // Fin (root sunk into the cone's skin), then the tailplane perched on top
    // of it (T-tail).
    slab(
      scene,
      pts(s, s, [
        [-0.72, 0.08],
        [-0.973, 0.08],
        [-1.12, 0.52],
        [-0.99, 0.52],
      ]),
      s(0.04),
      "vertical",
      0,
      team,
    ),
  ];
  const stab = pts(s, s, [
    [-0.96, 0],
    [-1.14, 0],
    [-1.16, 0.4],
    [-1.06, 0.4],
  ]);
  body.push(slab(scene, stab, s(0.035), "horizontal", s(0.53), teamDark));
  body.push(slab(scene, mirrorZ(stab), s(0.035), "horizontal", s(0.53), teamDark));
  setBody(root, body, mats);

  light(scene, root, O, new Vector3(s(-1.14), s(0.57), 0), s(0.08), "strobe", mats.strobe);
  light(scene, root, O, new Vector3(0, -f / 2 - s(0.02), 0), s(0.08), "beacon", mats.beacon);

  // Landing light under the nose, where the beam starts (the wing lamps
  // are added with the wings below).
  const noseLamp = new Vector3(s(0.88), s(-0.075), 0);
  headlight(scene, root, O, noseLamp, s(0.06), mats);
  headBeam(scene, root, noseLamp, r, mats);

  // High, straight, slightly tapered wing on the fuselage roof.
  const wingY = f / 2 + s(0.02);
  for (const side of [1, -1] as const) {
    const z = (v: number) => side * s(v);
    const outline = pts(s, z, [
      [0.2, 0],
      [-0.12, 0],
      [-0.06, 1.2],
      [0.14, 1.2],
    ]);
    const parts = [
      slab(scene, outline, s(0.045), "horizontal", wingY, team),
      // Engine nacelle slung under the wing.
      tube(scene, s(-0.2), s(0.32), s(0.08), s(0.14), wingY - s(0.06), z(0.4), WHITE, 10),
    ];
    const pivot = new Vector3(0, wingY, z(0.14));
    const wing = attach(parts, root, O, pivot, { role: "wing", side }, mats.paint);
    propeller(scene, mats, wing, pivot, new Vector3(s(0.34), wingY - s(0.06), z(0.4)), s(0.22), 4);
    const tip = new Vector3(s(0.04), wingY, z(1.22));
    light(scene, wing, pivot, tip, s(0.08), "nav", side === 1 ? mats.navRed : mats.navGreen);
    // Landing light in the leading edge, outboard of the engine.
    headlight(scene, wing, pivot, new Vector3(s(0.17), wingY, z(0.7)), s(0.06), mats);
  }

  // Gear: all three legs fold forward, the mains into sponsons low on the
  // fuselage sides.
  gearLeg(scene, mats, root, r, new Vector3(s(0.6), s(-0.11), 0), s(0.08), 1, "forward");
  for (const side of [1, -1] as const) {
    gearLeg(
      scene,
      mats,
      root,
      r,
      new Vector3(s(-0.05), s(-0.1), side * s(0.17)),
      s(0.1),
      side,
      "forward",
    );
  }
};

/** Single-engine trainer: white fuselage, team cowling, wing and tail. */
const buildLight: Builder = (scene, root, r, team, teamDark, mats) => {
  const s = (v: number) => v * r;
  const O = Vector3.Zero();
  const f = s(0.3);
  // Tail boom: tapers from the cabin (diameter f) back to `dRear`.
  const boom = { x0: s(-0.98), x1: s(-0.15), dRear: s(0.08), rise: s(0.04) };
  /** Half-width of the boom stripe at x: the boom's radius, a touch proud. */
  const stripe = (x: number) =>
    ((boom.dRear + ((f - boom.dRear) * (x - boom.x0)) / (boom.x1 - boom.x0)) / 2) * 1.06;

  const body = [
    tube(scene, s(-0.15), s(0.55), f, f, 0, 0, WHITE, 8), // cabin
    tailCone(scene, boom.x0, boom.x1, boom.dRear, f, boom.rise, WHITE, 8), // tail boom
    tube(scene, s(0.55), s(0.76), f, s(0.2), 0, 0, team, 8), // cowling
    // Wraparound cabin glazing.
    block(scene, s(0.45), s(0.1), f * 1.04, s(0.22), s(0.07), 0, GLASS),
    // Team stripe down the boom: a band just proud of the skin that narrows
    // with the boom and rises with it.
    shearUp(
      slab(
        scene,
        [
          [boom.x1, stripe(boom.x1)],
          [s(-0.9), stripe(s(-0.9))],
          [s(-0.9), -stripe(s(-0.9))],
          [boom.x1, -stripe(boom.x1)],
        ],
        s(0.04),
        "horizontal",
        s(0.02),
        team,
      ),
      boom.x0,
      boom.x1,
      boom.rise,
    ),
    slab(
      scene,
      pts(s, s, [
        [-0.72, 0.06],
        [-0.98, 0.06],
        [-0.98, 0.46],
        [-0.86, 0.46],
      ]),
      s(0.04),
      "vertical",
      0,
      teamDark,
    ),
  ];
  const stab = pts(s, s, [
    [-0.74, 0],
    [-0.98, 0],
    [-0.98, 0.42],
    [-0.8, 0.42],
  ]);
  body.push(slab(scene, stab, s(0.035), "horizontal", s(0.04), teamDark));
  body.push(slab(scene, mirrorZ(stab), s(0.035), "horizontal", s(0.04), teamDark));
  setBody(root, body, mats);

  light(scene, root, O, new Vector3(s(-0.97), s(0.49), 0), s(0.09), "strobe", mats.strobe);
  propeller(scene, mats, root, O, new Vector3(s(0.8), 0, 0), s(0.3), 2);

  // Rectangular high wing on the cabin roof.
  const wingY = f / 2 + s(0.03);
  for (const side of [1, -1] as const) {
    const z = (v: number) => side * s(v);
    const outline = pts(s, z, [
      [0.36, 0],
      [0.06, 0],
      [0.06, 1.25],
      [0.36, 1.25],
    ]);
    const parts = [
      slab(scene, outline, s(0.05), "horizontal", wingY, team),
      // White tip caps, so the wing's end reads against the grass.
      slab(
        scene,
        pts(s, z, [
          [0.36, 1.12],
          [0.06, 1.12],
          [0.06, 1.25],
          [0.36, 1.25],
        ]),
        s(0.055),
        "horizontal",
        wingY,
        WHITE,
      ),
    ];
    const pivot = new Vector3(0, wingY, z(0.12));
    const wing = attach(parts, root, O, pivot, { role: "wing", side }, mats.paint);
    const tip = new Vector3(s(0.22), wingY, z(1.27));
    light(scene, wing, pivot, tip, s(0.09), "nav", side === 1 ? mats.navRed : mats.navGreen);
    // Landing light in the leading edge, halfway out.
    headlight(scene, wing, pivot, new Vector3(s(0.37), wingY, z(0.5)), s(0.07), mats);
  }
  // No room in the nose for a lamp (the prop's there): the beam starts
  // under the cowling.
  headBeam(scene, root, new Vector3(s(0.62), s(-0.12), 0), r, mats);

  // Fixed tricycle gear: always down.
  gearLeg(scene, mats, root, r, new Vector3(s(0.5), s(-0.1), 0), s(0.09), 1, "fixed");
  for (const side of [1, -1] as const) {
    gearLeg(
      scene,
      mats,
      root,
      r,
      new Vector3(s(0.02), s(-0.1), side * s(0.26)),
      s(0.1),
      side,
      "fixed",
    );
  }
};

// ---------------------------------------------------------------------------
// Rig + animation
// ---------------------------------------------------------------------------

/** Sort a freshly cloned plane's child meshes by role. */
export function rigFromClone(kind: AircraftKind, root: Mesh, id: number): AircraftRig {
  const rig: AircraftRig = {
    kind,
    root,
    wings: [],
    props: [],
    strobes: [],
    beacons: [],
    navs: [],
    gear: [],
    all: [root],
    shadowCasters: [root],
    lights: [],
    headlights: [],
    headBeams: [],
    // Golden-ratio spread, like the wind phases.
    phase: (id * 0.618034) % 1,
  };
  for (const mesh of root.getChildMeshes(false)) {
    if (!(mesh instanceof Mesh)) continue;
    rig.all.push(mesh);
    const meta = mesh.metadata as PartMeta | null;
    switch (meta?.role) {
      case "wing":
        rig.wings.push({ mesh, side: meta.side ?? 1 });
        rig.shadowCasters.push(mesh);
        break;
      case "prop":
        rig.props.push(mesh);
        rig.shadowCasters.push(mesh);
        break;
      case "strobe":
        rig.strobes.push(mesh);
        rig.lights.push(mesh);
        break;
      case "beacon":
        rig.beacons.push(mesh);
        rig.lights.push(mesh);
        break;
      case "nav":
        rig.navs.push(mesh);
        rig.lights.push(mesh);
        break;
      case "headlight":
        rig.headlights.push(mesh);
        break;
      case "headBeam":
        // Not reliably copied by `clone`; without it the rim wouldn't fade.
        mesh.hasVertexAlpha = true;
        rig.headBeams.push(mesh);
        break;
      case "gear":
        rig.gear.push({ mesh, side: meta.side ?? 1, fold: meta.fold ?? "fixed" });
        rig.shadowCasters.push(mesh);
        break;
      default:
        break; // blur discs: no shadow, no glow
    }
  }
  return rig;
}

/** Per-frame inputs for `animateAircraft`. */
export interface AircraftMotion {
  time: number;
  dt: number;
  /** Displayed bank angle (radians). */
  bank: number;
  /** Turbulence chop, roughly -1..1 (0 on the ground). */
  chop: number;
  /** Landing rollout progress 0..1 (0 while airborne). */
  rollout: number;
  /**
   * Landing gear: 0 = retracted, 1 = down and locked. Eased by the caller
   * (render/sceneSync.ts), so in between is the legs mid-swing. Fixed gear
   * ignores it.
   */
  gear: number;
  /**
   * Nav lights, strobes and beacon on (default) or all off, as in a hangar
   * (see core/ground.ts `isInHangar`). The glow layer draws only the
   * lights, so nothing hides their halos: off is the only way to hide them.
   */
  lights?: boolean;
}

/** Advance a plane's moving parts: wing flex, prop spin and light flashes. */
export function animateAircraft(rig: AircraftRig, m: AircraftMotion): void {
  const t = flightTuning;

  // Wings bend up with load: a level turn at bank φ pulls 1/cos φ g, so the
  // extra load is 1/cos φ − 1. Turbulence adds a small flutter on top.
  const load = 1 / Math.cos(Math.min(Math.abs(m.bank), 1.2)) - 1;
  const flex = kindFlex(rig.kind) * (t.flexBase + t.flexLoad * load + t.flexBump * m.chop);
  // Positive rotation about +x lifts the -z (right) tip, so the left wing
  // (+z, side +1) takes the negative angle.
  for (const { mesh, side } of rig.wings) mesh.rotation.x = -side * flex;

  const spin = kindSpin(rig.kind) * (1 - (1 - t.rolloutSpin) * m.rollout);
  for (const prop of rig.props) prop.rotation.x = (prop.rotation.x + spin * m.dt) % (Math.PI * 2);

  // Strobes: two quick white flashes per cycle. Beacon: one longer red blink.
  const lit = m.lights ?? true;
  const ts = (m.time / t.strobePeriod + rig.phase) % 1;
  const strobeOn = lit && (ts < 0.04 || (ts > 0.12 && ts < 0.16));
  for (const strobe of rig.strobes) strobe.setEnabled(strobeOn);
  const tb = (m.time / t.beaconPeriod + rig.phase * 1.7) % 1;
  for (const beacon of rig.beacons) beacon.setEnabled(lit && tb < 0.12);
  for (const nav of rig.navs) nav.setEnabled(lit);

  // Gear: each leg swings up to 90° from down. A retracted leg is hidden:
  // folded, it would poke through the skin of these simple bodies.
  const fold = (1 - m.gear) * (Math.PI / 2);
  for (const leg of rig.gear) {
    if (leg.fold === "fixed") continue;
    leg.mesh.setEnabled(m.gear > 0.02);
    // Positive rotation about +x swings a hanging leg towards -z: inward
    // for the left leg (+z, side +1). About +z it swings towards +x (forward).
    if (leg.fold === "inward") leg.mesh.rotation.x = leg.side * fold;
    else leg.mesh.rotation.z = fold;
  }
}

/**
 * Landing lights on or off (lamps and beam). Whether they show at all is
 * up to their materials, faded in with `night` (meshes.ts `setNight`); this
 * switches them off where a real plane's would be: in the hangar.
 */
export function setHeadlights(rig: AircraftRig, on: boolean): void {
  for (const mesh of rig.headlights) mesh.setEnabled(on);
  for (const mesh of rig.headBeams) mesh.setEnabled(on);
}

/** Fade the whole plane, children included (Babylon doesn't inherit it). */
export function setAircraftVisibility(rig: AircraftRig, visibility: number): void {
  for (const mesh of rig.all) mesh.visibility = visibility;
}
