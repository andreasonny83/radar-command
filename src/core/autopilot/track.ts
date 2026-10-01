/**
 * Predicted tracks: where a plane will be over the next few seconds if it
 * keeps to its path.
 *
 * The autopilot judges every plan on these. A track is a ghost copy of the
 * plane flown with the real `updatePlane` (the same trick `anchorPath` uses
 * for its dry run), so turn rates, path-following and the departures'
 * climb-out all behave as in the game. Wind and avoidance are left out: they
 * are not predictable, and the autopilot replans every few seconds anyway.
 */
import { DEMO_TRACK_HORIZON, DEMO_TRACK_STEP, DEMO_WIND_MARGIN, ROTATE_SPEED } from "../../config";
import { pointInRect } from "../geometry";
import { distance } from "../math";
import { updatePlane } from "../plane";
import { peakAhead } from "../windStreams";
import type { Plane, Vec2, WindStream, WorldSize } from "../types";

/** Samples in a track: now, then one per `DEMO_TRACK_STEP` up to the horizon. */
export const TRACK_SAMPLES = Math.floor(DEMO_TRACK_HORIZON / DEMO_TRACK_STEP) + 1;

/**
 * Where the plane is at each sample, or null once it is out of play (landed,
 * left, or never in the air). Sample `i` is `i * DEMO_TRACK_STEP` s from now.
 */
export type Track = (Vec2 | null)[];

/** Flying or climbing out: the planes that can collide. */
export function isAirborne(plane: Plane): boolean {
  return plane.phase === "flying" || plane.phase === "climbout";
}

/**
 * A departure about to take off: rolling, or cleared onto the runway. It is
 * not in the air yet, but it will be shortly, on a route the autopilot
 * can't change, so arrivals must keep clear of where it is going.
 */
export function isImminentDeparture(plane: Plane): boolean {
  const dep = plane.departure;
  return dep !== null && (plane.phase === "takeoff" || (plane.phase === "outbound" && dep.cleared));
}

/** A copy of `plane` that can be flown or re-routed without touching the original. */
export function ghostOf(plane: Plane): Plane {
  return {
    ...plane,
    pos: { ...plane.pos },
    path: plane.path.map((p) => ({ ...p })),
    ground: null,
    avoidTurn: 0,
    wind: { x: 0, y: 0 },
    windTurn: 0,
    departure: plane.departure ? { ...plane.departure } : null,
  };
}

/** The predicted track of `plane` along the path it has now. */
export function predictTrack(plane: Plane, world: WorldSize): Track {
  const ghost = ghostOf(plane);
  // Predict an imminent departure as if it lifted off now: late is not
  // knowable, and early is the safe side for the arrivals round it.
  if (isImminentDeparture(ghost)) {
    ghost.phase = "climbout";
    ghost.departure!.speed = Math.max(ghost.departure!.speed, ROTATE_SPEED);
  }
  // An anchored path ends on the threshold: once it is used up, the plane
  // has landed (the sim drops the anchor flag as the path runs out, so
  // remember it now).
  const landsAtEnd = ghost.pathAnchored;
  const track: Track = [];
  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const inPlay = isAirborne(ghost) && !(landsAtEnd && ghost.path.length === 0);
    if (!inPlay) {
      while (track.length < TRACK_SAMPLES) track.push(null);
      break;
    }
    track.push({ ...ghost.pos });
    updatePlane(ghost, DEMO_TRACK_STEP, world);
  }
  return track;
}

/** Closest two tracks come while both are in play (Infinity if they never share the air). */
export function minSeparation(a: Track, b: Track): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p && q) best = Math.min(best, distance(p, q));
  }
  return best;
}

/**
 * Does the track enter a black stream's band (plus `DEMO_WIND_MARGIN`)
 * at any time from when that stream turns active until its lethal peak is
 * over (see `peakAhead`)?
 * Only black streams kill; plain ones just erase the path, which the
 * autopilot repairs.
 */
export function hitsPeak(track: Track, streams: readonly WindStream[]): boolean {
  for (const stream of streams) {
    if (!stream.black) continue;
    const zone = {
      ...stream.rect,
      length: stream.rect.length + 2 * DEMO_WIND_MARGIN,
      width: stream.rect.width + 2 * DEMO_WIND_MARGIN,
    };
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (p && peakAhead(stream, i * DEMO_TRACK_STEP) && pointInRect(p, zone)) return true;
    }
  }
  return false;
}
