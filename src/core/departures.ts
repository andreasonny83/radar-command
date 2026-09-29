/**
 * Departures: planes taking off from the field.
 *
 * Once the shift has warmed up (`DEPARTURE_START_LANDINGS` landings), a violet
 * plane rolls out of a hangar every so often and the game flies it all the
 * way out; the player can't steer it, only keep arrivals clear of it:
 *
 *   hangar ─► stand ──(cleared)──► taxiway ─► connector ─► backtrack ─► U-turn
 *     (outbound, waiting on the stand)                     (outbound, runway closed)
 *
 *   ─► line up ─► take-off roll ─► lift-off ─► climb out ─► off the map
 *      (outbound)   (takeoff)                  (climbout)    (departed)
 *
 * On the ground a departure is an ordinary `GroundState` plane, so the
 * traffic rules in core/ground.ts (spacing, braking curves, priority) keep
 * it clear of taxiing arrivals. This module adds the take-off rules on top:
 *
 * - It waits on its stand, off the taxiway, until the runway is free: no
 *   plane rolling out on it (or on a runway crossing it), no other
 *   departure using either, and no arrival close in on an anchored
 *   approach. That last condition lapses after `MAX_ARRIVAL_WAIT`, so a
 *   steady stream of arrivals can't hold a departure forever: they go
 *   around instead.
 * - Once cleared, the runway is closed to arrivals until lift-off (see
 *   `isRunwayClosed`): they go around, like a runway blocked by a queue.
 * - Airborne, it follows a planned route (`planDepartureRoute`), drawn as a
 *   dotted line from the moment it's announced, so the player can plan
 *   round it. Inside the airspace it collides like any flying plane.
 */
import {
  DEPARTURE_ARRIVAL_CLEARANCE,
  DEPARTURE_INTERVAL_MAX,
  DEPARTURE_INTERVAL_MIN,
  DEPARTURE_MAX_TURN,
  DEPARTURE_ROUTE_SPACING,
  DEPARTURE_START_LANDINGS,
  DEPARTURE_STRAIGHT_OUT,
  GROUND_SEPARATION,
  LINEUP_HOLD,
  LINEUP_TURN_RADIUS,
  MAX_TURN_RATE,
  PLANE_SPEED,
  ROTATE_SPEED,
  RUNWAY_LENGTH,
  STAND_TURN_RADIUS,
  TAXI_TURN_RADIUS,
  TAXIWAY_OFFSET,
} from "../config";
import { runwayFrame } from "./airfield";
import { distance, headingVector, lerp, normalizeAngle } from "./math";
import { createPlane } from "./plane";
import { unlockedColors } from "./progression";
import {
  appendSamples,
  appendToRoute,
  filletPath,
  mergeCurve,
  routeFromSamples,
  routeLength,
} from "./route";
import { mapBounds } from "./scenery";
import type {
  GameState,
  GroundRoute,
  Plane,
  Rng,
  Runway,
  RunwayColor,
  SimEvent,
  Stand,
  Vec2,
  WorldSize,
} from "./types";

/**
 * Seconds a departure waits on its stand for arrivals on short final to
 * land. After that it goes anyway (only planes actually rolling on the
 * runway still hold it), and the arrivals have to go around.
 */
const MAX_ARRIVAL_WAIT = 10;

/**
 * Room (along the taxiway) a stand needs between its lead-in and the
 * connector: the turn out of the stand plus the connector's first corner.
 */
const CONNECTOR_ROOM = STAND_TURN_RADIUS + TAXIWAY_OFFSET / 2 + 0.5;

/** How far down the runway the line-up U-turn's far edge may reach. */
const TURN_PAD_MARGIN = 0.8;

/** Length of the S-bends into and out of the line-up U-turn. */
const LINEUP_MERGE = 5;

/** A departure's route runs on this far past the map edge (see `exitPoint`). */
const EXIT_OVERSHOOT = 8;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** True for the phases a departure goes through, from hangar to lift-off. */
function isDepartureOnGround(plane: Plane): boolean {
  return plane.phase === "outbound" || plane.phase === "takeoff";
}

/**
 * True while a departure cleared onto `runway` hasn't lifted off yet: the
 * runway is closed to arrivals (they go around, see core/simulation.ts).
 */
export function isRunwayClosed(runway: Runway, planes: readonly Plane[]): boolean {
  return planes.some(
    (p) => p.departure?.runway === runway.color && p.departure.cleared && isDepartureOnGround(p),
  );
}

/** Runways that cross `runway` (same centre, see `RUNWAY_LAYOUT`), itself included. */
function runwayGroup(runway: Runway, runways: readonly Runway[]): Runway[] {
  return runways.filter((r) => distance(r.center, runway.center) < 1e-6);
}

/**
 * Stands on `runway` a departure can start from: far enough back from the
 * connector to turn out of the stand and then into the connector.
 */
function departureStands(runway: Runway): Stand[] {
  const dir = headingVector(runway.heading);
  const entry = runway.airfield.departureEntry;
  return runway.airfield.stands.filter((s) => {
    const along = (entry.x - s.leadIn.x) * dir.x + (entry.y - s.leadIn.y) * dir.y;
    return along >= CONNECTOR_ROOM;
  });
}

/**
 * A stand a departure can roll out of right now: nobody cleared to it or
 * rolling into its hangar, and no plane on the ground close by.
 */
function freeDepartureStand(runway: Runway, planes: readonly Plane[]): Stand | null {
  for (const stand of departureStands(runway)) {
    const busy = planes.some(
      (p) =>
        p.ground !== null &&
        (p.ground.standId === stand.id ||
          distance(p.pos, stand.pos) < GROUND_SEPARATION * 2 ||
          distance(p.pos, stand.hangarPos) < GROUND_SEPARATION * 2),
    );
    if (!busy) return stand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Ground route of a departure, and the landmarks along it. */
interface DepartureRoute {
  route: GroundRoute;
  /** On the stand, where it waits for clearance. */
  holdS: number;
  /** At the stand's lead-in, where it leaves the stand for the taxiway. */
  leaveStandS: number;
  /** Where the line-up U-turn starts. */
  uTurnS: number;
  /** Lined up on the centreline, ready to roll. */
  lineUp: Vec2;
}

/**
 * The taxi route from `stand`'s hangar to the line-up point:
 *
 *   hangar ─► stand ─► lead-in ─► along the taxiway (with the arrivals'
 *   flow) ─► U-shaped connector onto the runway's far end ─► backtrack down
 *   the centreline ─► U-turn inside the paved width ─► line up
 *
 * The U-turn swings out to one side and round a circle of
 * `LINEUP_TURN_RADIUS`, its far edge just short of the runway end, then
 * merges back onto the centreline facing the landing direction.
 */
function buildDepartureRoute(runway: Runway, stand: Stand): DepartureRoute {
  const { departureEntry: entry, departureJoin: join } = runway.airfield;
  const dir = headingVector(runway.heading);
  const back = normalizeAngle(runway.heading + Math.PI);

  // Out of the hangar, nose first, onto the stand.
  const route = routeFromSamples(filletPath([stand.hangarPos, stand.pos], TAXI_TURN_RADIUS));
  const holdS = routeLength(route);
  const leaveStandS = holdS + distance(stand.pos, stand.leadIn);

  // Along the taxiway and round the connector, onto the centreline facing
  // back down the runway. The connector's two corners share its short leg,
  // so each is rounded to half of it.
  const joinAhead = { x: join.x - dir.x * 6, y: join.y - dir.y * 6 };
  appendToRoute(route, [stand.leadIn, entry, join, joinAhead], TAXI_TURN_RADIUS, [
    STAND_TURN_RADIUS,
  ]);

  // Backtrack to the U-turn, in the runway's own frame (u along the landing
  // direction from its centre, v sideways).
  const at = runwayFrame(runway.center, runway.heading, 1);
  const r = LINEUP_TURN_RADIUS;
  const turnU = -RUNWAY_LENGTH / 2 + TURN_PAD_MARGIN + r; // centre of the U-turn
  const startU = turnU + LINEUP_MERGE;
  appendToRoute(route, [at(startU, 0)], TAXI_TURN_RADIUS);
  const uTurnS = routeLength(route);

  // Swing out to +v, round the circle to -v, and back onto the centreline.
  appendSamples(route, mergeCurve(at(startU, 0), back, at(turnU, r), back).slice(1));
  const steps = 24;
  const arc = [];
  for (let i = 1; i <= steps; i++) {
    const phi = Math.PI / 2 + (Math.PI * i) / steps;
    // Position on the circle and its direction of travel, in (u, v).
    const du = -Math.sin(phi);
    const dv = Math.cos(phi);
    arc.push({
      p: at(turnU + r * Math.cos(phi), r * Math.sin(phi)),
      heading: normalizeAngle(runway.heading + Math.atan2(dv, du)),
    });
  }
  appendSamples(route, arc);
  const lineUp = at(turnU + LINEUP_MERGE, 0);
  appendSamples(route, mergeCurve(at(turnU, -r), runway.heading, lineUp, runway.heading).slice(1));

  return { route, holdS, leaveStandS, uTurnS, lineUp };
}

/**
 * Waypoints of a departure's flight after lift-off, starting past the far
 * end of `runway` (`start`, on the centreline) and ending off the map. The
 * plane flies them in order (smoothed into arcs, see `departurePath`), and
 * they're drawn as its dotted line, so they're also what the player plans
 * the arrivals round.
 *
 * TODO(you): shape the departure procedure. This placeholder climbs
 * straight out for `DEPARTURE_STRAIGHT_OUT` units, then turns up to
 * `DEPARTURE_MAX_TURN` either way at random and flies off the map. Some
 * alternatives, each a different game:
 *   - always straight out on the runway heading: the most predictable, and
 *     every departure from a runway shares one corridor to keep clear;
 *   - turn towards the nearest map edge: the shortest time in the airspace,
 *     so the least exposure to collisions;
 *   - aim away from the other airports' approaches (see `state.runways`):
 *     the kindest to the player, but a busy field can't always manage it.
 */
export function planDepartureRoute(
  runway: Runway,
  start: Vec2,
  world: WorldSize,
  rng: Rng,
): Vec2[] {
  const out = headingVector(runway.heading);
  const turnAt = {
    x: start.x + out.x * DEPARTURE_STRAIGHT_OUT,
    y: start.y + out.y * DEPARTURE_STRAIGHT_OUT,
  };
  const heading = runway.heading + (rng() * 2 - 1) * DEPARTURE_MAX_TURN;
  return [turnAt, exitPoint(turnAt, heading, world)];
}

/**
 * Where a straight line from `from` along `heading` leaves the scenery map,
 * plus a little: a plane flying there has flown out of sight (and is then
 * pruned, see core/plane.ts). From outside the map, `from` itself.
 */
export function exitPoint(from: Vec2, heading: number, world: WorldSize): Vec2 {
  const b = mapBounds(world);
  const d = headingVector(heading);
  // Distance to the first map edge ahead, on each axis (ray vs. box).
  const tx =
    d.x > 1e-9 ? (b.maxX - from.x) / d.x : d.x < -1e-9 ? (b.minX - from.x) / d.x : Infinity;
  const ty =
    d.y > 1e-9 ? (b.maxY - from.y) / d.y : d.y < -1e-9 ? (b.minY - from.y) / d.y : Infinity;
  const t = Math.max(0, Math.min(tx, ty)) + EXIT_OVERSHOOT;
  return { x: from.x + d.x * t, y: from.y + d.y * t };
}

/**
 * The departure's whole dotted line: from the line-up point down the
 * runway, then its planned route (`planDepartureRoute`), with every corner
 * rounded into a flyable arc and points every `DEPARTURE_ROUTE_SPACING`
 * units, like a path drawn by the player. Stored as `Plane.path`: after
 * lift-off the plane steers along it exactly like a flying plane.
 */
function departurePath(runway: Runway, lineUp: Vec2, world: WorldSize, rng: Rng): Vec2[] {
  const farEnd = runwayFrame(runway.center, runway.heading, 1)(RUNWAY_LENGTH / 2, 0);
  const planned = planDepartureRoute(runway, farEnd, world, rng);
  // Twice the tightest turn the plane can fly, so it follows the arcs easily.
  const radius = (2 * PLANE_SPEED) / MAX_TURN_RATE;
  const smooth = filletPath([lineUp, farEnd, ...planned], radius).map((s) => s.p);
  return densify(smooth, DEPARTURE_ROUTE_SPACING);
}

/** `points` with extra points added so no gap is longer than `spacing`. */
function densify(points: readonly Vec2[], spacing: number): Vec2[] {
  const result: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = result[result.length - 1];
    if (prev) {
      const n = Math.floor(distance(prev, p) / spacing);
      for (let k = 1; k < n; k++) {
        result.push({ x: lerp(prev.x, p.x, k / n), y: lerp(prev.y, p.y, k / n) });
      }
    }
    result.push({ ...p });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

/**
 * Put a departure for `runway` in the hangar behind `stand`, nose towards
 * the doorway, ready to roll out.
 */
export function createDeparture(state: GameState, runway: Runway, stand: Stand, rng: Rng): Plane {
  const { route, holdS, leaveStandS, uTurnS, lineUp } = buildDepartureRoute(runway, stand);
  const heading = route.headings[0]!;
  const plane = createPlane(state.nextPlaneId++, "violet", stand.hangarPos, heading);
  plane.phase = "outbound";
  plane.canDepart = false;
  plane.path = departurePath(runway, lineUp, state.world, rng);
  plane.pathVersion++;
  plane.ground = {
    route,
    s: 0,
    speed: 0,
    exitS: Infinity,
    routeEnd: "runway",
    // Already on its wheels: no flare (see render/sceneSync.ts).
    travelled: Infinity,
    // Holds its stand until it has left it, so no arrival is sent there.
    standId: stand.id,
    seq: state.nextGroundSeq++,
    stowS: Infinity,
  };
  plane.departure = {
    runway: runway.color,
    standId: stand.id,
    leaveStandS,
    holdS,
    uTurnS,
    cleared: false,
    waited: 0,
    lineupTime: 0,
    speed: 0,
    climbed: 0,
  };
  state.planes.push(plane);
  return plane;
}

/** Seconds until the departure after this one (see `DEPARTURE_INTERVAL_*`). */
function nextDepartureInterval(rng: Rng): number {
  return lerp(DEPARTURE_INTERVAL_MIN, DEPARTURE_INTERVAL_MAX, rng());
}

/**
 * Count down to the next departure and roll one out when it's due.
 *
 * The clock only runs once `DEPARTURE_START_LANDINGS` planes have landed. A
 * departure goes from an open runway (an unlocked colour) with no
 * departure of its own under way and a free stand to start from; if there
 * is none, it stays due and goes as soon as there is.
 */
export function scheduleDepartures(
  state: GameState,
  dt: number,
  rng: Rng,
  events: SimEvent[],
): void {
  if (state.landed < DEPARTURE_START_LANDINGS) return;
  state.departureTimer += dt;
  if (state.departureTimer < state.departureInterval) return;

  const open = new Set<RunwayColor>(unlockedColors(state.landed, state.runways));
  const candidates: { runway: Runway; stand: Stand }[] = [];
  for (const runway of state.runways) {
    if (!open.has(runway.color)) continue;
    if (state.planes.some((p) => p.departure?.runway === runway.color && p.phase !== "departed")) {
      continue;
    }
    const stand = freeDepartureStand(runway, state.planes);
    if (stand) candidates.push({ runway, stand });
  }
  if (candidates.length === 0) {
    state.departureTimer = state.departureInterval; // stay due, don't bank time
    return;
  }

  const { runway, stand } = candidates[Math.floor(rng() * candidates.length)]!;
  const plane = createDeparture(state, runway, stand, rng);
  state.departureTimer = 0;
  state.departureInterval = nextDepartureInterval(rng);
  events.push({ type: "departureAnnounced", planeId: plane.id, color: runway.color });
}

// ---------------------------------------------------------------------------
// Clearance, line-up, take-off
// ---------------------------------------------------------------------------

/**
 * May the departure `plane` enter `runway` now? See the module header: no
 * rollouts or other departures on the runway or one crossing it, and (for
 * the first `MAX_ARRIVAL_WAIT` seconds) no arrival close in on an anchored
 * approach.
 */
function isRunwayFree(plane: Plane, runway: Runway, state: GameState, waited: number): boolean {
  const group = runwayGroup(runway, state.runways);
  const colors = new Set(group.map((r) => r.color));
  for (const other of state.planes) {
    if (other === plane) continue;
    if (other.phase === "landing" && colors.has(other.color as RunwayColor)) return false;
    if (
      other.departure?.cleared &&
      isDepartureOnGround(other) &&
      colors.has(other.departure.runway)
    ) {
      return false;
    }
    if (
      waited < MAX_ARRIVAL_WAIT &&
      other.phase === "flying" &&
      other.pathAnchored &&
      other.color === runway.color &&
      distance(other.pos, runway.threshold) < DEPARTURE_ARRIVAL_CLEARANCE
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Move every departure on to its next stage, after the ground has moved
 * this step (core/ground.ts):
 *
 * 1. Past its stand's lead-in: the stand is free for arrivals again.
 * 2. Waiting on the stand: cleared once the runway is free; from then the
 *    runway is closed to arrivals.
 * 3. Lined up: spool up for `LINEUP_HOLD` seconds, then start the roll.
 * 4. Rolling at `ROTATE_SPEED`: lift off, and fly on in `climbout`
 *    (core/plane.ts) along its dotted path. The runway reopens.
 */
export function advanceDepartures(state: GameState, dt: number, events: SimEvent[]): void {
  for (const plane of state.planes) {
    const dep = plane.departure;
    const g = plane.ground;
    if (!dep || !g) continue;
    const runway = state.runways.find((r) => r.color === dep.runway);
    if (!runway) continue;

    if (g.standId !== null && g.s >= dep.leaveStandS) g.standId = null;

    if (plane.phase === "outbound" && !dep.cleared && g.s >= dep.holdS - 0.05) {
      dep.waited += dt;
      if (isRunwayFree(plane, runway, state, dep.waited)) {
        dep.cleared = true;
        events.push({ type: "runwayClosed", planeId: plane.id, color: runway.color });
      }
      continue;
    }

    if (plane.phase === "outbound" && dep.cleared && g.s >= routeLength(g.route) && g.speed === 0) {
      dep.lineupTime += dt;
      if (dep.lineupTime >= LINEUP_HOLD) {
        plane.phase = "takeoff";
        // The rest of the runway and a good way past it, straight ahead:
        // the plane lifts off long before the end of it.
        const out = headingVector(runway.heading);
        const end = g.route.points[g.route.points.length - 1]!;
        appendToRoute(
          g.route,
          [{ x: end.x + out.x * RUNWAY_LENGTH * 2, y: end.y + out.y * RUNWAY_LENGTH * 2 }],
          TAXI_TURN_RADIUS,
        );
        events.push({ type: "takeoffRoll", planeId: plane.id, color: runway.color });
      }
      continue;
    }

    if (plane.phase === "takeoff" && g.speed >= ROTATE_SPEED) {
      plane.phase = "climbout";
      dep.speed = g.speed;
      dep.climbed = 0;
      plane.ground = null;
      plane.turnRate = 0;
      // Rebuild the dotted line from where the plane is now.
      plane.pathVersion++;
      events.push({ type: "liftoff", planeId: plane.id, color: runway.color });
    }
  }
}
