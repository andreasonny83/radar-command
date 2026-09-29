/**
 * `POST /api/scores` `{ token, playerId, name, landed, departed, seconds }`
 * → `{ ranks, best }`.
 *
 * The client sends the run's breakdown, never a score: the score is worked
 * out here with the game's own formula (src/core/scoring.ts `scoreOf`).
 *
 * Checks, in order, before anything is stored:
 * 1. the body's shape, the nickname (`NAME_RULE`) and each part's range;
 * 2. the run token's signature, and its age (`RUN_MAX_AGE`);
 * 3. each part against the time since the token was issued
 *    (`isPlausibleRun`), and the resulting score against `MAX_SCORE`;
 * 4. no more than `SUBMITS_PER_MINUTE` runs from the caller's address.
 * The insert itself refuses a token that was already used (unique
 * `run_id`). None of this proves a run was honest; it makes faking one
 * cost more than it's worth.
 */
import {
  BOARDS,
  MAX_SCORE,
  RUN_MAX_AGE,
  UUID_RULE,
  boardStart,
  MAX_RUN_COUNT,
  isPlausibleRun,
  normalizeName,
  type Board,
  type SubmitResponse,
} from "../src/core/leaderboard.js";
import { scoreOf } from "../src/core/scoring.js";
import { insertScore, playerRank, recentSubmits } from "./_lib/db.js";
import { fail, ipHash, json } from "./_lib/http.js";
import { verifyRun } from "./_lib/token.js";

/** Runs one address may submit per minute. */
const SUBMITS_PER_MINUTE = 5;

/** Is `value` a whole number in [0, MAX_RUN_COUNT]? */
function isCount(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_RUN_COUNT
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) return fail("bad_request");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("bad_request");
  }
  const { token, playerId, name: rawName, landed, departed, seconds } = body;
  if (
    typeof token !== "string" ||
    typeof playerId !== "string" ||
    !UUID_RULE.test(playerId) ||
    typeof rawName !== "string" ||
    !isCount(landed) ||
    !isCount(departed) ||
    !isCount(seconds)
  ) {
    return fail("bad_request");
  }
  const run = { landed, departed, seconds };
  const name = normalizeName(rawName);
  if (!name) return fail("bad_name");

  try {
    const claims = await verifyRun(token);
    if (!claims) return fail("bad_token");
    const elapsed = Date.now() / 1000 - claims.issuedAt;
    // A token from the future was signed with a clock we don't trust.
    if (elapsed < 0 || elapsed > RUN_MAX_AGE) return fail("expired");
    if (!isPlausibleRun(run, elapsed)) return fail("implausible");
    const score = scoreOf(run);
    if (score > MAX_SCORE) return fail("implausible");

    const ip = await ipHash(request);
    if ((await recentSubmits(ip)) >= SUBMITS_PER_MINUTE) return fail("rate_limited");

    const inserted = await insertScore({
      runId: claims.runId,
      playerId: playerId.toLowerCase(),
      name,
      score,
      ...run,
      durationS: Math.round(elapsed),
      ipHash: ip,
    });
    if (!inserted) return fail("duplicate");

    // Where the player stands now, on every board (their best, not
    // necessarily this run).
    const now = new Date();
    const standings = await Promise.all(
      BOARDS.map((board) => playerRank(boardStart(board, now), playerId.toLowerCase())),
    );
    const ranks = Object.fromEntries(
      BOARDS.map((board, i) => [board, standings[i]?.rank ?? 0]),
    ) as Record<Board, number>;
    const allTime = standings[BOARDS.indexOf("all")];
    const response: SubmitResponse = { ranks, best: allTime?.score ?? score };
    return json(response);
  } catch (err) {
    console.error("scores: submit failed", err);
    return fail("server");
  }
}
