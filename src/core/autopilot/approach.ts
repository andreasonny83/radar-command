/**
 * Candidate paths for one plane, and the choice between them.
 *
 * Arrivals try, in order of delay: a short final, a long final, dog-legs
 * either side, an orbit either side then the long final. Each is judged on
 * its predicted track (core/autopilot/track.ts). When the runway can't be
 * used (a departure holds it) the plane gets an orbit instead, as a hold.
 */
import {
  DEMO_FINAL_LENGTH,
  DEMO_LANDING_GAP,
  DEMO_LONG_FINAL_LENGTH,
  DEMO_ORBIT_RADIUS,
  DEMO_SEPARATION,
  PLANE_SPEED,
} from "../../config";
import { distance, headingVector } from "../math";
import { anchorPath, appendPathPoint, clampPathPoint, startPath } from "../path";
import type { GameState, Plane, PlaneColor, Runway, Vec2 } from "../types";
import { ghostOf, hitsPeak, minSeparation, predictTrack, type Track } from "./track";

/** Spacing of the waypoints along a final, in world units. */
const FINAL_SPACING = 6;

/** Waypoints on the orbit circle. */
const ORBIT_STEPS = 8;

/** How far to the side of the runway an "around the airport" path swings, in world units. */
const AROUND_OFFSET = 30;

/** Turns away from the plane's heading that a "vector" tries first, in radians. */
const VECTOR_TURNS = [1, -1, 2, -2, 3, -3, 4.5].map((k) => (k * Math.PI) / 4.5);

/** How far a vector flies before turning back to the final, in world units. */
const VECTOR_LEGS = [14, 28];

/** Score penalty for a landing too close behind another (see `planScore`). */
const GAP_PENALTY = 5;

/** A path to try. `hold`: an orbit that doesn't aim at the runway (never anchored). */
export interface Candidate {
  points: Vec2[];
  hold: boolean;
}

/** A candidate, judged. */
export interface Verdict {
  candidate: Candidate;
  anchored: boolean;
  /** Closest it comes to any other plane's track (Infinity: nobody near). */
  clearance: number;
  /** It enters a black stream's build-up or peak. */
  lethal: boolean;
  /** Its landing time keeps `DEMO_LANDING_GAP` from the other approaches to the runway. */
  gapOk: boolean;
  track: Track;
}

/** What a plan is judged against. */
export interface PlanContext {
  state: GameState;
  /** Predicted tracks of the planes this one must keep clear of. */
  others: readonly Track[];
  /** Time to touchdown of each approach already anchored (other planes). */
  etas: ReadonlyArray<{ color: PlaneColor; eta: number }>;
}

/** Length of the polyline `from` → `path`. */
export function pathLength(from: Vec2, path: readonly Vec2[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += distance(prev, p);
    prev = p;
  }
  return total;
}

/** Waypoints from `length` units out on the runway's centreline in to the threshold. */
export function finalPoints(runway: Runway, length: number): Vec2[] {
  const d = headingVector(runway.heading);
  const points: Vec2[] = [];
  for (let back = length; back > 0; back -= FINAL_SPACING) {
    points.push({ x: runway.threshold.x - d.x * back, y: runway.threshold.y - d.y * back });
  }
  points.push({ ...runway.threshold });
  return points;
}

/**
 * A full circle of `DEMO_ORBIT_RADIUS`, starting where the plane is.
 * `side` 1 turns right (heading increasing), -1 left.
 */
export function orbitPoints(plane: Plane, side: 1 | -1): Vec2[] {
  const toCenter = plane.heading + (side * Math.PI) / 2;
  const cx = plane.pos.x + Math.cos(toCenter) * DEMO_ORBIT_RADIUS;
  const cy = plane.pos.y + Math.sin(toCenter) * DEMO_ORBIT_RADIUS;
  // The plane sits opposite the heading's side; the angle then grows with
  // the heading for a right turn and shrinks for a left one.
  const start = toCenter + Math.PI;
  const points: Vec2[] = [];
  for (let i = 1; i <= ORBIT_STEPS; i++) {
    const a = start + side * (i / ORBIT_STEPS) * 2 * Math.PI;
    points.push({
      x: cx + Math.cos(a) * DEMO_ORBIT_RADIUS,
      y: cy + Math.sin(a) * DEMO_ORBIT_RADIUS,
    });
  }
  return points;
}

/** The paths to try for `plane`, best (least delay) first; holds last. */
export function candidates(plane: Plane, runway: Runway | undefined): Candidate[] {
  const left = orbitPoints(plane, -1);
  const right = orbitPoints(plane, 1);
  // Holds, for a runway that can't be used now: carry on, or turn away and
  // fly off a while (the path then runs out and the autopilot looks again),
  // or circle. Many ways out, because a hold has to find a gap in traffic.
  const holds: Candidate[] = [];
  for (const leg of VECTOR_LEGS) {
    for (const turn of [0, ...VECTOR_TURNS]) {
      const a = plane.heading + turn;
      holds.push({
        points: [{ x: plane.pos.x + Math.cos(a) * leg, y: plane.pos.y + Math.sin(a) * leg }],
        hold: true,
      });
    }
  }
  holds.push({ points: right, hold: true }, { points: left, hold: true });
  if (!runway) return holds;

  const short = finalPoints(runway, DEMO_FINAL_LENGTH);
  const long = finalPoints(runway, DEMO_LONG_FINAL_LENGTH);
  const entry = long[0]!;
  const dx = entry.x - plane.pos.x;
  const dy = entry.y - plane.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const mid = { x: plane.pos.x + dx / 2, y: plane.pos.y + dy / 2 };
  // A dog-leg: a waypoint pushed sideways off the straight line to the final.
  const dogleg = (offset: number): Vec2[] => [
    { x: mid.x - (dy / len) * offset, y: mid.y + (dx / len) * offset },
    ...long,
  ];
  // Round the airport: abeam the threshold, then abeam the start of the
  // final, then in. A plane on the wrong side of the runway needs it: the
  // sim drops a waypoint the plane is already past (core/plane.ts
  // `nextWaypoint`), so a final reached from behind would be cut down to
  // its last point and flown the wrong way.
  const d = headingVector(runway.heading);
  const around = (side: 1 | -1): Vec2[] => [
    {
      x: runway.threshold.x - d.y * side * AROUND_OFFSET,
      y: runway.threshold.y + d.x * side * AROUND_OFFSET,
    },
    {
      x: entry.x - d.y * side * AROUND_OFFSET * 0.6,
      y: entry.y + d.x * side * AROUND_OFFSET * 0.6,
    },
    ...long,
  ];
  // Vectors: fly off on a new heading for a while, then come back to the
  // long final. What turns a conflict into a clear sky when every direct
  // route to the runway crosses the other plane.
  const vectors: Candidate[] = [];
  for (const leg of VECTOR_LEGS) {
    for (const turn of VECTOR_TURNS) {
      const a = plane.heading + turn;
      vectors.push({
        points: [
          { x: plane.pos.x + Math.cos(a) * leg, y: plane.pos.y + Math.sin(a) * leg },
          ...long,
        ],
        hold: false,
      });
    }
  }
  return [
    { points: short, hold: false },
    { points: long, hold: false },
    { points: dogleg(14), hold: false },
    { points: dogleg(-14), hold: false },
    { points: dogleg(30), hold: false },
    { points: dogleg(-30), hold: false },
    { points: around(1), hold: false },
    { points: around(-1), hold: false },
    ...vectors,
    { points: [...right, ...long], hold: false },
    { points: [...left, ...long], hold: false },
    ...holds,
  ];
}

/**
 * Judge one candidate on a ghost of the plane. Null: it can't be flown (a
 * landing path that `anchorPath` refuses: wrong geometry, or the runway is
 * closed by a departure). The real plane is untouched.
 */
export function evaluate(plane: Plane, candidate: Candidate, ctx: PlanContext): Verdict | null {
  const { state } = ctx;
  const ghost = ghostOf(plane);
  startPath(ghost);
  for (const p of candidate.points) {
    appendPathPoint(ghost, clampPathPoint(p, state.world), 0);
  }
  let anchored = false;
  if (!candidate.hold) {
    anchored = anchorPath(ghost, state.runways, state.world, state.planes) !== null;
    if (!anchored) return null;
  }
  const track = predictTrack(ghost, state.world);
  let clearance = Infinity;
  for (const other of ctx.others) clearance = Math.min(clearance, minSeparation(track, other));
  const eta = anchored ? pathLength(plane.pos, ghost.path) / PLANE_SPEED : 0;
  const gapOk =
    !anchored ||
    ctx.etas.every((e) => e.color !== plane.color || Math.abs(e.eta - eta) >= DEMO_LANDING_GAP);
  return {
    candidate,
    anchored,
    clearance,
    lethal: hitsPeak(track, state.streams),
    gapOk,
    track,
  };
}

/** Is the verdict safe to fly? */
export function isValid(v: Verdict): boolean {
  return !v.lethal && v.clearance >= DEMO_SEPARATION && v.gapOk;
}

/** Higher is better; a lethal plan is far worse than any near miss. */
export function planScore(clearance: number, lethal: boolean): number {
  return (lethal ? -1e6 : 0) + Math.min(clearance, 1000);
}

/**
 * The first valid candidate, or (none valid) the best of the rest. Null
 * when nothing could be flown at all.
 */
export function plan(plane: Plane, runway: Runway | undefined, ctx: PlanContext): Verdict | null {
  let best: Verdict | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates(plane, runway)) {
    const v = evaluate(plane, candidate, ctx);
    if (!v) continue;
    if (isValid(v)) return v;
    const score = planScore(v.clearance, v.lethal) - (v.gapOk ? 0 : GAP_PENALTY);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/** Give the real plane the verdict's path, as a player's drag would. */
export function apply(plane: Plane, v: Verdict, state: GameState): void {
  startPath(plane);
  for (const p of v.candidate.points) {
    appendPathPoint(plane, clampPathPoint(p, state.world), 0);
  }
  if (v.anchored) anchorPath(plane, state.runways, state.world, state.planes);
}
