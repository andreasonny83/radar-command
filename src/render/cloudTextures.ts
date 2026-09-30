/**
 * The pictures of the clouds (see core/clouds.ts), painted once on canvases
 * at startup: per-pixel fractal noise, so edges are billowy and ragged
 * rather than smooth blobs.
 *
 * - A *formation* (`paintFormation`): a handful of round "puffs" laid out as
 *   a bank, a street or a lone cumulus. Their summed falloff is the cloud's
 *   body; noise eats into its rim and stirs its inside. Shading is baked in:
 *   pixels with more cloud between them and the sun are greyer, and the
 *   thick middle is darker than the rim. The sun is fixed (it shines from
 *   `SUN` in the picture's own frame), matching the ground shadow.
 * - A *cirrus wisp* (`paintCirrus`): noise stretched along the wind, tapering
 *   at both ends.
 *
 * Both only write the alpha and the colour: how see-through a cloud is, and
 * its tint at night, are the material's business (render/clouds.ts).
 * Changing the look? Edit the constants below; the "Scene/Clouds" stories
 * show every picture.
 */
import { mulberry32 } from "../core/math";
import type { Rng } from "../core/types";
import type { CloudShape } from "../core/clouds";

/** Width (px) of a formation picture and of a cirrus picture. */
export const FORMATION_WIDTH = 384;
export const CIRRUS_WIDTH = 512;

/** Size in px of the noise's biggest billows, and its octaves. */
const BILLOW = 32;
const OCTAVES = 4;
/** How far the noise moves the edge of a puff (in units of puff falloff). */
const RAGGEDNESS = 1;
/** Body density where a cloud goes from clear to solid (soft rim between). */
const EDGE_LOW = 0.2;
const EDGE_HIGH = 0.65;

/** Which way the light comes from, in the picture (right, down), and how far to look. */
const SUN: [number, number] = [0.78, 0.62];
const SUN_STEP = 14;
/** Colours: in the shade, and in the sun. */
const SHADE_RGB: [number, number, number] = [146, 162, 192];
const LIT_RGB: [number, number, number] = [255, 255, 255];
/** How much a pixel is darkened by cloud towards the sun, and by its own depth. */
const SHADOWING = 0.7;
const DEPTH_DARKENING = 0.25;

interface Puff {
  x: number;
  y: number;
  r: number;
}

// --- Noise ------------------------------------------------------------------

/** A repeatable pseudo-random number in [0, 1) for the lattice point (x, y). */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise in [0, 1]: `octaves` layers of value noise, each finer and fainter. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

// --- Formations -------------------------------------------------------------

/** The puffs of a formation, placed at random (from `rng`) on a `w` x `h` picture. */
function layoutPuffs(shape: CloudShape, rng: Rng, w: number, h: number): Puff[] {
  const range = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const puffs: Puff[] = [];
  if (shape === "bank") {
    // One big cumulus with smaller ones crowding round it, wider than tall.
    const ax = w * range(0.42, 0.58);
    const ay = h * range(0.45, 0.55);
    const ar = h * range(0.26, 0.32);
    puffs.push({ x: ax, y: ay, r: ar });
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + range(-0.4, 0.4);
      const dist = ar * range(0.5, 0.95);
      puffs.push({
        x: ax + Math.cos(angle) * dist * 1.5,
        y: ay + Math.sin(angle) * dist * 0.85,
        r: ar * range(0.5, 0.8),
      });
    }
  } else if (shape === "street") {
    // A line of small cumuli along the wind, with smaller ones in the gaps.
    const n = 5 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      puffs.push({
        x: w * (0.14 + (0.72 * i) / (n - 1)),
        y: h * (0.5 + range(-0.08, 0.08)),
        r: h * range(0.17, 0.26),
      });
    }
    for (let i = 0; i < 4; i++) {
      puffs.push({ x: w * range(0.2, 0.8), y: h * range(0.35, 0.65), r: h * range(0.1, 0.14) });
    }
  } else {
    // One big cumulus, its rim knobbly with smaller ones.
    const big = h * range(0.33, 0.38);
    puffs.push({ x: w / 2, y: h / 2, r: big });
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + range(-0.3, 0.3);
      const dist = big * range(0.5, 0.8);
      puffs.push({
        x: w / 2 + Math.cos(angle) * dist * 1.35,
        y: h / 2 + Math.sin(angle) * dist * 0.9,
        r: big * range(0.4, 0.6),
      });
    }
  }
  // Keep every puff on the picture, so no cloud is cut off at its edge.
  for (const p of puffs) {
    p.x = Math.min(w - p.r - 4, Math.max(p.r + 4, p.x));
    p.y = Math.min(h - p.r - 4, Math.max(p.r + 4, p.y));
  }
  return puffs;
}

/** The puffs' summed falloff at (x, y): 0 outside all, about 1 in the middle of one. */
function body(puffs: readonly Puff[], x: number, y: number): number {
  let sum = 0;
  for (const p of puffs) {
    const dx = x - p.x;
    const dy = y - p.y;
    const d2 = (dx * dx + dy * dy) / (p.r * p.r);
    if (d2 < 1) sum += (1 - d2) * (1 - d2);
  }
  return sum;
}

/**
 * Paint a formation of `shape` onto `ctx` (a `w` x `h` canvas). `seed`
 * makes each picture of a shape different.
 */
export function paintFormation(
  ctx: CanvasRenderingContext2D,
  shape: CloudShape,
  seed: number,
  w: number,
  h: number,
): void {
  const puffs = layoutPuffs(shape, mulberry32(seed), w, h);
  const image = ctx.createImageData(w, h);
  const freq = 1 / BILLOW;
  /** Cloud density at a pixel: the puffs, their rim roughened by noise. */
  const density = (x: number, y: number, meta: number) =>
    meta + (fbm(x * freq, y * freq, seed, OCTAVES) - 0.5) * RAGGEDNESS * Math.min(1, meta * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const meta = body(puffs, x, y);
      if (meta <= 0) continue; // clear sky: stays transparent
      const d = density(x, y, meta);
      const alpha = smoothstep(EDGE_LOW, EDGE_HIGH, d);
      if (alpha <= 0) continue;
      // Shading: more cloud between this pixel and the sun means shade.
      const sx = x + SUN[0] * SUN_STEP;
      const sy = y + SUN[1] * SUN_STEP;
      const towardSun = density(sx, sy, body(puffs, sx, sy));
      const occlusion = Math.min(1, Math.max(-0.5, (towardSun - d) * 2.2));
      const light = Math.min(
        1,
        Math.max(0, 0.82 - occlusion * SHADOWING - DEPTH_DARKENING * smoothstep(0.7, 1.6, d)),
      );
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        image.data[i + c] = SHADE_RGB[c]! + (LIT_RGB[c]! - SHADE_RGB[c]!) * light;
      }
      image.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// --- Cirrus -----------------------------------------------------------------

/**
 * Paint a cirrus wisp onto `ctx` (a `w` x `h` canvas): streaks of noise
 * stretched along x, bent a little, thinning out towards both ends and both
 * sides.
 */
export function paintCirrus(
  ctx: CanvasRenderingContext2D,
  seed: number,
  w: number,
  h: number,
): void {
  const image = ctx.createImageData(w, h);
  const bend = 10 + (seed % 7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // Thinner towards both ends and both sides.
      const envelope =
        Math.pow(Math.sin(Math.PI * u), 0.8) * smoothstep(0, 0.5, 1 - Math.abs(2 * v - 1));
      if (envelope <= 0) continue;
      const wave = Math.sin(x / 70 + seed) * bend;
      // Stretched: slow along the wisp, quick across it.
      const n = fbm(x / 110, (y + wave) / 7, seed, OCTAVES);
      const alpha = smoothstep(0.42, 0.78, n) * envelope * 0.9;
      if (alpha <= 0) continue;
      const i = (y * w + x) * 4;
      image.data[i] = 250;
      image.data[i + 1] = 252;
      image.data[i + 2] = 255;
      image.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
