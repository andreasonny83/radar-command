/**
 * Ground movement: from touchdown to the hangar.
 *
 *   touchdown ─► rollout ─► turnoff ─► taxiway ─► stand ─► hangar
 *   (landing)               (taxiing)            (stowing → landed)
 *
 * Each plane follows a precomputed `GroundRoute` (core/route.ts): a smooth
 * centreline from its touchdown point onto the runway centreline, off at the
 * turnoff, along the parallel taxiway, through its stand and into the
 * hangar, without stopping on the stand. It moves a
 * distance `s` along that route, so its position and heading always sit
 * exactly on the line, and speed is the only thing left to control.
 *
 * Speed comes from braking curves: to be doing `v` or less by a point `d`
 * ahead, braking at `a`, a plane can go at most √(v² + 2·a·d) now. Taking
 * the lowest of those limits for every upcoming constraint (turnoff, end of
 * route, plane ahead) gives smooth slow-downs and stops, never an abrupt one.
 *
 * Stands are handed out first-come, first-served per runway. A plane that
 * lands while every stand is taken stops at its runway's hold point and
 * waits; its route is extended to a stand as soon as one frees up.
 */
import {
  BACKTRACK_SPEED,
  CENTERLINE_MERGE_DISTANCE,
  GROUND_ACCEL,
  GROUND_LOOKAHEAD,
  GROUND_SEPARATION,
  GROUND_STOP_BUFFER,
  LANDING_SPEED_START,
  LINEUP_TURN_SPEED,
  MAX_GROUND_BRAKE,
  PLANE_SPEED,
  ROLLOUT_BRAKE,
  STAND_TURN_RADIUS,
  STOW_SPEED,
  TAKEOFF_ACCEL,
  TAXI_BRAKE,
  TAXI_SPEED,
  TAXI_TURN_RADIUS,
  TRAFFIC_BRAKE,
  TURNOFF_SPEED,
} from "../config";
import { allStands } from "./airfield";
import { distance, headingVector } from "./math";
import {
  appendSamples,
  appendToRoute,
  filletPath,
  mergeCurve,
  routeFromSamples,
  routeLength,
  sampleRoute,
} from "./route";
import type { GameState, GroundState, Plane, Runway, Stand, Vec2 } from "./types";

/** Spacing of the points checked for traffic along a plane's route ahead. */
const SCAN_STEP = 0.5;

/**
 * A slow plane closer than this to a threshold blocks landings there: room
 * for the merge onto the centreline plus a plane's separation.
 */
const TOUCHDOWN_ZONE_RADIUS = CENTERLINE_MERGE_DISTANCE + GROUND_SEPARATION;

/** Leave at least this much straight centreline before the turnoff's arc. */
const MIN_STRAIGHT_BEFORE_EXIT = 3;

/** True from touchdown until the plane is stowed in its hangar. */
export function isOnGround(plane: Plane): plane is Plane & { ground: GroundState } {
  return plane.ground !== null;
}

// ---------------------------------------------------------------------------
// Touchdown
// ---------------------------------------------------------------------------

/**
 * Put a plane that has just touched down on `runway` onto the ground: plan
 * its route from where it is now, heading the way it's heading, onto the
 * runway centreline and off to the hold point. A stand is added to the
 * route by `updateGround` as soon as one is free (often the same step).
 */
export function touchDown(plane: Plane, runway: Runway, seq: number): void {
  const dir = headingVector(runway.heading);
  const { exit, exitU, turnoff, hold } = runway.airfield;

  // How far along the runway (from its centre) the plane touched down.
  const along = (plane.pos.x - runway.center.x) * dir.x + (plane.pos.y - runway.center.y) * dir.y;
  // Meet the centreline a merge distance ahead, but always leave a straight
  // stretch before the turnoff so the two curves don't run into each other.
  const mergeAt = Math.min(along + CENTERLINE_MERGE_DISTANCE, exitU - MIN_STRAIGHT_BEFORE_EXIT);
  const merge = {
    x: runway.center.x + dir.x * mergeAt,
    y: runway.center.y + dir.y * mergeAt,
  };

  const route = routeFromSamples(mergeCurve(plane.pos, plane.heading, merge, runway.heading));
  appendSamples(route, filletPath([merge, exit, turnoff, hold], TAXI_TURN_RADIUS).slice(1));

  plane.phase = "landing";
  plane.turnRate = 0;
  plane.ground = {
    route,
    s: 0,
    speed: PLANE_SPEED * LANDING_SPEED_START,
    exitS: turnoffStart(route, runway),
    routeEnd: "hold",
    travelled: 0,
    standId: null,
    seq,
    stowS: Infinity,
  };
}

/**
 * Route distance where the plane starts turning off the runway: the last
 * point still on the centreline, walking back from the end of the route.
 */
function turnoffStart(route: GroundState["route"], runway: Runway): number {
  const dir = headingVector(runway.heading);
  for (let i = route.points.length - 1; i >= 0; i--) {
    const p = route.points[i]!;
    const lateral = -(p.x - runway.center.x) * dir.y + (p.y - runway.center.y) * dir.x;
    if (Math.abs(lateral) < 0.01) return route.dist[i]!;
  }
  return 0;
}

/**
 * False while a slow or stopped plane sits in `runway`'s touchdown zone
 * (e.g. the tail of a queue waiting for a stand): landing now would put one
 * plane on top of another, so arrivals have to go around instead.
 */
export function isTouchdownZoneClear(runway: Runway, planes: readonly Plane[]): boolean {
  return !planes.some(
    (p) =>
      p.ground !== null &&
      p.color === runway.color &&
      p.ground.speed < TURNOFF_SPEED &&
      distance(p.pos, runway.threshold) < TOUCHDOWN_ZONE_RADIUS,
  );
}

// ---------------------------------------------------------------------------
// Stands
// ---------------------------------------------------------------------------

/** True if some plane is cleared to, or sitting on, `stand`. */
function isStandTaken(stand: Stand, planes: readonly Plane[]): boolean {
  // A plane rolling into its hangar has left the stand: the next plane may
  // be cleared in behind it (traffic spacing keeps them apart).
  return planes.some(
    (p) => p.ground?.standId === stand.id && p.phase !== "stowing" && p.phase !== "landed",
  );
}

/**
 * Pick which free stand a plane is sent to.
 *
 * @param free  free stands on the plane's runway, ordered along the
 *   taxiway: `free[0]` is nearest the turnoff. Never empty.
 *
 * TODO(you): choose the stand allocation policy. This placeholder sends
 * planes to the farthest free stand, so a plane parking never blocks the
 * taxiway for the one behind it. See the hand-off notes for trade-offs.
 */
export function chooseStand(free: readonly Stand[], plane: Plane): Stand {
  void plane;
  return free[free.length - 1]!;
}

/**
 * Clear waiting planes to free stands, in touchdown order per runway. If
 * the earliest waiting plane of a colour can't get a stand, later planes of
 * that colour wait too, so nobody jumps the queue at the hold point.
 */
function assignStands(state: GameState): void {
  const waiting = state.planes
    .filter((p) => p.ground && p.ground.standId === null && p.ground.routeEnd === "hold")
    .sort((a, b) => a.ground!.seq - b.ground!.seq);
  if (waiting.length === 0) return;

  const stands = allStands(state.runways);
  const blocked = new Set<string>();
  for (const plane of waiting) {
    if (blocked.has(plane.color)) continue;
    const free = stands.filter((s) => s.color === plane.color && !isStandTaken(s, state.planes));
    if (free.length === 0) {
      blocked.add(plane.color);
      continue;
    }
    const stand = chooseStand(free, plane);
    const ground = plane.ground!;
    ground.standId = stand.id;
    ground.routeEnd = "hangar";
    // The hold point is on the taxiway and the lead-in is further along it,
    // so this carries straight on from wherever the plane is (even moving).
    appendToRoute(ground.route, [stand.leadIn, stand.pos], TAXI_TURN_RADIUS, [STAND_TURN_RADIUS]);
    // Then straight on through the stand into the hangar: no stop on the
    // stand. The stand faces the doorway, so this leg is dead straight.
    ground.stowS = routeLength(ground.route);
    appendToRoute(ground.route, [stand.hangarPos], TAXI_TURN_RADIUS);
  }
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

/**
 * Route distance (from the start of `plane`'s route) of the first point in
 * the next `GROUND_LOOKAHEAD` units that comes within `GROUND_SEPARATION`
 * of `other`, or null if the way is clear.
 *
 * Each point is checked against where `other` is now and against where it
 * will be by the time `plane` gets there (at their current speeds). The
 * second check catches crossing traffic, e.g. two rollouts converging on the
 * blue/yellow intersection: the other plane isn't on our route yet, but it
 * will be, and a rollout needs a long way to stop.
 */
function conflictAhead(plane: Plane & { ground: GroundState }, other: Plane): number | null {
  const { route, s, speed } = plane.ground;
  // Only traffic in front matters; whoever is behind waits for us.
  const fwd = headingVector(plane.heading);
  if ((other.pos.x - plane.pos.x) * fwd.x + (other.pos.y - plane.pos.y) * fwd.y <= 0) return null;

  const end = Math.min(routeLength(route), s + GROUND_LOOKAHEAD);
  const p: Vec2 = { x: 0, y: 0 };
  const later: Vec2 = { x: 0, y: 0 };
  const og = other.ground;
  for (let d = s; d <= end; d += SCAN_STEP) {
    sampleRoute(route, d, p);
    if (distance(p, other.pos) < GROUND_SEPARATION) return d;
    if (og && og.speed > 0) {
      // Seconds until we reach `p` (a crawl counts as walking pace, so a
      // stopped plane doesn't see the whole future at once).
      const eta = (d - s) / Math.max(speed, 1);
      sampleRoute(og.route, Math.min(routeLength(og.route), og.s + og.speed * eta), later);
      if (distance(p, later) < GROUND_SEPARATION) return d;
    }
  }
  return null;
}

/**
 * For every moving plane on the ground, the route distance of the nearest
 * traffic conflict ahead of it. If two planes would each wait for the other
 * (e.g. converging on the same spot), the one that landed first goes.
 */
function findConflicts(ground: readonly (Plane & { ground: GroundState })[]): Map<number, number> {
  const raw = new Map<number, Map<number, number>>();
  for (const a of ground) {
    if (a.phase === "landed") continue;
    const hits = new Map<number, number>();
    for (const b of ground) {
      if (b === a || b.phase === "landed") continue;
      const at = conflictAhead(a, b);
      if (at !== null) hits.set(b.id, at);
    }
    raw.set(a.id, hits);
  }

  const result = new Map<number, number>();
  for (const a of ground) {
    const hits = raw.get(a.id);
    if (!hits) continue;
    let nearest = Infinity;
    for (const b of ground) {
      const at = hits.get(b.id);
      if (at === undefined) continue;
      const mutual = raw.get(b.id)?.has(a.id) ?? false;
      if (mutual && a.ground.seq < b.ground.seq) continue; // a has priority
      nearest = Math.min(nearest, at);
    }
    if (nearest < Infinity) result.set(a.id, nearest);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/** Highest speed from which braking at `brake` still gets down to `v` within `d`. */
function brakingLimit(d: number, v: number, brake: number): number {
  return Math.sqrt(v * v + 2 * brake * Math.max(0, d));
}

/** Speed the plane should be doing right now, before accel/brake limits. */
function targetSpeed(
  plane: Plane & { ground: GroundState },
  conflictAt: number | undefined,
): number {
  const g = plane.ground;
  let target: number;
  switch (plane.phase) {
    case "landing":
      // Bleed off speed towards the turnoff. The braking curve only falls as
      // the plane rolls on, so this never speeds a plane up, except to pull
      // away again after stopping behind traffic.
      target = Math.min(
        PLANE_SPEED * LANDING_SPEED_START,
        brakingLimit(g.exitS - g.s, TURNOFF_SPEED, ROLLOUT_BRAKE),
      );
      break;
    case "taxiing":
      // Ease down to hangar speed by the stand, then roll straight in.
      target = Math.min(TAXI_SPEED, brakingLimit(g.stowS - g.s, STOW_SPEED, TAXI_BRAKE));
      break;
    case "stowing":
      target = STOW_SPEED;
      break;
    case "outbound": {
      // A departure (core/departures.ts): creep out of the hangar and stop
      // on the stand until cleared; then taxi briskly, slowing for the
      // line-up U-turn.
      const dep = plane.departure;
      if (!dep) return 0;
      target = dep.cleared
        ? Math.min(BACKTRACK_SPEED, brakingLimit(dep.uTurnS - g.s, LINEUP_TURN_SPEED, TAXI_BRAKE))
        : Math.min(STOW_SPEED, brakingLimit(dep.holdS - g.s, 0, TAXI_BRAKE));
      break;
    }
    case "takeoff":
      // Full power: acceleration alone limits it, until it lifts off
      // (core/departures.ts). Only traffic ahead could still stop it.
      target = Infinity;
      break;
    default:
      return 0;
  }
  if (plane.phase !== "takeoff") {
    target = Math.min(target, brakingLimit(routeLength(g.route) - g.s, 0, TAXI_BRAKE));
  }
  if (conflictAt !== undefined) {
    const room = conflictAt - GROUND_STOP_BUFFER - g.s;
    target = Math.min(target, brakingLimit(room, 0, TRAFFIC_BRAKE));
  }
  return target;
}

/** Advance every plane on the ground by `dt` seconds. */
export function updateGround(state: GameState, dt: number): void {
  assignStands(state);
  const ground = state.planes.filter(isOnGround);
  if (ground.length === 0) return;
  // Traffic is judged from where everyone is at the start of the step, so
  // the result doesn't depend on the order planes are updated in.
  const conflicts = findConflicts(ground);

  for (const plane of ground) {
    const g = plane.ground;
    if (plane.phase === "landed") continue;

    // Ease towards the target speed: gentle acceleration (full power on a
    // take-off roll), firmer braking.
    const target = targetSpeed(plane, conflicts.get(plane.id));
    const accel = plane.phase === "takeoff" ? TAKEOFF_ACCEL : GROUND_ACCEL;
    g.speed =
      target < g.speed
        ? Math.max(target, g.speed - MAX_GROUND_BRAKE * dt)
        : Math.min(target, g.speed + accel * dt);

    const length = routeLength(g.route);
    const before = g.s;
    g.s = Math.min(length, g.s + g.speed * dt);
    // Braking curves approach the end asymptotically: call it arrived
    // once it's within a hair.
    if (length - g.s < 1e-3) g.s = length;
    g.travelled += g.s - before;
    plane.heading = sampleRoute(g.route, g.s, plane.pos);

    if (plane.phase === "landing" && g.s >= g.exitS) plane.phase = "taxiing";
    // Passing its stand frees it for the next plane (see isStandTaken).
    if (plane.phase === "taxiing" && g.s >= g.stowS) plane.phase = "stowing";
    if (g.s < length) continue;

    // Reached the end of the route.
    g.speed = 0;
    if (g.routeEnd === "hangar") {
      plane.phase = "landed"; // at rest inside the hangar: pruned by `step`
    }
    // "hold": wait for `assignStands` to extend the route.
  }
}
