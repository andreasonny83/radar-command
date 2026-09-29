/**
 * The shift's score, built from three parts: planes landed, departures
 * flown out (kept clear all the way off the map) and time survived.
 *
 * Pure and import-free, like core/leaderboard.ts: the Vercel functions in
 * api/ run this file as a plain ES module (an extensionless import would
 * fail there), and the server recomputes the score from the breakdown the
 * client sends rather than trusting a total.
 */

/** What a shift is scored on. Whole, non-negative numbers. */
export interface ScoreBreakdown {
  /** Planes landed (`GameState.landed`). */
  landed: number;
  /** Departures that left the map (`GameState.departed`). */
  departed: number;
  /** Whole seconds of shift flown: sim time, so pauses don't count. */
  seconds: number;
}

/** Points per plane landed. */
export const LANDING_POINTS = 10;

/**
 * Points per departure flown out. More than a landing: the player can't
 * steer it, only keep everything else clear of its runway and climb-out.
 */
export const DEPARTURE_POINTS = 15;

/** One point for every this-many seconds of shift survived. */
export const SECONDS_PER_TIME_POINT = 10;

/** Points `b.seconds` of shift earn on their own (the time trickle). */
export function timePoints(b: ScoreBreakdown): number {
  return Math.floor(b.seconds / SECONDS_PER_TIME_POINT);
}

/**
 * The shift's score from its breakdown. The HUD, the game-over screen and
 * the leaderboard API all call this, so they always agree.
 *
 * Contract: a whole number, 0 for an empty breakdown, and never smaller
 * when any part grows.
 *
 * TODO(you): decide how the three parts combine. Things to weigh:
 *   - a plain weighted sum (the body below) is easy to read off the
 *     game-over screen, line by line;
 *   - a multiplier (e.g. departures or a long survival boosting landing
 *     points) rewards juggling both kinds of traffic, but a player can no
 *     longer add the breakdown up in their head;
 *   - time should stay a bonus and a tiebreak: at 1 point per 10 s a
 *     10-minute shift earns ~60, about six landings' worth.
 */
export function scoreOf(b: ScoreBreakdown): number {
  return b.landed * LANDING_POINTS + b.departed * DEPARTURE_POINTS + timePoints(b);
}

/** The breakdown of a shift as it stands (`elapsed` in seconds, rounded down). */
export function breakdownOf(state: {
  landed: number;
  departed: number;
  elapsed: number;
}): ScoreBreakdown {
  return { landed: state.landed, departed: state.departed, seconds: Math.floor(state.elapsed) };
}
