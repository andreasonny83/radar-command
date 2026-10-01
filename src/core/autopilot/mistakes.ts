/**
 * The autopilot's rare lapses.
 *
 * A lapse is a blind spot: for `DEMO_BLIND_SECONDS` the autopilot cannot
 * see one plane. It leaves that plane out of every separation check (as the
 * plane to keep clear of, and for itself), so it may route traffic across
 * it. Nothing is scripted: the sim decides whether that ends in a crash, a
 * go-around or nothing.
 */
import { DEMO_BLIND_RANGE, DEMO_BLIND_SECONDS } from "../../config";
import { isInAirspace } from "../layout";
import { distance } from "../math";
import type { Plane, Rng, WorldSize } from "../types";
import { isAirborne } from "./track";

/** Which plane the autopilot goes blind to, and for how long. */
export interface Mistake {
  planeId: number;
  seconds: number;
}

/**
 * Planes a lapse could matter for: airborne inside the airspace with other
 * traffic close by. (Being blind to a plane alone in the sky changes nothing.)
 */
export function lapseCandidates(planes: readonly Plane[], world: WorldSize): Plane[] {
  const air = planes.filter((p) => isAirborne(p) && isInAirspace(p.pos, world));
  return air.filter((p) => air.some((o) => o !== p && distance(p.pos, o.pos) <= DEMO_BLIND_RANGE));
}

/**
 * Pick the lapse, or null to let this moment pass (the autopilot tries again
 * a few seconds later).
 *
 * Default: any candidate, for the standard length.
 */
export function chooseMistake(candidates: readonly Plane[], rng: Rng): Mistake | null {
  if (candidates.length === 0) return null;
  const victim = candidates[Math.floor(rng() * candidates.length)]!;
  return { planeId: victim.id, seconds: DEMO_BLIND_SECONDS };
}
