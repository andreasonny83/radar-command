/**
 * Conflict advice: what the game asks Jev about a predicted collision.
 *
 * Detecting a conflict is geometry (core/conflicts.ts) and stays in code,
 * offline. Judging it is the fuzzy part: how urgent is this one, and which
 * of the two planes should the player redirect? The game sends each
 * conflict's *facts* to `POST /api/conflicts`, which puts them to Jev
 * (a TypeSafe System One model) and returns typed verdicts. The browser
 * never holds the API key, and never sends question text: the questions
 * live in api/_lib/advice.ts.
 *
 * This file is the contract shared by the browser and `api/` (like
 * core/leaderboard.ts), so it must stay import-free.
 */

/** Colours a plane can wear (mirrors `PlaneColor` in core/types.ts). */
export type AdviceColor = "red" | "blue" | "yellow" | "violet";
export const ADVICE_COLORS: readonly AdviceColor[] = ["red", "blue", "yellow", "violet"];

/** What Jev is told about one of the two planes. */
export interface AdvicePlane {
  color: AdviceColor;
  /** An arrival to land, or a departure the game flies out of the field. */
  kind: "arrival" | "departure";
  /** Whether the player can redraw its path (departures climbing out can't). */
  steerable: boolean;
  /** Its path is locked onto a runway threshold: it is on final approach. */
  committedToLanding: boolean;
  /** Waypoints left on its drawn path (0: it flies straight on). */
  pathPoints: number;
}

/** One predicted collision, as facts. */
export interface AdviceConflict {
  /** `"<lowId>:<highId>"`: identifies the pair, echoed back in the verdicts. */
  key: string;
  /** Seconds until the planes' closest approach. */
  seconds: number;
  /** Their closest approach (world units). */
  miss: number;
  /** Below this gap (world units) planes collide. */
  collisionDistance: number;
  /** Angle between their headings, 0-180 degrees (180 is head-on, 0 is overtaking). */
  angle: number;
  a: AdvicePlane;
  b: AdvicePlane;
}

/** Most conflicts sent in one request (the soonest ones). */
export const MAX_ADVICE_CONFLICTS = 4;

/** `POST /api/conflicts` body. */
export interface AdviceRequest {
  /** The shift's run token (see `POST /api/run`): only real shifts may ask. */
  token: string;
  conflicts: AdviceConflict[];
}

/** Which plane of a pair the player should redirect. */
export type RerouteAdvice = "a" | "b" | "either";

/** Jev's verdict on one conflict. */
export interface AdviceVerdict {
  /**
   * Urgency, 0-2 (probability-weighted, so it can fall between levels):
   * 0 minor, 1 act soon, 2 act now.
   */
  severity: number;
  /** Jev's confidence in `severity`, 0-1. */
  severityConfidence: number;
  /** Which plane to redirect, already fitted to who can be steered. */
  reroute: RerouteAdvice;
  /** Jev's confidence in `reroute`, 0-1. */
  rerouteConfidence: number;
}

/** `POST /api/conflicts` reply: a verdict per conflict key. */
export interface AdviceResponse {
  verdicts: Record<string, AdviceVerdict>;
}

/**
 * The reroute hint is only shown at or above this confidence. Confidence
 * says how concentrated Jev's answer is, not whether it's right: 0.5 is a
 * starting guess to tune against real games.
 */
export const REROUTE_MIN_CONFIDENCE = 0.5;

/** Whole-number urgency level for a verdict's `severity`. */
export function severityLevel(severity: number): 0 | 1 | 2 {
  return Math.min(2, Math.max(0, Math.round(severity))) as 0 | 1 | 2;
}

/** Key format of `AdviceConflict.key`. */
export const PAIR_KEY_RULE = /^\d{1,7}:\d{1,7}$/;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const isNumberIn = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

function isAdvicePlane(x: unknown): x is AdvicePlane {
  return (
    isObject(x) &&
    ADVICE_COLORS.includes(x.color as AdviceColor) &&
    (x.kind === "arrival" || x.kind === "departure") &&
    typeof x.steerable === "boolean" &&
    typeof x.committedToLanding === "boolean" &&
    isNumberIn(x.pathPoints, 0, 10_000)
  );
}

/** Is `x` a well-formed `AdviceConflict`? (Ranges are generous: it's a sanity check.) */
export function isAdviceConflict(x: unknown): x is AdviceConflict {
  return (
    isObject(x) &&
    typeof x.key === "string" &&
    PAIR_KEY_RULE.test(x.key) &&
    isNumberIn(x.seconds, 0, 600) &&
    isNumberIn(x.miss, 0, 1000) &&
    isNumberIn(x.collisionDistance, 0, 1000) &&
    isNumberIn(x.angle, 0, 180) &&
    isAdvicePlane(x.a) &&
    isAdvicePlane(x.b)
  );
}
