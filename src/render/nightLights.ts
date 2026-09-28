/**
 * Building blocks for fake night lights. Real Babylon lights are out:
 * StandardMaterial lights at most 4 per mesh by default and dozens of point
 * lights would cost the frame rate. Instead:
 *
 * - lamps: small unlit emissive meshes (bulbs, windows, lanterns), faded
 *   in with the material's alpha;
 * - pools: flat additive discs lying on the ground, bright in the middle
 *   and fading to nothing at the rim, which read as light cast on the
 *   ground (floodlights, headlight beams, street-lamp pools).
 *
 * Both are driven by one number, `setNightLevel(material, level)`. At 0
 * every mesh using the material is hidden, so the day costs nothing.
 */
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";

/** Segments round a light pool's rim. */
const POOL_SEGMENTS = 20;

/** Unlit bulb / window / lantern in `hex`; off (alpha 0) until night. */
export function lampMaterial(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.FromHexString(hex);
  mat.alpha = 0;
  return mat;
}

/** Additive light cast on the ground, in `hex`; off until night. */
export function poolMaterial(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.FromHexString(hex);
  mat.alphaMode = Constants.ALPHA_ADD;
  // Pools overlap each other and the paint: never hide what's under them.
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.alpha = 0;
  return mat;
}

/**
 * Fade a lamp or pool material to `level` (0 off … 1 full). Meshes using it
 * are shown or hidden only when it crosses 0, so this is cheap every frame.
 */
export function setNightLevel(mat: StandardMaterial, level: number): void {
  const wasOn = mat.alpha > 0;
  mat.alpha = Math.max(0, Math.min(1, level));
  const on = mat.alpha > 0;
  if (on !== wasOn) for (const mesh of mat.getBindedMeshes()) mesh.isVisible = on;
}

/**
 * Is `mat` lit right now? For meshes built after the last `setNightLevel`
 * (a runway opened at night, a boat launched at night): set
 * `mesh.isVisible = litNow(mat)` so they don't wait for the next change.
 */
export function litNow(mat: StandardMaterial): boolean {
  return mat.alpha > 0;
}

/**
 * Unit light pool: a flat disc of radius 1 on y = 0, opaque in the middle,
 * fading to transparent at the rim (vertex alpha). Scale and place it with
 * the mesh transform or thin-instance matrices.
 */
export function createPoolMesh(name: string, scene: Scene): Mesh {
  const positions = [0, 0, 0];
  const colors = [1, 1, 1, 1];
  const normals = [0, 1, 0];
  const indices: number[] = [];
  for (let i = 0; i < POOL_SEGMENTS; i++) {
    const a = (i / POOL_SEGMENTS) * Math.PI * 2;
    positions.push(Math.cos(a), 0, Math.sin(a));
    colors.push(1, 1, 1, 0);
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < POOL_SEGMENTS; i++) {
    indices.push(0, 1 + ((i + 1) % POOL_SEGMENTS), 1 + i);
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.normals = normals;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  return mesh;
}
