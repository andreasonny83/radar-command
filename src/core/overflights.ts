/**
 * Overflights: planes of outside airlines crossing the map. Light grey with
 * the colour bands of their company, they fly one straight track at cruise
 * speed and the player can't touch them (`isSteerable` is false for the
 * `overflight` phase), but they are real traffic inside the airspace: an
 * arrival that crosses their track crashes into them like into any plane.
 *
 * Two kinds of plane are exempt (see `canCollide`): other overflights and
 * departures. Overflights never turn, so the game can't let two of them
 * spoil a shift, and the player has no way to separate them from the
 * departures the game flies itself.
 *
 * They begin on the second game day and then come at a steady, low rate
 * (`OVERFLIGHT_INTERVAL_MIN`..`MAX`): the pace never ramps up with the shift.
 */
import {
  NEW_PLANE_HIGHLIGHT,
  OVERFLIGHT_INTERVAL_MAX,
  OVERFLIGHT_INTERVAL_MIN,
  OVERFLIGHT_MAX_AT_ONCE,
} from "../config";
import { DAY_SECONDS } from "./daytime";
import { lerp } from "./math";
import { createPlane } from "./plane";
import { pickSpawn } from "./spawner";
import type { GameState, Plane, Rng } from "./types";

/** Shapes of the emblems on the planes (drawn in render/aircraft.ts `LOGO_PIECES`). */
export type LogoShape = "disc" | "diamond" | "triangle" | "chevron" | "cross" | "stripes";

/** An outside airline: its name, the colour of its bands and its emblem. */
export interface Airline {
  name: string;
  /** Hex colour of the fuselage band and tail. */
  band: string;
  /** Emblem on the fin and fuselage; every airline has its own. */
  logo: LogoShape;
}

/** The airlines whose planes cross the map. A plane picks one at random. */
export const AIRLINES: readonly Airline[] = [
  { name: "Skyline", band: "#0ea5e9", logo: "disc" },
  { name: "Nordair", band: "#16a34a", logo: "triangle" },
  { name: "Solaris", band: "#f97316", logo: "diamond" },
  { name: "Meridian", band: "#be123c", logo: "chevron" },
  { name: "Aurora", band: "#0d9488", logo: "stripes" },
  { name: "Pacifica", band: "#6366f1", logo: "cross" },
];

/** True once overflights fly: from the second game day on. */
export function overflightsOpen(elapsed: number): boolean {
  return elapsed >= DAY_SECONDS;
}

/** True for a plane the game flies across the map (see the file header). */
export function isOverflight(plane: Plane): boolean {
  return plane.phase === "overflight";
}

/**
 * Whether `a` and `b` may crash into each other (or even warn each other):
 * everything except overflight-with-overflight and overflight-with-departure.
 */
export function canCollide(a: Plane, b: Plane): boolean {
  if (a.color === "grey") return b.color !== "grey" && b.color !== "violet";
  if (b.color === "grey") return a.color !== "violet";
  return true;
}

/** Overflights on the map now. */
function overflightCount(planes: readonly Plane[]): number {
  let n = 0;
  for (const p of planes) if (isOverflight(p)) n++;
  return n;
}

/**
 * Run the overflight timer and send one over when it is due and a slot is
 * free. Same entry rules as arrivals (`pickSpawn`): off-screen, a track
 * aimed across the airspace, `inbound` until it arrives so its arrow shows.
 * Draws no random numbers before the second day, so earlier play is the
 * same as ever for a seeded run.
 * @returns the new plane, or null.
 */
export function scheduleOverflights(state: GameState, dt: number, rng: Rng): Plane | null {
  if (!overflightsOpen(state.elapsed)) return null;
  state.overflightTimer += dt;
  if (state.overflightTimer < state.overflightInterval) return null;
  // All slots busy: stay due without banking time, so one frees up to a
  // single plane, never a burst.
  if (overflightCount(state.planes) >= OVERFLIGHT_MAX_AT_ONCE) {
    state.overflightTimer = state.overflightInterval;
    return null;
  }
  state.overflightTimer -= state.overflightInterval;
  state.overflightInterval = lerp(OVERFLIGHT_INTERVAL_MIN, OVERFLIGHT_INTERVAL_MAX, rng());

  // Only the track matters: the spawner's runway colour is ignored.
  const spec = pickSpawn(state.world, state.viewAspect, ["red"], rng, state.liveView);
  const plane = createPlane(state.nextPlaneId++, "grey", spec.pos, spec.heading);
  plane.phase = "overflight";
  plane.canDepart = false;
  plane.inbound = true;
  plane.highlightUntil = state.elapsed + NEW_PLANE_HIGHLIGHT;
  plane.entry = { ...spec.entry };
  plane.overflight = { airline: Math.floor(rng() * AIRLINES.length) % AIRLINES.length };
  state.planes.push(plane);
  return plane;
}
