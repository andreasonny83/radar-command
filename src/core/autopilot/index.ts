/**
 * The demo autopilot: flies the shift by itself.
 *
 * It does what a player does, through the same functions (`startPath`,
 * `appendPathPoint`, `anchorPath` in core/path.ts), so every landing is one
 * the rules allow. Every `DEMO_REPLAN_INTERVAL` it looks at the traffic and
 * replans a plane only when it must:
 *
 * - it has no path (a fresh arrival, a go-around, a path the wind erased).
 *   A bare plane inside the airspace is not steered by the avoidance
 *   system and can collide, so nobody inside it (or about to enter) is left
 *   bare. Outside, bare is safe and a plane with no safe route is left so;
 * - its predicted track comes too close to a track it must yield to;
 * - its track meets a black wind stream's build-up or peak;
 * - it is on an approach to a runway that a departure has just closed;
 * - it is not on an approach yet and a retry is due.
 *
 * Who yields: everyone to a departure (the game flies those), an
 * unanchored plane to an anchored one, and between equals the higher id.
 * Anchored planes are looked at first so they keep their approach unless a
 * departure or lethal wind forces them off it.
 *
 * Rare lapses (mistakes.ts) make it blind to one plane for a while; they
 * are what lets a demo crash now and then, for real.
 */
import {
  DEMO_MEAN_DAYS_BETWEEN_MISTAKES,
  DEMO_PLANS_PER_CYCLE,
  DEMO_REPLAN_INTERVAL,
  DEMO_RETRY_INTERVAL,
  DEMO_SEPARATION,
  DEMO_TRACK_STEP,
  PLANE_SPEED,
} from "../../config";
import { DAY_SECONDS } from "../daytime";
import { isRunwayClosed } from "../departures";
import { isInAirspace } from "../layout";
import { isSteerable, startPath } from "../path";
import type { GameState, Plane, Rng } from "../types";
import { apply, isValid, pathLength, plan, planScore } from "./approach";
import { chooseMistake, lapseCandidates } from "./mistakes";
import {
  hitsPeak,
  isAirborne,
  isImminentDeparture,
  minSeparation,
  predictTrack,
  type Track,
} from "./track";

/** A bare plane this many seconds from the airspace is treated as inside it. */
const ENTRY_LOOKAHEAD = 8;

/** Seconds before a lapse that found nobody to be blind to tries again. */
const LAPSE_RETRY = 5;

export interface Autopilot {
  rng: Rng;
  /** Mean sim-seconds between lapses (Infinity: never). */
  meanMistakeSeconds: number;
  /** Sim-seconds until the next lapse. */
  mistakeIn: number;
  /** The plane it can't see right now, until `clock` reaches `until`. */
  blind: { planeId: number; until: number } | null;
  /** Sim-seconds the autopilot has been flying. */
  clock: number;
  /** Seconds since the last look at the traffic. */
  sinceReplan: number;
  /** `clock` when each plane last got a plan. */
  lastTry: Map<number, number>;
}

/** Exponential wait with the given mean. */
function drawInterval(rng: Rng, mean: number): number {
  return mean === Infinity ? Infinity : -Math.log(1 - rng()) * mean;
}

export function createAutopilot(
  rng: Rng,
  options: { meanMistakeSeconds?: number } = {},
): Autopilot {
  const mean = options.meanMistakeSeconds ?? DEMO_MEAN_DAYS_BETWEEN_MISTAKES * DAY_SECONDS;
  return {
    rng,
    meanMistakeSeconds: mean,
    mistakeIn: drawInterval(rng, mean),
    blind: null,
    clock: 0,
    // Look at the first plane at once.
    sinceReplan: DEMO_REPLAN_INTERVAL,
    lastTry: new Map(),
  };
}

/**
 * Advance the autopilot by `dt` seconds of sim time. Call before each
 * `step` of the demo shift.
 */
export function autopilotStep(pilot: Autopilot, state: GameState, dt: number): void {
  if (state.phase !== "playing") return;
  pilot.clock += dt;
  pilot.mistakeIn -= dt;
  if (pilot.blind && pilot.clock >= pilot.blind.until) pilot.blind = null;
  if (pilot.mistakeIn <= 0) startLapse(pilot, state);

  pilot.sinceReplan += dt;
  if (pilot.sinceReplan < DEMO_REPLAN_INTERVAL) return;
  // Planes still waiting for their turn: look again at the very next step.
  const backlog = replan(pilot, state);
  pilot.sinceReplan = backlog ? DEMO_REPLAN_INTERVAL : 0;
}

/** A lapse is due: go blind to a plane, or try again shortly if there is none to pick. */
function startLapse(pilot: Autopilot, state: GameState): void {
  const mistake = chooseMistake(lapseCandidates(state.planes, state.world), pilot.rng);
  if (!mistake) {
    pilot.mistakeIn = LAPSE_RETRY;
    return;
  }
  pilot.blind = { planeId: mistake.planeId, until: pilot.clock + mistake.seconds };
  pilot.mistakeIn = drawInterval(pilot.rng, pilot.meanMistakeSeconds);
}

/** Does `a` give way to `b` when their tracks conflict? */
function yields(a: Plane, b: Plane): boolean {
  // The game flies departures: nobody argues with them.
  if (!isSteerable(b)) return true;
  if (a.pathAnchored !== b.pathAnchored) return !a.pathAnchored;
  return a.id > b.id;
}

/** Closest `track` comes to any of `others`. */
function minClearance(track: Track, others: readonly Track[]): number {
  let best = Infinity;
  for (const o of others) best = Math.min(best, minSeparation(track, o));
  return best;
}

/**
 * One look at the traffic: replan whoever needs it, at most
 * `DEMO_PLANS_PER_CYCLE` planes at a time.
 * @returns true if planes were left waiting for the next look.
 */
function replan(pilot: Autopilot, state: GameState): boolean {
  const { world } = state;
  const blindId = pilot.blind?.planeId ?? null;
  // In the air, or about to be (a departure rolling out must be kept clear of).
  const airborne = state.planes.filter((p) => isAirborne(p) || isImminentDeparture(p));
  const tracks = new Map<number, Track>();
  for (const p of airborne) tracks.set(p.id, predictTrack(p, world));
  // Forget the planes that are gone.
  for (const id of pilot.lastTry.keys()) {
    if (!state.planes.some((p) => p.id === id)) pilot.lastTry.delete(id);
  }

  // Planes the autopilot flies: bare ones first (inside the airspace nobody
  // else steers them, and the planning budget must never run out before
  // they get a path), then anchored ones, then oldest first.
  const flown = state.planes.filter(isSteerable);
  flown.sort(
    (a, b) =>
      Number(a.path.length > 0) - Number(b.path.length > 0) ||
      Number(b.pathAnchored) - Number(a.pathAnchored) ||
      a.id - b.id,
  );

  let budget = DEMO_PLANS_PER_CYCLE;
  let backlog = false;
  for (const plane of flown) {
    const mine = tracks.get(plane.id) ?? predictTrack(plane, world);
    // A blind plane sees nobody; everybody else doesn't see it.
    const seen =
      plane.id === blindId ? [] : airborne.filter((o) => o.id !== plane.id && o.id !== blindId);
    const seenTracks = seen.map((o) => tracks.get(o.id)!);

    // A bare plane outside the airspace is safe: it can't collide there and
    // the game keeps it apart from other traffic (core/avoidance.ts). So it
    // is only the autopilot's business once it is routed, inside, or about
    // to be (a bare plane inside is not steered by anyone).
    const bare = plane.path.length === 0;
    const inside = isInAirspace(plane.pos, world);
    const entering = mine.some(
      (p, i) => p !== null && i * DEMO_TRACK_STEP <= ENTRY_LOOKAHEAD && isInAirspace(p, world),
    );
    const idle = bare && (inside || entering);
    const exposed = !bare || inside || entering;
    const conflict =
      exposed &&
      seen.some(
        (o) => yields(plane, o) && minSeparation(mine, tracks.get(o.id)!) < DEMO_SEPARATION,
      );
    const lethal = hitsPeak(mine, state.streams);
    // On an approach to a runway a departure has just closed: it would be
    // sent around over the take-off, so it is pulled off the approach now.
    const runway = state.runways.find((r) => r.color === plane.color);
    const closed =
      plane.pathAnchored && runway !== undefined && isRunwayClosed(runway, state.planes);
    const urgent = idle || conflict || lethal || closed;
    const sinceTry = pilot.clock - (pilot.lastTry.get(plane.id) ?? -Infinity);
    const retryDue = sinceTry >= DEMO_RETRY_INTERVAL;
    if (!urgent && (plane.pathAnchored || !retryDue)) continue;
    // An urgent plane the last plan couldn't help is not planned again at
    // once: that would cost a full search every step for nothing.
    if (!idle && sinceTry < DEMO_REPLAN_INTERVAL) continue;

    if (budget === 0) {
      backlog = true;
      continue;
    }
    budget--;
    pilot.lastTry.set(plane.id, pilot.clock);
    const etas = flown
      .filter((p) => p.pathAnchored && p.id !== plane.id && p.id !== blindId)
      .map((p) => ({ color: p.color, eta: pathLength(p.pos, p.path) / PLANE_SPEED }));
    const best = plan(plane, runway, { state, others: seenTracks, etas });
    const valid = best !== null && isValid(best);
    // A retry only upgrades to a safe landing approach.
    if (!urgent && !(best && valid && best.anchored)) continue;
    // Bare is safe from other traffic out there, not from a black stream: a
    // plane heading into one takes any route that avoids it.
    const escapes = lethal && best !== null && !best.lethal;
    if (!valid && !inside && !entering && !escapes) {
      // Nothing safe to fly and the plane is outside the airspace: take its
      // path away. Bare is safe out there (see above); a bad route is not.
      if (plane.phase === "flying" && plane.path.length > 0) {
        startPath(plane);
        tracks.set(plane.id, predictTrack(plane, world));
      }
      continue;
    }
    if (!best) continue;
    // Never swap a working path for one that is not safer.
    const current = idle ? -Infinity : planScore(minClearance(mine, seenTracks), lethal);
    if (!valid && planScore(best.clearance, best.lethal) <= current) continue;

    apply(plane, best, state);
    tracks.set(plane.id, best.track);
  }
  return backlog;
}
