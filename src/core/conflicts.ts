/**
 * Conflict prediction: which pairs of planes are on course to collide.
 *
 * `detectCollisions` (core/collision.ts) only reports a crash once planes
 * overlap. This looks ahead instead: it flies a ghost copy of every plane
 * in play along its drawn path (the same `updatePlane` the real flight
 * uses, so turn rate, waypoint capture and climb-out all match) and
 * measures the gap between each pair over the next `CONFLICT_HORIZON`
 * seconds. Pairs that dip under `COLLISION_DISTANCE` are the conflicts.
 *
 * It's a prediction, not a promise: the player can still redraw a path
 * (the list shrinks as soon as they do), and out past the airspace edge
 * the automatic avoidance (core/avoidance.ts) bends tracks the ghosts
 * fly straight. That doesn't matter for the answer, because only the gap
 * while *both* planes are inside the airspace counts, exactly as in
 * `detectCollisions`.
 *
 * All geometry and timing: no network, no randomness, so it works with the
 * API down and gives the same list for the same state.
 */
import { COLLISION_DISTANCE, CONFLICT_HORIZON, CONFLICT_STEP } from "../config";
import type { AdviceConflict, AdvicePlane } from "./conflictAdvice";
import { checkLanding } from "./landing";
import { isInAirspace } from "./layout";
import { angleDelta, clamp } from "./math";
import { updatePlane } from "./plane";
import type { GameState, Plane, PlaneColor, Vec2 } from "./types";

/** One predicted mid-air collision. */
export interface Conflict {
  /** The two planes involved, lowest id first. */
  planeIds: [number, number];
  colors: [PlaneColor, PlaneColor];
  /** Seconds from now to their closest approach. */
  time: number;
  /** How close they get (world units); below `COLLISION_DISTANCE`. */
  miss: number;
  /** Where it happens: midway between the two planes at closest approach. */
  at: Vec2;
  /** Angle between their headings then, in degrees: 180 head-on, 0 overtaking. */
  angle: number;
}

/** `Conflict.planeIds` as the key the advice API and the HUD use for the pair. */
export function conflictKey(conflict: Pick<Conflict, "planeIds">): string {
  return conflict.planeIds.join(":");
}

/** A plane being flown forward in time, and where it was at the last step. */
interface Ghost {
  plane: Plane;
  /** Still flying (not landed, departed or otherwise out of the picture). */
  live: boolean;
  /** Position at the start of the current step, for the sweep between samples. */
  prev: Vec2;
}

/** Airborne and under the sim's collision rules (see `isInPlay` in collision.ts). */
function isAirborneInPlay(plane: Plane): boolean {
  return plane.phase === "flying" || plane.phase === "climbout";
}

/**
 * Copy of `plane` that can be flown without touching the real one. Only the
 * fields `updatePlane` and `checkLanding` write are duplicated.
 */
function ghostOf(plane: Plane): Ghost {
  return {
    plane: {
      ...plane,
      pos: { ...plane.pos },
      path: plane.path.map((p) => ({ ...p })),
      departure: plane.departure ? { ...plane.departure } : null,
      // A fresh avoidance turn is only worked out by `step`: fly the path as drawn.
      avoidTurn: 0,
    },
    live: true,
    prev: { ...plane.pos },
  };
}

/**
 * Smallest gap between two planes that each move in a straight line from
 * `a0`→`a1` and `b0`→`b1` over one step, and when (0..1) it happens.
 * Sampling only at the step ends could jump clean over a graze, so the
 * relative motion is swept exactly.
 */
function sweptMiss(
  a0: Vec2,
  a1: Vec2,
  b0: Vec2,
  b1: Vec2,
): { miss: number; u: number; a: Vec2; b: Vec2 } {
  const rx = b0.x - a0.x;
  const ry = b0.y - a0.y;
  const vx = b1.x - a1.x - rx;
  const vy = b1.y - a1.y - ry;
  const vv = vx * vx + vy * vy;
  const u = vv > 0 ? clamp(-(rx * vx + ry * vy) / vv, 0, 1) : 0;
  const a = { x: a0.x + (a1.x - a0.x) * u, y: a0.y + (a1.y - a0.y) * u };
  const b = { x: b0.x + (b1.x - b0.x) * u, y: b0.y + (b1.y - b0.y) * u };
  return { miss: Math.hypot(b.x - a.x, b.y - a.y), u, a, b };
}

/**
 * Every pair of planes predicted to collide within `CONFLICT_HORIZON`
 * seconds, soonest first. Empty unless the shift is running.
 *
 * Which planes count matches `detectCollisions`: airborne (flying, or a
 * departure climbing out), and only while inside the airspace. A plane
 * still flying in is included, since it becomes the player's problem the
 * moment it crosses the edge; one that lands during the look-ahead drops
 * out at touchdown (`checkLanding`), so a good approach isn't flagged for
 * the runway it's about to leave. Departures still on the ground, planes
 * rolling out, and planes already leaving the map aren't in play.
 *
 * Each pair is listed once, at its closest approach.
 */
export function predictConflicts(state: GameState): Conflict[] {
  if (state.phase !== "playing" && state.phase !== "paused") return [];
  const ghosts = state.planes.filter(isAirborneInPlay).map(ghostOf);
  if (ghosts.length < 2) return [];

  /** Closest in-airspace approach per pair, keyed by the two ids. */
  const worst = new Map<string, Conflict>();

  const steps = Math.ceil(CONFLICT_HORIZON / CONFLICT_STEP);
  for (let n = 0; n < steps; n++) {
    for (const g of ghosts) {
      if (!g.live) continue;
      g.prev = { ...g.plane.pos };
      updatePlane(g.plane, CONFLICT_STEP, state.world);
      // Touched down (the runway is assumed free), or left the map: out of the picture.
      if (checkLanding(g.plane, state.runways)) g.live = false;
      else if (!isAirborneInPlay(g.plane)) g.live = false;
    }

    for (let i = 0; i < ghosts.length; i++) {
      const a = ghosts[i]!;
      if (!a.live) continue;
      for (let j = i + 1; j < ghosts.length; j++) {
        const b = ghosts[j]!;
        if (!b.live) continue;
        // Both must be over the airspace at the end of the step, as in the sim.
        if (!isInAirspace(a.plane.pos, state.world) || !isInAirspace(b.plane.pos, state.world)) {
          continue;
        }
        const s = sweptMiss(a.prev, a.plane.pos, b.prev, b.plane.pos);
        if (s.miss >= COLLISION_DISTANCE) continue;

        const [lo, hi] = a.plane.id < b.plane.id ? [a, b] : [b, a];
        const key = `${lo.plane.id}:${hi.plane.id}`;
        const known = worst.get(key);
        if (known && known.miss <= s.miss) continue;
        worst.set(key, {
          planeIds: [lo.plane.id, hi.plane.id],
          colors: [lo.plane.color, hi.plane.color],
          time: (n + s.u) * CONFLICT_STEP,
          miss: s.miss,
          at: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 },
          angle: (Math.abs(angleDelta(a.plane.heading, b.plane.heading)) * 180) / Math.PI,
        });
      }
    }
  }

  return [...worst.values()].sort((x, y) => x.time - y.time);
}

/** What Jev is told about `plane` (see core/conflictAdvice.ts). */
function advicePlane(plane: Plane): AdvicePlane {
  return {
    color: plane.color,
    kind: plane.departure ? "departure" : "arrival",
    // Only a plane under the player's control can be redirected; a
    // departure climbing out flies the game's own route.
    steerable: plane.phase === "flying",
    committedToLanding: plane.pathAnchored,
    pathPoints: plane.path.length,
  };
}

/**
 * The facts about `conflicts` to put to Jev: the soonest `limit`, each with
 * both planes' situation read from the live `state`. Plain data, no
 * wording: the questions are written server-side (api/_lib/advice.ts).
 */
export function adviceFacts(
  conflicts: readonly Conflict[],
  state: GameState,
  limit: number,
): AdviceConflict[] {
  const byId = new Map(state.planes.map((p) => [p.id, p]));
  const facts: AdviceConflict[] = [];
  for (const c of conflicts) {
    const a = byId.get(c.planeIds[0]);
    const b = byId.get(c.planeIds[1]);
    if (!a || !b) continue;
    facts.push({
      key: conflictKey(c),
      seconds: Math.round(c.time * 10) / 10,
      miss: Math.round(c.miss * 10) / 10,
      collisionDistance: Math.round(COLLISION_DISTANCE * 10) / 10,
      angle: Math.round(c.angle),
      a: advicePlane(a),
      b: advicePlane(b),
    });
    if (facts.length === limit) break;
  }
  return facts;
}
