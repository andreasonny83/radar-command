/**
 * Vapour trails: a soft white ribbon streaming behind every airborne plane,
 * so a plane (and where it has just been) stands out against the landscape.
 *
 * Purely visual. Each plane keeps a short list of recent positions, aged by
 * the scene clock (`dt` is 0 while paused, so a paused trail holds still).
 * All trails are written into ONE dynamic ribbon mesh, rebuilt every frame:
 * one draw call however many planes are up. Each point carries a vertex
 * colour whose alpha fades with age, and the ribbon widens as it ages, like
 * a real trail spreading out.
 *
 * The ribbon lies flat at the plane's own height (the camera looks down at
 * a tilt), and draws in `OVERLAY_GROUP` with the planes, over the scenery
 * but under the clouds.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { OVERLAY_GROUP } from "./scene";

/** Seconds a trail point lives; at plane speed 7 that is a trail ~18 units long. */
export const TRAIL_LIFETIME = 3.4;
/** Minimum distance (scene units) between recorded points. */
export const TRAIL_SPACING = 0.35;
/** Ribbon width at the plane, and at the end of its life (scene units). */
export const TRAIL_WIDTH_START = 0.5;
export const TRAIL_WIDTH_END = 3.2;
/** Opacity right behind the plane (0..1); fades to 0 along the trail. */
export const TRAIL_ALPHA = 0.9;
/**
 * How fast the air carries a trail sideways (scene units per second): the
 * older the trail, the further it has drifted from where it was laid.
 */
export const TRAIL_DRIFT = { x: 0.35, z: 0.2 };
/** Puffiness: share (0..1) the width and opacity wobble along the trail. */
export const TRAIL_WOBBLE = 0.3;
/**
 * Opacity across the ribbon, edge to edge: a bright core with soft,
 * feathered edges (a hard-edged strip looks like a painted line).
 */
export const TRAIL_PROFILE = [0, 0.35, 1, 0.35, 0];
/** How far across (-1..1 of the half width) each of those columns sits. */
const ACROSS = [-1, -0.5, 0, 0.5, 1];

/** How far behind the plane's centre the trail starts (about its tail). */
export const TRAIL_TAIL_OFFSET = 1.6;
/** Share of the plane's colour mixed into the white (0 = pure white). */
export const TRAIL_TINT = 0.2;
/** How much night dims the trails (0 = not at all, 1 = invisible). */
export const TRAIL_NIGHT_DIM = 0.55;

/** One recorded position of a trail. */
interface TrailPoint {
  x: number;
  y: number;
  z: number;
  age: number;
  /** Running number of the point within its trail: its place in the wobble. */
  n: number;
}

/** A plane's trail: oldest point first. */
interface Trail {
  points: TrailPoint[];
  /** Colour at the head, white mixed with a little of the plane's colour. */
  r: number;
  g: number;
  b: number;
  /** Head position this frame (behind the plane), null once the plane is gone. */
  head: TrailPoint | null;
  /** Points laid so far, and this trail's own offset into the wobble. */
  laid: number;
  phase: number;
}

export class PlaneTrails {
  private readonly mesh: Mesh;
  private readonly trails = new Map<number, Trail>();
  private night = 0;
  /** Vertex buffers, regrown when more planes need room. */
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private indices = new Uint32Array(0);
  /** Vertex capacity the mesh was last built with. */
  private capacity = 0;

  constructor(scene: Scene) {
    this.mesh = new Mesh("plane-trails", scene);
    this.mesh.isPickable = false;
    this.mesh.hasVertexAlpha = true;
    this.mesh.alwaysSelectAsActiveMesh = true; // bounds change every frame
    this.mesh.renderingGroupId = OVERLAY_GROUP;
    this.mesh.setEnabled(false); // nothing to draw yet

    const mat = new StandardMaterial("plane-trails", scene);
    mat.disableLighting = true; // flat white, whatever the time of day
    mat.emissiveColor = Color3.White(); // multiplied by the vertex colour
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false; // the ribbon is seen from either side
    mat.disableDepthWrite = true; // translucent: never hides what is behind
    this.mesh.material = mat;
  }

  /** 0 day … 1 night: dims the trails so they don't glow in the dark. */
  setNight(n: number): void {
    this.night = n;
  }

  /**
   * Note where plane `id` is this frame. `pos` is its drawn scene position;
   * `heading` the direction it is drawn flying, so the trail can start at
   * the tail. Call each frame for every airborne plane: a plane that stops
   * being tracked (landed, crashed, gone) just lets its trail fade out.
   */
  track(id: number, pos: Vector3, heading: number, rgb: Color3): void {
    let trail = this.trails.get(id);
    if (!trail) {
      trail = {
        points: [],
        r: 1 + (rgb.r - 1) * TRAIL_TINT,
        g: 1 + (rgb.g - 1) * TRAIL_TINT,
        b: 1 + (rgb.b - 1) * TRAIL_TINT,
        head: null,
        laid: 0,
        phase: Math.random() * 100,
      };
      this.trails.set(id, trail);
    }
    // Plane faces (cos h, 0, -sin h) in scene space (see render/coords.ts).
    const head: TrailPoint = {
      x: pos.x - Math.cos(heading) * TRAIL_TAIL_OFFSET,
      y: pos.y,
      z: pos.z + Math.sin(heading) * TRAIL_TAIL_OFFSET,
      age: 0,
      n: trail.laid,
    };
    trail.head = head;
    const last = trail.points[trail.points.length - 1];
    if (!last || Math.hypot(head.x - last.x, head.z - last.z) >= TRAIL_SPACING) {
      trail.points.push({ ...head });
      trail.laid++;
    }
  }

  /** Age every trail by `dt`, drop what has faded, and rebuild the ribbon. */
  update(dt: number): void {
    let vertexCount = 0;
    for (const [id, trail] of this.trails) {
      for (const p of trail.points) p.age += dt;
      while (trail.points.length > 0 && trail.points[0]!.age >= TRAIL_LIFETIME) {
        trail.points.shift();
      }
      if (trail.points.length === 0 && trail.head === null) {
        this.trails.delete(id);
        continue;
      }
      // The live head is tracked again next frame, or the plane is gone.
      vertexCount += (trail.points.length + (trail.head ? 1 : 0)) * ACROSS.length;
    }
    this.build(vertexCount);
    for (const trail of this.trails.values()) trail.head = null;
  }

  private build(vertexCount: number): void {
    this.mesh.setEnabled(vertexCount >= 2 * ACROSS.length);
    if (vertexCount < 2 * ACROSS.length) return;
    if (vertexCount > this.capacity) {
      // Grow with headroom so planes joining don't reallocate every frame.
      this.capacity = vertexCount * 2;
      this.positions = new Float32Array(this.capacity * 3);
      this.colors = new Float32Array(this.capacity * 4);
      this.indices = new Uint32Array(this.capacity * 6);
    }

    const dim = 1 - TRAIL_NIGHT_DIM * this.night;
    let v = 0; // vertices written
    let i = 0; // indices written
    for (const trail of this.trails.values()) {
      // Oldest first, ending at the live head (age 0).
      const pts = trail.head ? [...trail.points, trail.head] : trail.points;
      if (pts.length < 2) continue;
      const first = v;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]!;
        // Direction of travel here, from the neighbours on either side.
        const a = pts[Math.max(0, k - 1)]!;
        const b = pts[Math.min(pts.length - 1, k + 1)]!;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const life = Math.min(1, p.age / TRAIL_LIFETIME);
        // Two slow, unrelated waves along the trail: puffs and thin spots.
        const w1 =
          Math.sin(trail.phase + p.n * 0.37) * 0.6 + Math.sin(trail.phase * 1.7 + p.n * 0.91) * 0.4;
        const w2 =
          Math.sin(trail.phase * 2.3 + p.n * 0.53) * 0.6 + Math.sin(p.n * 1.37 + trail.phase) * 0.4;
        // Spreads fast at first, then slowly, as a real trail does.
        const spread = Math.pow(life, 0.6);
        const half =
          ((TRAIL_WIDTH_START + (TRAIL_WIDTH_END - TRAIL_WIDTH_START) * spread) / 2) *
          (1 + TRAIL_WOBBLE * w1 * life);
        const alpha = TRAIL_ALPHA * Math.pow(1 - life, 1.2) * (1 + TRAIL_WOBBLE * w2 * 0.8) * dim;
        // Sideways = travel direction turned 90° in the ground plane.
        const sx = -dz * half;
        const sz = dx * half;
        // Carried off by the wind the longer it hangs in the air.
        const ox = p.x + TRAIL_DRIFT.x * p.age;
        const oz = p.z + TRAIL_DRIFT.z * p.age;
        for (let c = 0; c < ACROSS.length; c++) {
          const side = ACROSS[c]!;
          this.positions.set([ox + sx * side, p.y, oz + sz * side], v * 3);
          this.colors.set(
            [trail.r, trail.g, trail.b, Math.max(0, alpha) * TRAIL_PROFILE[c]!],
            v * 4,
          );
          v++;
        }
      }
      const cols = ACROSS.length;
      for (let k = 0; k < pts.length - 1; k++) {
        for (let c = 0; c < cols - 1; c++) {
          const q = first + k * cols + c;
          this.indices.set([q, q + 1, q + cols, q + 1, q + cols + 1, q + cols], i);
          i += 6;
        }
      }
    }

    // Rebuilt from scratch each frame: set the data whole (sizes change).
    const data = new VertexData();
    data.positions = this.positions.subarray(0, v * 3);
    data.colors = this.colors.subarray(0, v * 4);
    data.indices = this.indices.subarray(0, i);
    data.applyToMesh(this.mesh, true);
    this.mesh.refreshBoundingInfo();
  }

  /** Forget every trail (the scene is rewound, so the old tracks mean nothing). */
  clear(): void {
    this.trails.clear();
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
    this.trails.clear();
  }
}
