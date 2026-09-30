/**
 * Player-drawn flight paths.
 */
import {
  ANCHOR_HEADING_MARGIN,
  ANCHOR_LANDING_MARGIN,
  ANCHOR_RADIUS,
  FLIGHT_SUBSTEP,
  LANDING_ANGLE_TOLERANCE,
  LANDING_RADIUS,
  PATH_MIN_SPACING,
  PLANE_SPEED,
} from "../config";
import { isRunwayClosed } from "./departures";
import { angleDelta, clamp, distance, headingVector } from "./math";
import { updatePlane } from "./plane";
import { mapBounds } from "./scenery";
import type { Plane, Runway, Vec2, WorldSize } from "./types";

/**
 * True if the player can steer `plane`: flying, or departing. A departing
 * plane (its path ran out past the airspace edge, heading out; see
 * core/plane.ts) is still on the map and still the player's to call back,
 * so paths can be drawn for planes anywhere on the map.
 */
export function isSteerable(plane: Plane): boolean {
  return plane.phase === "flying" || plane.phase === "departing";
}

/**
 * Begin drawing a new path for `plane`, discarding the old one. A departing
 * plane is called back into play.
 */
export function startPath(plane: Plane): void {
  if (plane.phase === "departing") plane.phase = "flying";
  plane.path = [];
  plane.pathAnchored = false;
  plane.pathVersion++;
}

/**
 * Append `point` to the plane's path if it is at least `minSpacing` away from
 * the previous point (or from the plane itself, for the first point).
 * Dropping near-duplicate points keeps the path array — and the rendered
 * line — small while the pointer jitters.
 *
 * @returns true if the point was added.
 */
export function appendPathPoint(
  plane: Plane,
  point: Vec2,
  minSpacing: number = PATH_MIN_SPACING,
): boolean {
  // An anchored path is finished: extra wiggles past the runway are ignored.
  if (plane.pathAnchored) return false;
  const last = plane.path[plane.path.length - 1] ?? plane.pos;
  if (distance(last, point) < minSpacing) return false;
  // The plane can catch up with the pointer mid-drag and, past the edge,
  // start departing (see `isSteerable`). The drag is still steering it, so
  // the new point brings it back into play.
  if (plane.phase === "departing") plane.phase = "flying";
  plane.path.push({ x: point.x, y: point.y });
  plane.pathVersion++;
  return true;
}

/**
 * Keep a drawn path point on the map (see `mapBounds`). Paths may run
 * anywhere the player can see, past the airspace edge included: out there
 * planes can't collide (see core/collision.ts), and the automatic avoidance
 * (core/avoidance.ts) keeps apart the planes that have no path, so the
 * countryside round the field is a safe holding area rather than a wall.
 * A plane on a drawn path is never steered by it: it flies the path as
 * drawn, crossing other traffic if the path says so. Only the map's own edge is a
 * limit, so a path never leads a plane off the scenery. A plane whose path
 * ends past the airspace edge, heading out, leaves the world (see
 * `departing` in core/plane.ts).
 */
export function clampPathPoint(point: Vec2, world: WorldSize): Vec2 {
  const b = mapBounds(world);
  return { x: clamp(point.x, b.minX, b.maxX), y: clamp(point.y, b.minY, b.maxY) };
}

/**
 * Snap the end of the plane's path onto its runway threshold, if the path
 * has just reached the anchor area from the landing direction.
 *
 * Call after each new path point. On success the path's tail inside the
 * anchor area is replaced by one point exactly on the threshold, so the
 * plane flies a straight final approach and `checkLanding` is guaranteed to
 * fire as it arrives. `plane.pathAnchored` is set, which locks the path.
 *
 * The approach is judged twice: first on the final leg (last point outside
 * the area → threshold), a cheap check that rejects paths reaching the
 * threshold from the wrong end or side-on; then by a dry-run flight (see
 * `landsOnSnappedPath`), since the plane's limited turn rate can make it
 * miss a leg that looks fine on paper. Either way a rejected path simply
 * doesn't anchor: the player can keep dragging and come round again.
 *
 * A runway a departure has closed (see `isRunwayClosed`; pass the traffic
 * as `planes`) never anchors either: landing there is forbidden for now.
 * The path stays as drawn, and letting go on the runway shows the red X
 * (see `rejectedLanding`).
 *
 * @returns the runway anchored to, or null.
 */
export function anchorPath(
  plane: Plane,
  runways: readonly Runway[],
  world: WorldSize,
  planes: readonly Plane[] = [],
): Runway | null {
  if (plane.pathAnchored || plane.path.length === 0) return null;
  const runway = runways.find((r) => r.color === plane.color);
  if (!runway) return null;
  if (isRunwayClosed(runway, planes)) return null;

  const end = plane.path[plane.path.length - 1]!;
  if (distance(end, runway.threshold) > ANCHOR_RADIUS) return null;

  // Last point of the approach that is still outside the anchor area (or
  // the plane itself if the whole path is inside it).
  let keep = plane.path.length;
  while (keep > 0 && distance(plane.path[keep - 1]!, runway.threshold) <= ANCHOR_RADIUS) keep--;
  const from = keep > 0 ? plane.path[keep - 1]! : plane.pos;

  const approach = Math.atan2(runway.threshold.y - from.y, runway.threshold.x - from.x);
  if (Math.abs(angleDelta(approach, runway.heading)) > LANDING_ANGLE_TOLERANCE) return null;

  const snapped = [...plane.path.slice(0, keep), { ...runway.threshold }];
  // A good-looking final leg can still be unflyable, e.g. a sharp corner at
  // the edge of the anchor area: the plane can't turn that tightly, cuts
  // the corner and arrives off-heading or wide. Only anchor (and show the
  // green ring) if the plane really lands.
  if (!landsOnSnappedPath(plane, snapped, runway, world)) return null;

  plane.path = snapped;
  plane.pathAnchored = true;
  plane.pathVersion++;
  return runway;
}

/**
 * The path the player just let go of ends on a runway but didn't anchor:
 * the landing it aims for won't happen. Then the renderer shows a red X
 * where it ends, instead of the green ring (see `onLandingRejected` in
 * input/pointer.ts).
 *
 * "On a runway" is any runway's strip, or within `ANCHOR_RADIUS` of any
 * threshold (the area where a good path would have anchored). Every reason
 * it didn't anchor counts: the wrong end or side-on, a turn too tight to
 * fly, another colour's runway, or a runway a departure has closed. A path
 * ending anywhere else is just a route, and gets no X.
 *
 * @param runways the runways the player can see: in the game only the open
 *                ones (core/progression.ts `openRunways`), since a runway
 *                not yet unlocked isn't drawn and mustn't reject a path.
 * @returns the path's end point, where the X goes; null if the path
 *          anchored, is empty, or doesn't end on a runway.
 */
export function rejectedLanding(plane: Plane, runways: readonly Runway[]): Vec2 | null {
  if (plane.pathAnchored) return null;
  const end = plane.path[plane.path.length - 1];
  if (!end) return null;
  const onRunway = runways.some(
    (r) => distance(end, r.threshold) <= ANCHOR_RADIUS || isOnStrip(end, r),
  );
  return onRunway ? { ...end } : null;
}

/** True if `p` lies on `runway`'s strip (its length × width rectangle). */
function isOnStrip(p: Vec2, runway: Runway): boolean {
  const d = headingVector(runway.heading);
  const dx = p.x - runway.center.x;
  const dy = p.y - runway.center.y;
  const along = dx * d.x + dy * d.y;
  const across = -dx * d.y + dy * d.x;
  return Math.abs(along) <= runway.length / 2 && Math.abs(across) <= runway.width / 2;
}

/**
 * Dry run: fly a copy of `plane` along `path` and report whether it lands
 * on `runway`.
 *
 * This is a faithful preview of the real flight: the sim is deterministic,
 * flight is integrated in small sub-steps whatever the frame rate, and an
 * anchored path is locked, so nothing else changes the plane's route on the
 * way. (Traffic can still force a go-around or a crash; that isn't judged
 * here.)
 */
function landsOnSnappedPath(
  plane: Plane,
  path: readonly Vec2[],
  runway: Runway,
  world: WorldSize,
): boolean {
  const ghost: Plane = {
    ...plane,
    pos: { ...plane.pos },
    path: path.map((p) => ({ ...p })),
    pathAnchored: true,
    ground: null,
    // A fresh avoidance turn is only worked out by `step`; fly the path as drawn.
    avoidTurn: 0,
  };

  // Time budget: the whole path at cruise speed, doubled for turns.
  let length = 0;
  let prev = plane.pos;
  for (const p of path) {
    length += distance(prev, p);
    prev = p;
  }
  const maxSteps = Math.ceil(((2 * length) / PLANE_SPEED + 1) / FLIGHT_SUBSTEP);

  for (let i = 0; i < maxSteps; i++) {
    updatePlane(ghost, FLIGHT_SUBSTEP, world);
    // Same test as `checkLanding`, with a safety margin: the real flight can
    // differ slightly (landing is checked once per frame, and sub-steps
    // shrink on fast displays), so a borderline pass isn't a promise.
    const over = distance(ghost.pos, runway.threshold) <= LANDING_RADIUS - ANCHOR_LANDING_MARGIN;
    const aligned =
      Math.abs(angleDelta(ghost.heading, runway.heading)) <=
      LANDING_ANGLE_TOLERANCE - ANCHOR_HEADING_MARGIN;
    if (over && aligned) return true;
    // Threshold dropped (reached off-heading, or skipped as unreachable) and
    // the plane has flown clear of it: it would not land.
    if (!ghost.pathAnchored && distance(ghost.pos, runway.threshold) > LANDING_RADIUS) {
      return false;
    }
  }
  return false;
}
