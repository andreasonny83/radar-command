/**
 * Leaderboard rules shared by the game and the API (api/*.ts).
 *
 * Pure: no DOM, no Node, and no imports at all. The Vercel functions run
 * this file as plain ES modules, where an extensionless import (the style
 * the rest of src/ uses, resolved by Vite) would fail at runtime.
 *
 * The browser uses these checks for instant feedback only; the server runs
 * the same ones again on every submit and is the one that decides.
 */

/** The three public boards: today, this week and every run ever. */
export type Board = "daily" | "weekly" | "all";

/** Boards in tab order. */
export const BOARDS: readonly Board[] = ["daily", "weekly", "all"];

/** Tab labels in the leaderboard panel. */
export const BOARD_LABELS: Record<Board, string> = {
  daily: "Today",
  weekly: "This week",
  all: "All-time",
};

/** How a rank on each board reads in the game-over result line. */
export const BOARD_RANK_LABELS: Record<Board, string> = {
  daily: "today",
  weekly: "this week",
  all: "all-time",
};

export function isBoard(value: unknown): value is Board {
  return value === "daily" || value === "weekly" || value === "all";
}

/** Rows per page of a board (daily and weekly boards are one page). */
export const BOARD_SIZE = 10;

/** Most rows the all-time board holds (paged `BOARD_SIZE` at a time). */
export const ALL_TIME_MAX = 50;

/** How many rows the API sends for `board`: the all-time top 50, else the top 10. */
export function boardLimit(board: Board): number {
  return board === "all" ? ALL_TIME_MAX : BOARD_SIZE;
}

/** Pages needed to show `entries` rows, `BOARD_SIZE` a page (at least one). */
export function pageCount(entries: number): number {
  return Math.max(1, Math.ceil(entries / BOARD_SIZE));
}

/** Nickname length, after trimming. */
export const NAME_MIN = 3;
export const NAME_MAX = 16;

/**
 * Allowed nicknames: letters, digits, space, `_`, `.` and `-`. Plain ASCII
 * keeps the board readable in the HUD font and rules out look-alike and
 * invisible characters (no profanity filter beyond that).
 */
export const NAME_RULE = /^[A-Za-z0-9 _.-]{3,16}$/;

/** What the name field says when a name breaks `NAME_RULE`. */
export const NAME_HINT = `${NAME_MIN}–${NAME_MAX} letters, digits, spaces or . _ -`;

/**
 * `raw` as it will be stored (trimmed, inner runs of spaces collapsed to
 * one), or null when it breaks `NAME_RULE`.
 */
export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return NAME_RULE.test(name) ? name : null;
}

/** Highest score the database accepts (a sanity cap, far above any real run). */
export const MAX_SCORE = 100_000;

/** A run token older than this (seconds) can no longer submit a score. */
export const RUN_MAX_AGE = 2 * 60 * 60;

/**
 * Largest value the API accepts for each part of a run's breakdown (a
 * sanity cap before the plausibility check; `seconds` is also bounded by
 * `RUN_MAX_AGE`).
 */
export const MAX_RUN_COUNT = 10_000;

/**
 * Seconds of slack allowed between the sim time a run reports and the
 * wall-clock time since its token was issued: the token request and the
 * first frame race each other at the start of a shift.
 */
export const RUN_CLOCK_SLACK = 5;

/**
 * Fastest game speed a shift can be flown at (the largest of `GAME_SPEEDS`
 * in config.ts, mirrored here because this file stays import-free): sim
 * seconds pass this many times faster than wall-clock ones.
 */
export const MAX_GAME_SPEED = 3;

/**
 * Could an honest player have produced this run?
 *
 * `run` is what the client reports: planes landed, departures flown out
 * and whole seconds of sim time flown since the second runway opened
 * (pauses excluded; see core/scoring.ts `ScoreBreakdown`, which this
 * mirrors so the file stays import-free).
 *
 * `wallSeconds` is wall-clock time from the shift's start (when the run
 * token was issued) to the submit. It includes pauses, the crash cinematic
 * and the time spent typing a name, so it is only ever an upper bound on
 * the time actually flown: `run.seconds`, a part of that, can't honestly
 * exceed it (give or take `RUN_CLOCK_SLACK`), except that a faster game speed
 * makes sim time run ahead of the wall clock: up to `MAX_GAME_SPEED` times.
 *
 * Called with whole numbers in [0, MAX_RUN_COUNT] and `wallSeconds` ≥ 0
 * (the API checks both before asking).
 */
export function isPlausibleRun(
  run: { landed: number; departed: number; seconds: number },
  wallSeconds: number,
): boolean {
  if (run.seconds > wallSeconds * MAX_GAME_SPEED + RUN_CLOCK_SLACK) return false;
  // TODO(you): bound each part by what the shift's length allows, against
  // `run.seconds` (sim time, now known not to be inflated):
  //   - landed: planes arrive at most one per spawn interval
  //     (SPAWN_INTERVAL_START = 4 s, down to SPAWN_INTERVAL_MIN = 1 s), and
  //     the first one has to fly in from the map edge before it can land;
  //   - departed: none before DEPARTURE_START_LANDINGS (4) landings, then
  //     at most one per DEPARTURE_INTERVAL_MIN (22 s), and each one needs
  //     its taxi, take-off and climb-out before it leaves the airspace.
  // Err generous: a false "implausible" costs an honest player their run.
  return run.landed >= 0 && run.departed >= 0;
}

/**
 * When `board`'s window opens, as of `now`: midnight UTC today (daily),
 * Monday 00:00 UTC this week (weekly), or the epoch (all-time). A run
 * counts on a board when it was submitted at or after this moment.
 */
export function boardStart(board: Board, now: Date): Date {
  if (board === "all") return new Date(0);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (board === "weekly") {
    // getUTCDay: 0 = Sunday … 6 = Saturday; days since Monday.
    const sinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - sinceMonday);
  }
  return start;
}

// ---------------------------------------------------------------------------
// Wire format (JSON bodies of the api/ routes)
// ---------------------------------------------------------------------------

/** `POST /api/run` → a signed run token, sent back with the run. */
export interface RunResponse {
  token: string;
}

/**
 * `POST /api/scores` body. The run's breakdown, not its score: the server
 * works the score out itself (core/scoring.ts `scoreOf`).
 */
export interface SubmitRequest {
  token: string;
  playerId: string;
  name: string;
  /** Planes landed. */
  landed: number;
  /** Departures flown out. */
  departed: number;
  /** Whole seconds of sim time since the second runway opened (pauses excluded). */
  seconds: number;
}

/** `POST /api/scores` → the player's rank on each board after this run. */
export interface SubmitResponse {
  ranks: Record<Board, number>;
  /** The player's best score ever (this run or an earlier one). */
  best: number;
}

/**
 * A player's standing on a board: their best run in the window, where it
 * ranks, and the breakdown its score came from (as the run reported it).
 */
export interface BoardStanding {
  rank: number;
  score: number;
  /** Planes landed. */
  landed: number;
  /** Departures flown out. */
  departed: number;
  /** Whole seconds of sim time flown since the second runway opened. */
  seconds: number;
  /** When that run was submitted (ISO 8601). */
  at: string;
}

/** One row of a board: a player's best run in the window. */
export interface BoardEntry extends BoardStanding {
  name: string;
  /** The requesting player's own row (only when `playerId` was sent). */
  me: boolean;
}

/** `GET /api/leaderboard?board=…&playerId=…` */
export interface BoardResponse {
  entries: BoardEntry[];
  /** The requesting player's own standing in the window, if any. */
  me: BoardStanding | null;
}

/** `{ error: code }` bodies of failed requests. */
export type ApiErrorCode =
  | "bad_request" // malformed body or query
  | "bad_name" // nickname breaks NAME_RULE
  | "bad_token" // run token forged or tampered with
  | "expired" // run token older than RUN_MAX_AGE
  | "implausible" // isPlausibleRun said no
  | "duplicate" // this run was already submitted
  | "rate_limited" // too many submits from one address
  | "server"; // database or configuration trouble

/** Loose UUID check for `playerId` (any version: it's only a grouping key). */
export const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
