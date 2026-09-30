/**
 * The wind streams on the map (see core/windStreams.ts): soft translucent
 * bands on the ground that show where the air is about to turn rough.
 *
 * - forming: a glowing dashed outline round a faint fill, with a big arrow
 *   showing which way the wind will blow. Still, pulsing gently: a warning,
 *   the stream is harmless yet;
 * - active: the outline gives way to flowing wisps, two layers moving at
 *   different speeds so the band has depth, fading out towards every edge
 *   so it reads as moving air, not a painted rectangle;
 * - fading: the wisps thin out with the wind's strength.
 *
 * Each band is a ground strip turned to the wind heading. The feathered
 * edge is baked into the strip's vertex alpha (`featheredStrip`); the
 * wisps are a seamless tile drawn once on a canvas and scrolled by moving
 * the texture offset, so a stream costs two small meshes and nothing is
 * rebuilt per frame. Purely visual: the push on planes is in
 * `core/windStreams.ts`; this reads `GameState.streams` and draws.
 *
 * Not to be confused with render/wind.ts, the cosmetic turbulence every
 * airborne plane gets.
 *
 * Changing how it looks? Edit the constants below; the "Scene/Wind streams"
 * stories play all phases.
 */
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { WIND_LENGTH, WIND_WIDTH } from "../config";
import { mulberry32 } from "../core/math";
import type { WindStream, WorldSize } from "../core/types";
import { windPhase, windStrength } from "../core/windStreams";
import { headingToRotationY, toScene } from "./coords";
import { OVERLAY_GROUP } from "./scene";

/** Colour of the wind: a cool white, readable on grass, water and tarmac. */
export const WIND_COLOR = "#e6f6ff";
/** Height of the band: on the ground, under the path lines (which sit at 0.2). */
const WIND_ALTITUDE = 0.12;
/** The back wisp layer floats a hair above the front one. */
const LAYER_LIFT = 0.02;

/** How fast the two wisp layers stream (world units / second). */
export const WIND_SCROLL_SPEED = 18;
export const WIND_SCROLL_SPEED_2 = 11;

/** Opacity of the band by phase; the forming outline pulses ± `FORMING_PULSE`. */
const FORMING_ALPHA = 0.55;
const FORMING_PULSE = 0.15;
/** Pulse rate of a forming band (rad/s). */
const FORMING_PULSE_RATE = 3.2;
const ACTIVE_ALPHA = 1;
/** The back wisp layer is this much fainter than the front one. */
const BACK_LAYER_SHARE = 0.6;

/**
 * How much of the strip, from each edge inwards, fades out (0-1 of the
 * half length / half width): the soft edge of the stream.
 */
const FEATHER_ALONG = 0.4;
const FEATHER_ACROSS = 0.4;

/** The wisp tile covers this many world units along the wind (2:1 canvas). */
const TILE_LENGTH = WIND_WIDTH * 2;
const TILE_W = 512;
const TILE_H = 256;
/** Wisps per tile, their length (px), thickness (px) and sideways wobble (px). */
const WISPS = 7;
const WISP_LENGTH: [number, number] = [180, 380];
const WISP_THICKNESS: [number, number] = [8, 18];
const WISP_WOBBLE = 18;

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * One seamless tile of streaks. Each wisp is a slim curve, faint at the
 * tail and bright at the head (the wind blows towards +x), drawn again one
 * tile either side so whatever leaves the edge re-enters on the other.
 * `base` adds a soft glow down the middle to hold the band together.
 */
function makeWisps(scene: Scene, name: string, seed: number, base: boolean): DynamicTexture {
  const tex = new DynamicTexture(name, { width: TILE_W, height: TILE_H }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, TILE_W, TILE_H);
  if (base) {
    const glow = ctx.createLinearGradient(0, 0, 0, TILE_H);
    glow.addColorStop(0, "rgba(255,255,255,0)");
    glow.addColorStop(0.5, "rgba(255,255,255,0.3)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, TILE_W, TILE_H);
  }
  const rng = mulberry32(seed);
  const range = ([lo, hi]: [number, number]) => lo + (hi - lo) * rng();
  ctx.lineCap = "round";
  for (let i = 0; i < WISPS; i++) {
    // Spread evenly down the band with a little jitter, so none stack up.
    const y = ((i + 0.3 + 0.4 * rng()) / WISPS) * TILE_H;
    const x = rng() * TILE_W;
    const len = range(WISP_LENGTH);
    const wobble = (rng() - 0.5) * 2 * WISP_WOBBLE;
    const alpha = 0.6 + 0.4 * rng();
    ctx.lineWidth = range(WISP_THICKNESS);
    for (const dx of [-TILE_W, 0, TILE_W]) {
      const x0 = x + dx;
      const fade = ctx.createLinearGradient(x0, 0, x0 + len, 0);
      fade.addColorStop(0, "rgba(255,255,255,0)");
      fade.addColorStop(0.7, `rgba(255,255,255,${alpha * 0.8})`);
      fade.addColorStop(1, `rgba(255,255,255,${alpha})`);
      ctx.strokeStyle = fade;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.bezierCurveTo(x0 + len * 0.3, y + wobble, x0 + len * 0.7, y - wobble, x0 + len, y);
      ctx.stroke();
    }
  }
  tex.update();
  tex.hasAlpha = true;
  // A dynamic texture clamps by default; the tile has to repeat along the band.
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.uScale = WIND_LENGTH / TILE_LENGTH;
  return tex;
}

/**
 * The forming warning, one canvas over the whole strip: a glowing dashed
 * rounded outline, a faint fill and a soft arrow along the wind.
 */
function makeOutline(scene: Scene): DynamicTexture {
  const w = 512;
  const h = Math.round((w * WIND_WIDTH) / WIND_LENGTH);
  const tex = new DynamicTexture("windForming", { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  const inset = 7;
  const radius = h * 0.42;
  const outline = () => {
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - 2 * inset, h - 2 * inset, radius);
  };
  outline();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  // The glow: the dashed stroke drawn with a blur, then again crisp on top.
  ctx.setLineDash([26, 16]);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = 10;
  ctx.lineWidth = 5;
  outline();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  // The arrow: a shaft with an open head, pointing +x (the wind).
  const cy = h / 2;
  const x0 = w * 0.3;
  const x1 = w * 0.7;
  const head = h * 0.2;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 9;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.moveTo(x1 - head, cy - head);
  ctx.lineTo(x1, cy);
  ctx.lineTo(x1 - head, cy + head);
  ctx.stroke();
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function makeMaterial(scene: Scene, name: string, texture: DynamicTexture): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = texture;
  mat.useAlphaFromDiffuseTexture = true;
  // Unlit: with lighting off only the emissive colour shows, multiplied by
  // the texture and the vertex alpha.
  mat.diffuseColor = Color3.Black();
  mat.emissiveColor = Color3.FromHexString(WIND_COLOR);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  return mat;
}

/**
 * A ground strip whose vertex alpha falls to 0 at its edges (`FEATHER_*`),
 * so whatever is painted on it dissolves into the ground.
 */
function featheredStrip(scene: Scene, name: string, length: number, width: number): Mesh {
  const strip = CreateGround(
    name,
    { width: length, height: width, subdivisionsX: 24, subdivisionsY: 8 },
    scene,
  );
  const positions = strip.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((positions.length / 3) * 4);
  for (let i = 0; i < positions.length / 3; i++) {
    const along = Math.abs(positions[i * 3]! / (length / 2));
    const across = Math.abs(positions[i * 3 + 2]! / (width / 2));
    const a = smoothstep((1 - along) / FEATHER_ALONG) * smoothstep((1 - across) / FEATHER_ACROSS);
    colors.set([1, 1, 1, a], i * 4);
  }
  strip.setVerticesData(VertexBuffer.ColorKind, colors);
  strip.hasVertexAlpha = true;
  return strip;
}

interface Band {
  /** Front layer: wisps over the soft glow (while forming, the outline instead). */
  front: Mesh;
  /** Back layer: fainter wisps, slower. */
  back: Mesh;
}

/** The wind bands in a scene, kept in step with `GameState.streams`. */
export class WindStreamsView {
  private readonly bands = new Map<number, Band>();
  private readonly forming: DynamicTexture;
  private readonly frontTex: DynamicTexture;
  private readonly backTex: DynamicTexture;
  private readonly formingMat: StandardMaterial;
  private readonly frontMat: StandardMaterial;
  private readonly backMat: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.forming = makeOutline(scene);
    this.frontTex = makeWisps(scene, "windFront", 7, true);
    this.backTex = makeWisps(scene, "windBack", 23, false);
    this.formingMat = makeMaterial(scene, "windForming", this.forming);
    this.frontMat = makeMaterial(scene, "windFront", this.frontTex);
    this.backMat = makeMaterial(scene, "windBack", this.backTex);
  }

  private createBand(stream: WindStream, world: WorldSize): Band {
    const { rect, id } = stream;
    const make = (name: string, lift: number) => {
      const mesh = featheredStrip(this.scene, `${name}-${id}`, rect.length, rect.width);
      mesh.isPickable = false;
      mesh.renderingGroupId = OVERLAY_GROUP;
      mesh.receiveShadows = false;
      toScene(rect.center, world, WIND_ALTITUDE + lift, mesh.position);
      mesh.rotation.y = headingToRotationY(rect.heading);
      return mesh;
    };
    return { front: make("wind", 0), back: make("windBack", LAYER_LIFT) };
  }

  /**
   * Bring the bands up to date: create, pose and fade each stream, and
   * remove the ones that are gone. `time` is the animation clock (frozen
   * while paused, so the wisps stop too).
   */
  sync(streams: readonly WindStream[], world: WorldSize, time: number): void {
    // Flow along the wind: the textures move towards +x, the meshes' own axis.
    this.frontTex.uOffset = -(time * WIND_SCROLL_SPEED) / TILE_LENGTH;
    this.backTex.uOffset = -(time * WIND_SCROLL_SPEED_2) / TILE_LENGTH + 0.37;

    const alive = new Set<number>();
    for (const stream of streams) {
      alive.add(stream.id);
      let band = this.bands.get(stream.id);
      if (!band) {
        band = this.createBand(stream, world);
        this.bands.set(stream.id, band);
      }
      const { front, back } = band;
      const phase = windPhase(stream);
      if (phase === "forecast") {
        // Only the HUD knows about it yet (ui/weatherAlerts.ts).
        front.isVisible = false;
        back.isVisible = false;
      } else if (phase === "forming") {
        // The outline spans the whole strip: no feathering, one layer.
        front.isVisible = true;
        front.material = this.formingMat;
        front.useVertexColors = false;
        front.visibility = FORMING_ALPHA + FORMING_PULSE * Math.sin(time * FORMING_PULSE_RATE);
        back.isVisible = false;
      } else {
        front.isVisible = true;
        front.material = this.frontMat;
        back.material = this.backMat;
        front.useVertexColors = true;
        back.isVisible = true;
        const k = windStrength(stream);
        front.visibility = ACTIVE_ALPHA * k;
        back.visibility = ACTIVE_ALPHA * BACK_LAYER_SHARE * k;
      }
    }
    for (const [id, band] of this.bands) {
      if (alive.has(id)) continue;
      band.front.dispose(false, false);
      band.back.dispose(false, false);
      this.bands.delete(id);
    }
  }

  dispose(): void {
    for (const band of this.bands.values()) {
      band.front.dispose(false, false);
      band.back.dispose(false, false);
    }
    this.bands.clear();
    for (const mat of [this.formingMat, this.frontMat, this.backMat]) mat.dispose();
    for (const tex of [this.forming, this.frontTex, this.backTex]) tex.dispose();
  }
}
