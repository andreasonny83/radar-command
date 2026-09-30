/**
 * Plane spawning and the difficulty curve.
 */
import {
  ARRIVAL_WARNING,
  PLANE_RADIUS,
  PLANE_SPEED,
  SPAWN_HEADING_JITTER,
  WARNING_DISTANCE,
} from "../config";
import { airspaceBounds, defaultViewBounds } from "./layout";
import { distance, headingVector } from "./math";
import { createPlane } from "./plane";
import { trafficColors } from "./progression";
import type { Bounds } from "./scenery";
import type {
  GameState,
  OrientedRect,
  Plane,
  Rng,
  Runway,
  RunwayColor,
  Vec2,
  WorldSize,
} from "./types";

export interface SpawnSpec {
  color: RunwayColor;
  /** Start point, off-screen (see `pickSpawn`). */
  pos: Vec2;
  heading: number;
  /** Where the straight track crosses into the airspace. */
  entry: Vec2;
  /** Distance from `pos` to `entry` (world units). */
  runIn: number;
}

/**
 * How far past the view's edge (see `pickSpawn`) a plane must start to be fully out
 * of sight: its own size. Altitude doesn't lift it up the screen, since
 * planes are drawn over their ground track (render/sceneSync.ts
 * `placeOverTrack`).
 */
const OFFSCREEN_MARGIN = PLANE_RADIUS * 2;

/**
 * Entry points keep this fraction of each airspace side clear at both
 * ends, so arrivals cross the edge along its middle rather than clipping a
 * corner where they'd be back out again almost at once.
 */
const ENTRY_CORNER_INSET = 0.12;

/**
 * Pick a random colour, airspace edge (see `edgeWeights`) and inward track
 * for a new plane. `viewAspect` is the window's width / height: the world
 * is fixed, but how much ground shows round it depends on the window.
 *
 * The track crosses the airspace edge at `entry`, somewhere along that
 * side (clear of the corners), heading roughly inward. The plane starts
 * back along that track, off-screen: `ARRIVAL_WARNING` seconds of flight
 * beyond the point where it comes into sight. So it flies in from the
 * screen edge rather than appearing out of nowhere, and its arrow shows for
 * the same time whichever side it comes from. It then crosses the
 * countryside round the airspace high up (see `cruiseAltitude`),
 * descending as it nears the edge.
 *
 * "Off-screen" means outside the default view and, when given, `liveView`:
 * the ground the camera shows right now (`GameState.liveView`). Zoomed
 * out, rotated or panned, that reaches past the default view, and a plane
 * started only beyond the default view would pop up in plain sight. The
 * cost: zoomed out, arrivals fly in from further away, so they take longer.
 *
 * `aimAt`, when given, replaces the random inward heading: the track runs
 * from the entry point straight for the centre of the plane's own runway
 * among them (if it has one). A shift's opening plane uses it (see
 * `spawnPlane`): the camera opens zoomed in over the first airport (see
 * main.ts `frameOpenAirports`), and a random heading could carry the plane
 * across the airspace without ever crossing that view, so the player would
 * see neither the plane nor, once it's in the airspace, its arrow.
 */
export function pickSpawn(
  world: WorldSize,
  viewAspect: number,
  colors: readonly RunwayColor[],
  rng: Rng,
  liveView: OrientedRect | null = null,
  aimAt: readonly Runway[] | null = null,
): SpawnSpec {
  const color = colors[Math.floor(rng() * colors.length)] ?? colors[0] ?? "red";
  const edge = pickEdge(edgeWeights(world, viewAspect), rng()); // 0 top, 1 right, 2 bottom, 3 left
  const along = ENTRY_CORNER_INSET + rng() * (1 - 2 * ENTRY_CORNER_INSET);
  const jitter = (rng() - 0.5) * 2 * SPAWN_HEADING_JITTER;
  const b = airspaceBounds(world);
  const x = b.minX + along * (b.maxX - b.minX);
  const y = b.minY + along * (b.maxY - b.minY);

  let entry: Vec2;
  let heading: number;
  switch (edge) {
    case 0:
      entry = { x, y: b.minY };
      heading = Math.PI / 2 + jitter;
      break;
    case 1:
      entry = { x: b.maxX, y };
      heading = Math.PI + jitter;
      break;
    case 2:
      entry = { x, y: b.maxY };
      heading = -Math.PI / 2 + jitter;
      break;
    default:
      entry = { x: b.minX, y };
      heading = jitter;
  }
  // Head straight for the plane's runway instead. The runway lies inside
  // the airspace, so this still points inward from any edge.
  const runway = aimAt?.find((r) => r.color === color);
  if (runway) {
    heading = Math.atan2(runway.center.y - entry.y, runway.center.x - entry.x);
  }

  const dir = headingVector(heading);
  const back = { x: -dir.x, y: -dir.y };
  const hidden = grow(defaultViewBounds(world, viewAspect), OFFSCREEN_MARGIN);
  // Both views are convex: past the later of the two exits, the track is
  // out of sight of both for good.
  const outOfSight = Math.max(
    exitDistance(entry, back, hidden),
    liveView ? rectExitDistance(entry, back, liveView, OFFSCREEN_MARGIN) : 0,
  );
  const runIn = outOfSight + ARRIVAL_WARNING * PLANE_SPEED;
  return {
    color,
    pos: { x: entry.x + back.x * runIn, y: entry.y + back.y * runIn },
    heading,
    entry,
    runIn,
  };
}

/**
 * How likely each edge (top, right, bottom, left) is to get the next plane:
 * its length divided by how long a plane takes to fly in from it.
 *
 * - Length: arrivals spread evenly round the airspace, so long sides get
 *   more.
 * - Time: the default view shows more ground beyond some edges than others
 *   (the tilt squashes depth, so above and below, most in tall windows).
 *   Planes from there spend longer flying in before the player can route
 *   them, so those edges get proportionally fewer.
 *
 * In a 16:9 window the two roughly cancel out (about even odds). Taller
 * windows send more planes from the sides; ultrawide ones a few more from
 * the long top and bottom.
 */
export function edgeWeights(
  world: WorldSize,
  viewAspect: number,
): [number, number, number, number] {
  const b = airspaceBounds(world);
  const v = defaultViewBounds(world, viewAspect);
  // Straight-in time: the off-screen run-in, then across the visible gap
  // between the view edge and the airspace.
  const time = (gap: number) => (gap + OFFSCREEN_MARGIN) / PLANE_SPEED + ARRIVAL_WARNING;
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  return [
    width / time(b.minY - v.minY),
    height / time(v.maxX - b.maxX),
    width / time(v.maxY - b.maxY),
    height / time(b.minX - v.minX),
  ];
}

/** Index into `weights`, chosen with probability proportional to its weight. */
function pickEdge(weights: readonly number[], r: number): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let t = r * total;
  for (let i = 0; i < weights.length - 1; i++) {
    t -= weights[i]!;
    if (t < 0) return i;
  }
  return weights.length - 1;
}

function grow(b: Bounds, by: number): Bounds {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

/**
 * Distance from `p` along unit vector `d` to where the ray leaves `r` grown
 * by `margin` for good, or 0 if it never passes through it. Unlike
 * `exitDistance`, `p` may start outside (a zoomed-in view can miss the
 * entry point, yet the track behind it can still cross the screen). Slab
 * test in the rectangle's own frame: `u` along its heading, `v` across.
 */
function rectExitDistance(p: Vec2, d: Vec2, r: OrientedRect, margin: number): number {
  const axis = headingVector(r.heading);
  const ox = p.x - r.center.x;
  const oy = p.y - r.center.y;
  let tIn = 0;
  let tOut = Infinity;
  for (const [o, dd, half] of [
    [ox * axis.x + oy * axis.y, d.x * axis.x + d.y * axis.y, r.length / 2 + margin],
    [-ox * axis.y + oy * axis.x, -d.x * axis.y + d.y * axis.x, r.width / 2 + margin],
  ] as const) {
    if (dd === 0) {
      if (Math.abs(o) > half) return 0; // parallel, outside this slab
      continue;
    }
    const t1 = (-half - o) / dd;
    const t2 = (half - o) / dd;
    tIn = Math.max(tIn, Math.min(t1, t2));
    tOut = Math.min(tOut, Math.max(t1, t2));
  }
  return tIn > tOut ? 0 : tOut;
}

/**
 * Distance from `p` (inside `b`) along unit vector `d` to the edge of `b`:
 * the nearest of the two walls the ray heads for. 0 if `p` is outside.
 */
function exitDistance(p: Vec2, d: Vec2, b: Bounds): number {
  if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return 0;
  let t = Infinity;
  if (d.x > 0) t = Math.min(t, (b.maxX - p.x) / d.x);
  if (d.x < 0) t = Math.min(t, (b.minX - p.x) / d.x);
  if (d.y > 0) t = Math.min(t, (b.maxY - p.y) / d.y);
  if (d.y < 0) t = Math.min(t, (b.minY - p.y) / d.y);
  return Number.isFinite(t) ? t : 0;
}

/** How many times to re-roll a spawn that would crowd another plane. */
const SPAWN_ATTEMPTS = 5;

/**
 * Add a new plane to `state`, only using colours whose runway exists, is
 * unlocked at the current landing count and has been open long enough to
 * take traffic (see `trafficColors`). The plane
 * starts `inbound`: off-screen, flying in towards `entry`. Re-rolls a few times to
 * keep new arrivals from bunching up with other planes.
 *
 * @param aimAtRunway  fly the plane in straight for its runway rather than
 *                     on a random inward heading (a shift's opening plane;
 *                     see `pickSpawn`).
 * @returns the new plane, or null if there are no runways.
 */
export function spawnPlane(state: GameState, rng: Rng, aimAtRunway = false): Plane | null {
  const colors = trafficColors(state);
  if (colors.length === 0) return null;

  const aimAt = aimAtRunway ? state.runways : null;
  const pick = () => pickSpawn(state.world, state.viewAspect, colors, rng, state.liveView, aimAt);
  let spec = pick();
  for (let i = 1; i < SPAWN_ATTEMPTS && isCrowded(spec, state.planes); i++) spec = pick();

  const plane = createPlane(state.nextPlaneId++, spec.color, spec.pos, spec.heading);
  plane.inbound = true;
  plane.entry = { ...spec.entry };
  state.planes.push(plane);
  return plane;
}

/**
 * True if the new plane would start near another flying plane, or pass
 * near another inbound one on the way in. Inbound planes can't collide (see
 * core/collision.ts), but two arriving on top of each other would be an
 * unfair crash the moment they cross into the airspace. Both fly straight
 * at the same speed until then, so their closest approach has a closed form.
 */
function isCrowded(spec: SpawnSpec, planes: readonly Plane[]): boolean {
  const dir = headingVector(spec.heading);
  const duration = spec.runIn / PLANE_SPEED;
  return planes.some((p) => {
    if (p.phase !== "flying") return false;
    if (distance(p.pos, spec.pos) < WARNING_DISTANCE) return true;
    if (!p.inbound) return false;
    // Relative position and velocity of the new plane w.r.t. `p`.
    const other = headingVector(p.heading);
    const rx = spec.pos.x - p.pos.x;
    const ry = spec.pos.y - p.pos.y;
    const vx = (dir.x - other.x) * PLANE_SPEED;
    const vy = (dir.y - other.y) * PLANE_SPEED;
    const vv = vx * vx + vy * vy;
    const t = vv > 0 ? Math.min(duration, Math.max(0, -(rx * vx + ry * vy) / vv)) : 0;
    return Math.hypot(rx + vx * t, ry + vy * t) < WARNING_DISTANCE;
  });
}

/**
 * Difficulty curve: decide the delay (seconds) before the NEXT spawn.
 * Called once right after each spawn.
 *
 * @param current  the interval that was just used (seconds)
 * @param landed   planes landed so far this shift
 * @param elapsed  seconds since the shift started
 * @returns        the next interval in seconds (clamp to SPAWN_INTERVAL_MIN!)
 *
 * The prototype shaved a fixed 50 ms off after every spawn, down to a 1 s
 * floor — a purely time-based ramp. Alternatives worth considering:
 *   - landing-based: reward skill, so a struggling player isn't buried;
 *   - stepped "waves": hold steady, then jump, giving breathing room;
 *   - exponential decay towards the floor: fast early ramp, gentle late game.
 *
 * TODO(you): implement the curve. Until then difficulty stays constant.
 */
export function nextSpawnInterval(current: number, landed: number, elapsed: number): number {
  void landed;
  void elapsed;
  return current;
}
