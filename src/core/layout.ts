/**
 * World sizing and runway placement.
 *
 * The world is a fixed `WORLD_HEIGHT` × `WORLD_HEIGHT · WORLD_ASPECT`
 * units whatever the window size, so the map never changes on a resize.
 * The camera fits it to the window instead (see render/camera.ts). Runways
 * are placed at fractions of the world size.
 */
import {
  AIRSPACE_MARGIN,
  ALTITUDE_TRANSITION,
  CAMERA_FIT_PADDING,
  CROSSING_EXIT_U,
  CAMERA_TILT,
  FLIGHT_ALTITUDE,
  OUTER_FLIGHT_ALTITUDE,
  RUNWAY_LAYOUT,
  RUNWAY_LENGTH,
  RUNWAY_THRESHOLD_INSET,
  RUNWAY_WIDTH,
  VIEW_ASPECT_MAX,
  VIEW_ASPECT_MIN,
  VIEW_MARGIN,
  WORLD_ASPECT,
  WORLD_HEIGHT,
  YELLOW_RUNWAY_MIN_WIDTH,
  ZOOM_MIN,
} from "../config";
import { layoutAirfield } from "./airfield";
import { rectCorners } from "./geometry";
import { headingVector } from "./math";
import type { Bounds } from "./scenery";
import type { Runway, Vec2, WorldSize } from "./types";

/** World dimensions: fixed, independent of the window (see `WORLD_ASPECT`). */
export function computeWorldSize(): WorldSize {
  return { width: WORLD_HEIGHT * WORLD_ASPECT, height: WORLD_HEIGHT };
}

/**
 * Guard against a 0×0 canvas during startup (aspect would be NaN/Infinity):
 * fall back to the world's own shape.
 */
export function safeViewAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : WORLD_ASPECT;
}

/**
 * The view frame: the whole world grown by `VIEW_MARGIN` on every side. The
 * default camera view is fitted round it (see `viewHalfHeight`), so it is
 * what the player sees at zoom 1: the airspace in the middle, and the ring
 * of countryside round it where planes arrive and leave.
 *
 * The far/near margin is stretched by 1 / cos(tilt): the camera
 * foreshortens ground depth by cos(tilt), so on screen the gap round the
 * world looks the same on all four sides.
 */
export function viewFrameBounds(world: WorldSize): Bounds {
  const mx = VIEW_MARGIN;
  const my = VIEW_MARGIN / Math.cos(CAMERA_TILT);
  return { minX: -mx, minY: -my, maxX: world.width + mx, maxY: world.height + my };
}

/** Airspace per world size; `layoutRunways` is too heavy to redo per query. */
const airspaceCache = new Map<string, Bounds>();

/**
 * The airspace: the smallest rectangle round every airport's footprint
 * (runways, taxiways, aprons and hangars; see `Airfield.footprint`), grown
 * by `AIRSPACE_MARGIN` on every side (far/near stretched for the tilt, like
 * `viewFrameBounds`). It is the game area proper:
 *
 * - inside it the player routes planes, and flying planes can collide
 *   (see core/collision.ts);
 * - outside it planes cruise higher (see `cruiseAltitude`) and steer clear
 *   of each other on their own (see core/avoidance.ts), so the traffic
 *   coming and going round the field never needs the player's attention;
 * - new planes fly in across its edge (see core/spawner.ts), and a plane
 *   whose path ends past it, heading out, leaves the world.
 *
 * Players never see the edge; `DEBUG_SHOW_AIRSPACE` draws it for tuning.
 */
export function airspaceBounds(world: WorldSize): Bounds {
  const key = `${world.width}x${world.height}`;
  const cached = airspaceCache.get(key);
  if (cached) return cached;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const runway of layoutRunways(world)) {
    for (const p of rectCorners(runway.airfield.footprint)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const mx = AIRSPACE_MARGIN;
  const my = AIRSPACE_MARGIN / Math.cos(CAMERA_TILT);
  const bounds = { minX: minX - mx, minY: minY - my, maxX: maxX + mx, maxY: maxY + my };
  airspaceCache.set(key, bounds);
  return bounds;
}

/** Centre of the airspace: where planes that stray out of it head back to. */
export function airspaceCenter(world: WorldSize): Vec2 {
  const b = airspaceBounds(world);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Distance from `p` to the airspace rectangle (0 anywhere inside it). */
export function distanceOutsideAirspace(p: Vec2, world: WorldSize): number {
  const b = airspaceBounds(world);
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Half-height (scene units) of the orthographic view that fits the view
 * frame (see `viewFrameBounds`) at zoom 1 and the default heading. The
 * camera divides this by its zoom (render/camera.ts).
 *
 * - screen X: ground x maps one-to-one;
 * - screen Y: ground depth is foreshortened by cos(tilt). Altitude adds
 *   nothing: planes are drawn over their ground track (render/sceneSync.ts
 *   `placeOverTrack`), however high they fly.
 *
 * It only depends on the world, never on the current heading, so rotating
 * the view never changes the scale. (Turned away from the default heading,
 * the frame's corners can leave the screen; zooming out brings them back.)
 *
 * @param aspect  viewport width / height
 */
export function viewHalfHeight(world: WorldSize, aspect: number): number {
  const a = viewFrameBounds(world);
  const maxX = (a.maxX - a.minX) / 2;
  const maxY = ((a.maxY - a.minY) / 2) * Math.cos(CAMERA_TILT);
  return Math.max(maxY, maxX / safeViewAspect(aspect)) * CAMERA_FIT_PADDING;
}

/**
 * The patch of ground the default view shows (zoom 1, not rotated or
 * panned) in a window of the given `aspect`, in sim coordinates. Wider than
 * the view frame on one axis unless the window's shape matches it exactly.
 * Arriving planes start outside it, so they fly into view instead of
 * popping up.
 */
export function defaultViewBounds(world: WorldSize, aspect: number): Bounds {
  const safeAspect = safeViewAspect(aspect);
  const halfH = viewHalfHeight(world, safeAspect);
  const halfX = halfH * safeAspect;
  const halfY = halfH / Math.cos(CAMERA_TILT);
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { minX: cx - halfX, minY: cy - halfY, maxX: cx + halfX, maxY: cy + halfY };
}

/**
 * A camera framing that fits `points` (sim coordinates) on screen, with
 * `margin` world units spare round them, at the default heading: the view's
 * centre and its zoom (1 = the default view; see `viewHalfHeight`, whose
 * measure it shares: ground depth foreshortened by cos(tilt), padded by
 * `CAMERA_FIT_PADDING`). Not clamped to the camera's zoom range.
 */
export function frameView(
  points: readonly Vec2[],
  margin: number,
  world: WorldSize,
  aspect: number,
): { center: Vec2; zoom: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // Nothing to frame: the default view.
  if (minX > maxX) return { center: { x: world.width / 2, y: world.height / 2 }, zoom: 1 };
  const halfX = (maxX - minX) / 2 + margin;
  const halfY = ((maxY - minY) / 2 + margin) * Math.cos(CAMERA_TILT);
  const halfH = Math.max(halfY, halfX / safeViewAspect(aspect)) * CAMERA_FIT_PADDING;
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    zoom: viewHalfHeight(world, aspect) / halfH,
  };
}

/**
 * Largest ground half-diagonal of the default view over every window shape
 * in `VIEW_ASPECT_MIN`..`VIEW_ASPECT_MAX`: what the static scenery map and
 * shadow frustum are sized for, so neither changes on a resize.
 *
 * The view contains the view frame, so as the window narrows its ground width
 * stays put while its depth grows, and as it widens the reverse: the
 * diagonal is largest at one end of the range, never in the middle.
 */
export function maxViewRadius(world: WorldSize): number {
  const radius = (aspect: number) => {
    const v = defaultViewBounds(world, aspect);
    return Math.hypot(v.maxX - v.minX, v.maxY - v.minY) / 2;
  };
  return Math.max(radius(VIEW_ASPECT_MIN), radius(VIEW_ASPECT_MAX));
}

/**
 * How far (as a fraction of the field's half-size) the view may be panned
 * off the field's centre at `zoom`. Full range from zoom 1 in, shrinking
 * linearly to nothing at `ZOOM_MIN`, where the view is already wide enough.
 * This keeps the zoomed-out view centred, so the scenery map (see
 * core/scenery.ts `mapBounds`) needn't stretch to cover a far-panned one.
 */
export function panFraction(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - ZOOM_MIN) / (1 - ZOOM_MIN)));
}

/**
 * Height a plane cruises at over `p` (3D scene units, purely visual):
 * `FLIGHT_ALTITUDE` inside the airspace, rising smoothly to
 * `OUTER_FLIGHT_ALTITUDE` over the first `ALTITUDE_TRANSITION` units past
 * its edge. Arrivals descend as they fly in; departures climb as they leave.
 * Continuous everywhere, so a plane never jumps as it crosses the edge.
 */
export function cruiseAltitude(p: Vec2, world: WorldSize): number {
  const t = Math.min(1, distanceOutsideAirspace(p, world) / ALTITUDE_TRANSITION);
  // Smoothstep: level off at both ends rather than kinking into the climb.
  const s = t * t * (3 - 2 * t);
  return FLIGHT_ALTITUDE + (OUTER_FLIGHT_ALTITUDE - FLIGHT_ALTITUDE) * s;
}

/** True if `p` is inside the view frame (edge included, see `viewFrameBounds`). */
export function isInViewFrame(p: Vec2, world: WorldSize): boolean {
  const b = viewFrameBounds(world);
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** True if `p` is inside the airspace (edge included). */
export function isInAirspace(p: Vec2, world: WorldSize): boolean {
  const b = airspaceBounds(world);
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/**
 * Build the runway list (each with its taxiway and hangars) for a world size.
 *
 * Runways sharing a centre cross there (blue and yellow's X, see
 * `RUNWAY_LAYOUT`). Their turnoffs move past the intersection, so no taxi
 * route cuts across the other strip; rollouts still roll through it.
 */
export function layoutRunways(world: WorldSize): Runway[] {
  let nextStandId = 0;
  // Narrow (portrait) worlds only get two runways, like the prototype, and
  // may move them (`narrow`) to use the extra height. The world is fixed at
  // `WORLD_ASPECT` now, so this only kicks in if that is set below ~4:3.
  const narrow = world.width < YELLOW_RUNWAY_MIN_WIDTH;
  const specs = RUNWAY_LAYOUT.filter((spec) => !narrow || spec.color !== "yellow").map((spec) =>
    narrow && spec.narrow ? { ...spec, ...spec.narrow } : spec,
  );
  return specs.map((spec) => {
    const center = { x: world.width * spec.fx, y: world.height * spec.fy };
    const dir = headingVector(spec.heading);
    // The threshold sits near the runway end the plane arrives at, i.e.
    // *behind* the centre relative to the landing heading.
    const back = RUNWAY_LENGTH / 2 - RUNWAY_THRESHOLD_INSET;
    const crossing = specs.some(
      (other) => other !== spec && other.fx === spec.fx && other.fy === spec.fy,
    );
    const airfield = layoutAirfield(
      spec.color,
      center,
      spec.heading,
      spec.apronSide,
      nextStandId,
      crossing ? CROSSING_EXIT_U : undefined,
    );
    nextStandId += airfield.stands.length;
    return {
      color: spec.color,
      center,
      heading: spec.heading,
      length: RUNWAY_LENGTH,
      width: RUNWAY_WIDTH,
      threshold: { x: center.x - dir.x * back, y: center.y - dir.y * back },
      airfield,
    };
  });
}

/**
 * Painted runway number, as on a real airfield: the landing direction's
 * compass bearing in tens of degrees, 01–36 (north is 36, never 00).
 *
 * "North" is up the screen at the default camera, i.e. sim -y. A heading
 * of 0 (+x, east) is bearing 090 → "09".
 */
export function runwayDesignator(heading: number): string {
  const dir = headingVector(heading);
  // atan2(east, north) gives a clockwise-from-north bearing.
  const bearing = ((Math.atan2(dir.x, -dir.y) * 180) / Math.PI + 360) % 360;
  const tens = Math.round(bearing / 10) % 36 || 36;
  return String(tens).padStart(2, "0");
}
