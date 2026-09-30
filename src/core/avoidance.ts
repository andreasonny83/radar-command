/**
 * Automatic collision avoidance outside the airspace.
 *
 * Only the airspace (see `airspaceBounds` in core/layout.ts) is the
 * player's job. Round it, arrivals fly in, departures fly out and planes
 * the player has routed wide cross paths all the time; they can't collide
 * there (see core/collision.ts), but models sliding through each other
 * would still draw the eye away from the field. So out there the game
 * separates them itself, like a TCAS on every aircraft: each plane looks a
 * few seconds ahead and, if other traffic would pass too close, turns away
 * from it. A plane the player has given a path is the exception: it flies
 * that path as drawn, and only planes without one (fresh arrivals, planes
 * whose path ran out, departures) are steered.
 *
 * The result is a heading offset, `Plane.avoidTurn`, that core/plane.ts
 * adds to wherever the plane was heading anyway (its path, its entry point
 * or straight on). It is recomputed from scratch every step, so once the
 * conflict clears the offset is gone and the plane swings back onto course.
 */
import { AVOID_LOOKAHEAD, AVOID_MAX_TURN, AVOID_SEPARATION, PLANE_SPEED } from "../config";
import { isInAirspace } from "./layout";
import { clamp, headingVector } from "./math";
import type { Plane, WorldSize } from "./types";

/** Flying, departing or climbing out: the planes that take part in avoidance at all. */
function isAirborne(plane: Plane): boolean {
  return plane.phase === "flying" || plane.phase === "departing" || plane.phase === "climbout";
}

/**
 * True if the player has routed `plane`: it is flying a path they drew. A
 * departure's dotted route (climbout) is the game's own, so it doesn't count.
 */
function isPlayerRouted(plane: Plane): boolean {
  return plane.phase === "flying" && plane.path.length > 0;
}

/**
 * True if the avoidance system may steer `plane`: airborne and outside the
 * airspace. Two kinds of plane are left alone:
 *
 * - Planes the player has given a path (see `isPlayerRouted`): they fly
 *   exactly what was drawn, and the automatic pilot takes over again only
 *   once the path is used up. Other traffic still swerves round them.
 * - Planes on an anchored approach: their final is committed (and was
 *   checked to land, see `anchorPath` in core/path.ts), so the other
 *   traffic gives way to them instead. This holds even after the path's
 *   last waypoint is used up.
 */
function isManaged(plane: Plane, world: WorldSize): boolean {
  return (
    isAirborne(plane) &&
    !plane.pathAnchored &&
    !isPlayerRouted(plane) &&
    !isInAirspace(plane.pos, world)
  );
}

/**
 * Set `avoidTurn` on every plane for this step: a turn away from the
 * traffic it is converging on for managed planes (see `isManaged`), 0 for
 * everyone else.
 *
 * Each managed plane checks every other airborne plane, inside the
 * airspace or out: a plane just outside the edge still keeps clear of one
 * just inside it. Both planes fly straight at `PLANE_SPEED` for the
 * prediction, which is plenty for a few seconds ahead. O(n²) over the
 * handful of planes in the air.
 */
export function resolveOuterTraffic(planes: readonly Plane[], world: WorldSize): void {
  for (const plane of planes) {
    plane.avoidTurn = 0;
    if (!isManaged(plane, world)) continue;
    let turn = 0;
    for (const other of planes) {
      if (other === plane || !isAirborne(other)) continue;
      turn += avoidanceTurn(plane, other);
    }
    plane.avoidTurn = clamp(turn, -AVOID_MAX_TURN, AVOID_MAX_TURN);
  }
}

/**
 * The turn (radians, positive = right) `plane` should add to keep clear of
 * `other`, or 0 if they aren't converging.
 *
 * 1. Closest point of approach: with both on straight tracks, the gap
 *    between them is smallest at time `t` (clamped to the look-ahead
 *    window), where it is `miss` long.
 * 2. No conflict if `miss` is at least `AVOID_SEPARATION`.
 * 3. Otherwise turn away from where the other plane will be at that
 *    moment: left if it passes on our right, right if on our left. Dead
 *    ahead (a head-on) both turn right, as pilots do, so the two planes
 *    never mirror each other into the same swerve.
 * 4. Strength grows as the predicted miss shrinks and as the moment gets
 *    nearer, so distant or glancing conflicts get a gentle nudge and
 *    imminent ones a hard turn.
 */
function avoidanceTurn(plane: Plane, other: Plane): number {
  const a = headingVector(plane.heading);
  const b = headingVector(other.heading);
  // Other plane's position and velocity relative to this one.
  const rx = other.pos.x - plane.pos.x;
  const ry = other.pos.y - plane.pos.y;
  const vx = (b.x - a.x) * PLANE_SPEED;
  const vy = (b.y - a.y) * PLANE_SPEED;
  const vv = vx * vx + vy * vy;
  const t = vv > 0 ? clamp(-(rx * vx + ry * vy) / vv, 0, AVOID_LOOKAHEAD) : 0;
  // Where the other plane sits, relative to this one, at closest approach.
  const mx = rx + vx * t;
  const my = ry + vy * t;
  const miss = Math.hypot(mx, my);
  if (miss >= AVOID_SEPARATION) return 0;

  // Sign of forward × offset: positive means the other plane passes on our
  // right (with +y down the screen, turning right increases the heading).
  const side = a.x * my - a.y * mx;
  const direction = Math.abs(side) < 1e-6 ? 1 : -Math.sign(side);
  const urgency = (1 - miss / AVOID_SEPARATION) * (1 - t / AVOID_LOOKAHEAD);
  return direction * urgency * AVOID_MAX_TURN;
}
