/**
 * Plane creation and per-frame movement.
 *
 * All motion is expressed in units/second and scaled by `dt`. Flight is
 * integrated in fixed sub-steps (`FLIGHT_SUBSTEP`), so one long frame and
 * many short ones trace the same curve.
 */
import {
  CLIMB_ACCEL,
  EXIT_LOOKAHEAD,
  FLIGHT_SUBSTEP,
  MAX_TURN_RATE,
  PLANE_RADIUS,
  PLANE_SPEED,
  TURN_LAG,
  TURN_RESPONSE,
  WAYPOINT_CAPTURE_RADIUS,
} from "../config";
import { angleDelta, clamp, distance, normalizeAngle } from "./math";
import { airspaceBounds, airspaceCenter, distanceOutsideAirspace, isInAirspace } from "./layout";
import { mapBounds } from "./scenery";
import type { Plane, PlaneColor, Vec2, WorldSize } from "./types";

export function createPlane(id: number, color: PlaneColor, pos: Vec2, heading: number): Plane {
  return {
    id,
    color,
    pos: { ...pos },
    heading: normalizeAngle(heading),
    turnRate: 0,
    path: [],
    pathVersion: 0,
    phase: "flying",
    ground: null,
    warning: false,
    pathAnchored: false,
    canDepart: true,
    inbound: false,
    entry: null,
    avoidTurn: 0,
    windStreamId: null,
    wind: { x: 0, y: 0 },
    windTurn: 0,
    departure: null,
  };
}

/**
 * Advance one airborne plane by `dt` seconds. Planes on the ground move in
 * `updateGround` (core/ground.ts) instead, since they need to see each other
 * to keep their distance.
 */
export function updatePlane(plane: Plane, dt: number, world: WorldSize): void {
  switch (plane.phase) {
    case "departing":
      updateDeparting(plane, dt, world);
      return;
    case "flying":
      updateFlying(plane, dt, world);
      return;
    case "climbout":
      updateClimbout(plane, dt, world);
      return;
    default:
      return;
  }
}

/** Move `dist` units straight along the current heading. */
function moveForward(plane: Plane, dist: number): void {
  plane.pos.x += Math.cos(plane.heading) * dist;
  plane.pos.y += Math.sin(plane.heading) * dist;
}

/**
 * Fly for `dt` seconds. The plane always moves forward at cruise speed and
 * can only change heading gradually (see `steer`), so it follows its path
 * like a real aircraft: smooth arcs, never an instant turn-around.
 *
 * Outside the airspace the automatic collision avoidance may bend the
 * course (see `Plane.avoidTurn`, set once per step by core/avoidance.ts).
 * In a wind stream the plane is also pushed and shaken (`Plane.wind`,
 * `Plane.windTurn`, set by core/windStreams.ts).
 *
 * Steering is a feedback loop, and feedback loops react differently to big
 * and small time steps. So the frame is split into fixed-size sub-steps,
 * which keeps flight paths the same whatever the display refresh rate.
 */
function updateFlying(plane: Plane, dt: number, world: WorldSize): void {
  const steps = Math.max(1, Math.ceil(dt / FLIGHT_SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    // An anchored path ends on a runway: that plane is landing, not leaving.
    const hadFreePath = plane.path.length > 0 && !plane.pathAnchored;
    const desired = desiredHeading(plane, world);
    // The path just ran out with the plane pointing off the field: the
    // player sent it away, so let it go rather than U-turning it back.
    // Planes that may not depart fall through and U-turn as usual.
    if (plane.canDepart && hadFreePath && plane.path.length === 0 && isHeadingOut(plane, world)) {
      plane.phase = "departing";
      updateDeparting(plane, dt - i * h, world);
      return;
    }
    steer(plane, (desired ?? plane.heading) + plane.avoidTurn + plane.windTurn, h);
    moveForward(plane, PLANE_SPEED * h);
    // Wind streams push the ground track sideways of the nose (see
    // core/windStreams.ts); zero outside them.
    plane.pos.x += plane.wind.x * h;
    plane.pos.y += plane.wind.y * h;
    // Arrived: the plane is now in play like any other.
    if (plane.inbound && isInAirspace(plane.pos, world)) {
      plane.inbound = false;
      plane.entry = null;
    }
  }
}

/**
 * True if flying straight on for `EXIT_LOOKAHEAD` units would take the plane
 * out of the airspace, and further from it. Lenient on purpose: the player
 * only has to aim at the edge, not drag all the way past it. The "further"
 * part matters for paths that end out in the countryside: a plane left
 * pointing back at the field there turns home rather than departing
 * straight across it.
 */
function isHeadingOut(plane: Plane, world: WorldSize): boolean {
  const ahead = {
    x: plane.pos.x + Math.cos(plane.heading) * EXIT_LOOKAHEAD,
    y: plane.pos.y + Math.sin(plane.heading) * EXIT_LOOKAHEAD,
  };
  const out = distanceOutsideAirspace(ahead, world);
  return out > 0 && out > distanceOutsideAirspace(plane.pos, world);
}

/**
 * Fly a departing plane straight out of the world. Any leftover bank rolls
 * out smoothly (steering towards its own heading), and the automatic
 * collision avoidance may bend its track round other traffic. It stays
 * fully visible and is only removed once it has cleared the scenery map:
 * the map is sized to fill the view at the lowest zoom, so by then it is
 * off-screen.
 */
function updateDeparting(plane: Plane, dt: number, world: WorldSize): void {
  const steps = Math.max(1, Math.ceil(dt / FLIGHT_SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    steer(plane, plane.heading + plane.avoidTurn, h);
    moveForward(plane, PLANE_SPEED * h);
  }
  if (isOffMap(plane, world)) plane.phase = "departed";
}

/** True once `plane` has cleared the scenery map (and so the view). */
function isOffMap(plane: Plane, world: WorldSize): boolean {
  const b = mapBounds(world);
  const m = PLANE_RADIUS;
  const { x, y } = plane.pos;
  return x < b.minX - m || x > b.maxX + m || y < b.minY - m || y > b.maxY + m;
}

/**
 * Fly a departure after lift-off (see core/departures.ts) for `dt` seconds.
 *
 * Like `updateFlying`, but the game is at the controls: the plane steers
 * along its planned (dotted) path, which the player can't redraw, and it
 * keeps accelerating from lift-off speed up to cruise at `CLIMB_ACCEL`.
 * `climbed` (distance since lift-off) drives the climb profile the
 * renderer draws. Outside the airspace the automatic avoidance may bend its
 * track; once past the map edge it is `departed` and pruned.
 */
function updateClimbout(plane: Plane, dt: number, world: WorldSize): void {
  const dep = plane.departure;
  if (!dep) return;
  const steps = Math.max(1, Math.ceil(dt / FLIGHT_SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    dep.speed = Math.min(PLANE_SPEED, dep.speed + CLIMB_ACCEL * h);
    const target = nextWaypoint(plane);
    // Mid-swerve, hold the heading and let the avoidance turn bend it (see
    // `desiredHeading`).
    const desired =
      target && plane.avoidTurn === 0
        ? Math.atan2(target.y - plane.pos.y, target.x - plane.pos.x)
        : plane.heading;
    steer(plane, desired + plane.avoidTurn, h);
    moveForward(plane, dep.speed * h);
    dep.climbed += dep.speed * h;
  }
  if (isOffMap(plane, world)) plane.phase = "departed";
}

/**
 * The heading the plane wants to fly right now, or null for "carry on
 * straight".
 *
 * - Swerving round traffic outside the airspace: carry on, and let the
 *   avoidance turn do the steering (see `Plane.avoidTurn`).
 * - With a path: aim at the next waypoint that is still worth chasing.
 * - Without one: if the plane has drifted out of the airspace on its own,
 *   head back towards its middle with a smooth U-turn. (Planes the player
 *   steers out never get here: they switch to `departing`, see
 *   `updateFlying`.)
 * - Inbound planes are still outside on purpose, on a track the spawner
 *   aimed across the airspace edge: they hold course for their entry point
 *   (which also brings them back onto it after swerving round traffic).
 *   Once the entry point is behind them they carry straight on.
 */
function desiredHeading(plane: Plane, world: WorldSize): number | null {
  const target = nextWaypoint(plane);
  // Mid-swerve (see core/avoidance.ts), hold the current heading and let
  // the avoidance turn bend it: aiming back at the path, entry point or
  // field now would pull the plane straight back into the conflict. The
  // course resumes once the conflict clears.
  if (plane.avoidTurn !== 0) return null;
  if (target) return Math.atan2(target.y - plane.pos.y, target.x - plane.pos.x);
  if (plane.inbound) {
    const e = plane.entry;
    if (!e) return null;
    const dx = e.x - plane.pos.x;
    const dy = e.y - plane.pos.y;
    const ahead = dx * Math.cos(plane.heading) + dy * Math.sin(plane.heading) > 0;
    return ahead ? Math.atan2(dy, dx) : null;
  }

  const b = airspaceBounds(world);
  const m = PLANE_RADIUS;
  const { x, y } = plane.pos;
  if (x < b.minX - m || x > b.maxX + m || y < b.minY - m || y > b.maxY + m) {
    const home = airspaceCenter(world);
    return Math.atan2(home.y - y, home.x - x);
  }
  return null;
}

/**
 * Drop waypoints the plane has dealt with, and return the one to aim at now
 * (or undefined once the path is used up).
 *
 * A waypoint is dropped when it is:
 * - reached: within `WAYPOINT_CAPTURE_RADIUS`;
 * - passed: the plane is already beyond it along the path, e.g. it cut a
 *   corner it was too fast to take exactly;
 * - unreachable: it lies inside the plane's tightest turning circle, so no
 *   amount of turning can reach it without a full loop. If we kept chasing
 *   it, the plane would circle it forever.
 */
function nextWaypoint(plane: Plane): Vec2 | undefined {
  while (plane.path.length > 0) {
    const wp = plane.path[0]!;
    const next = plane.path[1];
    const reached = distance(plane.pos, wp) <= WAYPOINT_CAPTURE_RADIUS;
    const passed =
      next !== undefined &&
      (plane.pos.x - wp.x) * (next.x - wp.x) + (plane.pos.y - wp.y) * (next.y - wp.y) > 0;
    if (!reached && !passed && !insideTurnCircle(plane, wp)) return wp;

    plane.path.shift();
    plane.pathVersion++;
  }
  // Path used up: the anchor (if any) went with it.
  plane.pathAnchored = false;
  return undefined;
}

/**
 * True if `p` lies inside the circle the plane would fly if it turned
 * towards `p` as hard as it can. Points in there can't be reached directly.
 */
function insideTurnCircle(plane: Plane, p: Vec2): boolean {
  const radius = PLANE_SPEED / MAX_TURN_RATE;
  const fx = Math.cos(plane.heading);
  const fy = Math.sin(plane.heading);
  // Which side is `p` on? The sign of the 2D cross product (forward × to-p).
  const side = fx * (p.y - plane.pos.y) - fy * (p.x - plane.pos.x) >= 0 ? 1 : -1;
  // Centre of the turning circle: one radius out to that side.
  const cx = plane.pos.x - fy * side * radius;
  const cy = plane.pos.y + fx * side * radius;
  return Math.hypot(p.x - cx, p.y - cy) < radius;
}

/**
 * Turn the plane gradually towards `desired` over `dt` seconds.
 *
 * 1. The heading error, taken the short way round, sets a commanded turn
 *    rate. It is proportional to the error (a gentle easing onto the target)
 *    and capped at `MAX_TURN_RATE` (no hairpin snaps).
 * 2. The actual turn rate eases towards that command with time constant
 *    `TURN_LAG`, like a plane rolling into a bank. The exponential form
 *    `1 - exp(-dt / lag)` makes the easing frame-rate independent.
 * 3. Heading advances by the turn rate. Because it is always integrated from
 *    a finite rate, it can never jump.
 */
function steer(plane: Plane, desired: number, dt: number): void {
  const error = angleDelta(plane.heading, desired);
  const command = clamp(error * TURN_RESPONSE, -MAX_TURN_RATE, MAX_TURN_RATE);
  plane.turnRate += (command - plane.turnRate) * (1 - Math.exp(-dt / TURN_LAG));
  plane.heading = normalizeAngle(plane.heading + plane.turnRate * dt);
}
