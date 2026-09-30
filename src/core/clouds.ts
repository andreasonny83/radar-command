/**
 * Clouds: a visual difficulty layer that arrives at game hour 30.
 *
 * Drifting clouds pass over the map and dim whatever is underneath (planes,
 * paths, runways), so the player has to keep track of traffic they can
 * hardly see. They change nothing in the sim: planes, collisions and
 * landings ignore them, and a path can still be drawn through one.
 *
 * Two layers. The main one is cloud *formations*: a bank (one big cumulus
 * with smaller ones crowding it), a street (a line of small cumuli strung
 * along the wind) or a lone cumulus; each is painted as one picture by the
 * render layer (render/cloudTextures.ts) and drifts as one. Above them a
 * faster high layer of cirrus wisps only adds atmosphere and depth.
 *
 * Nothing is stored. Every cloud's place is a pure function of
 * `state.elapsed`, like the clock (core/daytime.ts) and the wind level
 * (core/windStreams.ts): it stands still while the sim does, starts over
 * with each shift and needs no field in `GameState`. The render layer
 * (render/clouds.ts) draws whatever `cloudsAt` returns.
 */
import {
  CLOUD_CIRRUS,
  CLOUD_CIRRUS_LENGTH_MAX,
  CLOUD_CIRRUS_LENGTH_MIN,
  CLOUD_CIRRUS_SPEED_FACTOR,
  CLOUD_FORMATIONS,
  CLOUD_FULL_HOURS,
  CLOUD_HEADING,
  CLOUD_SIZE_MAX,
  CLOUD_SIZE_MIN,
  CLOUD_SPEED,
  CLOUD_SPEED_SPREAD,
  CLOUD_START_HOURS,
} from "../config";
import { DAY_SECONDS } from "./daytime";
import { clamp, lerp, mulberry32 } from "./math";
import type { Vec2, WorldSize } from "./types";

/** Seconds of play per game hour. */
const HOUR_SECONDS = DAY_SECONDS / 24;

/** How a formation is laid out (render/cloudTextures.ts paints each). */
export type CloudShape = "bank" | "street" | "lone";

/**
 * The formation pictures, by `Cloud.variant` on the main layer: a few banks
 * (the commonest look), streets and a lone cumulus.
 */
export const CLOUD_SHAPES: readonly CloudShape[] = [
  "bank",
  "bank",
  "bank",
  "street",
  "street",
  "lone",
];

/** Different cirrus wisps, by `Cloud.variant` on the high layer. */
export const CIRRUS_VARIANTS = 2;

/** Width / length of a formation's picture, and of a cirrus wisp's. */
export const FORMATION_ASPECT = 2 / 3;
export const CIRRUS_ASPECT = 1 / 4;

/** Length of a formation by shape, relative to the random size drawn for it. */
const SHAPE_SIZE: Record<CloudShape, number> = { bank: 1, street: 1.2, lone: 0.75 };

/**
 * Extra room (world units) the clouds' wrap-around area has beyond the
 * playfield: room for a whole formation to drift out of sight, and for the
 * camera's tilt, which shifts a cloud at height against the ground.
 */
const WRAP_MARGIN = 60;

/**
 * A cloud fades out over this distance (world units) before the edge of the
 * wrap-around area, so it never pops in or out where the player can see.
 */
const EDGE_FADE = 30;

/** Seed of the cloud layout: the same sky every shift. */
const CLOUD_SEED = 30;

export type CloudLayer = "main" | "high";

/** One cloud to draw now. */
export interface Cloud {
  /** Which layer: formations that hide things, or the high cirrus. */
  layer: CloudLayer;
  /** Which picture (an index into `CLOUD_SHAPES` on the main layer). */
  variant: number;
  /** Centre, in sim coordinates. */
  center: Vec2;
  /** Size (world units): along the drift and across it. */
  length: number;
  width: number;
  /** Turn of the cloud's picture (radians), near the drift heading. */
  rotation: number;
  /** 0 not out yet … 1 fully there: clouds fade in one by one as cover grows. */
  strength: number;
}

/**
 * How much of the sky is clouded after `elapsed` seconds, 0 to 1: nothing
 * before `CLOUD_START_HOURS`, then growing evenly until `CLOUD_FULL_HOURS`
 * later.
 */
export function cloudCover(elapsed: number): number {
  const hours = elapsed / HOUR_SECONDS - CLOUD_START_HOURS;
  return clamp(hours / CLOUD_FULL_HOURS, 0, 1);
}

/**
 * The clouds after `elapsed` seconds: `CLOUD_FORMATIONS` formations, then
 * `CLOUD_CIRRUS` wisps (always all of them; the ones not out yet have
 * strength 0). They drift along `CLOUD_HEADING` at their own speeds and wrap
 * round the playfield plus a margin: one that leaves on one side comes back
 * in on the other, fading out and in at the edges.
 */
export function cloudsAt(elapsed: number, world: WorldSize): Cloud[] {
  const cover = cloudCover(elapsed);
  const halfX = world.width / 2 + WRAP_MARGIN;
  const halfY = world.height / 2 + WRAP_MARGIN;
  const rng = mulberry32(CLOUD_SEED);
  const dirX = Math.cos(CLOUD_HEADING);
  const dirY = Math.sin(CLOUD_HEADING);
  /** `v` wrapped into [-half, half). */
  const wrap = (v: number, half: number) =>
    ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half;

  /** The `i`-th of `count` clouds on a layer, drifting at `speed`. */
  const place = (
    layer: CloudLayer,
    i: number,
    count: number,
    variant: number,
    length: number,
    aspect: number,
    speed: number,
    tilt: number,
  ): Cloud => {
    const x = wrap(lerp(-halfX, halfX, rng()) + dirX * speed * elapsed, halfX);
    const y = wrap(lerp(-halfY, halfY, rng()) + dirY * speed * elapsed, halfY);
    const edge = Math.min(halfX - Math.abs(x), halfY - Math.abs(y));
    // Cloud i comes out when the cover passes i / count, fully one slot
    // later; near the edge of the wrap-around area it fades away.
    const strength = clamp(cover * count - i, 0, 1) * clamp(edge / EDGE_FADE, 0, 1);
    return {
      layer,
      variant,
      center: { x: world.width / 2 + x, y: world.height / 2 + y },
      length,
      width: length * aspect,
      rotation: CLOUD_HEADING + (rng() - 0.5) * tilt,
      strength,
    };
  };
  const speedOf = (factor: number) =>
    CLOUD_SPEED * factor * lerp(1 - CLOUD_SPEED_SPREAD, 1 + CLOUD_SPEED_SPREAD, rng());

  const clouds: Cloud[] = [];
  for (let i = 0; i < CLOUD_FORMATIONS; i++) {
    const variant = Math.floor(rng() * CLOUD_SHAPES.length);
    const length = lerp(CLOUD_SIZE_MIN, CLOUD_SIZE_MAX, rng()) * SHAPE_SIZE[CLOUD_SHAPES[variant]!];
    clouds.push(
      place("main", i, CLOUD_FORMATIONS, variant, length, FORMATION_ASPECT, speedOf(1), 0.2),
    );
  }
  for (let i = 0; i < CLOUD_CIRRUS; i++) {
    const variant = Math.floor(rng() * CIRRUS_VARIANTS);
    const length = lerp(CLOUD_CIRRUS_LENGTH_MIN, CLOUD_CIRRUS_LENGTH_MAX, rng());
    const speed = speedOf(CLOUD_CIRRUS_SPEED_FACTOR);
    clouds.push(place("high", i, CLOUD_CIRRUS, variant, length, CIRRUS_ASPECT, speed, 0.3));
  }
  return clouds;
}
