/**
 * `GET /api/leaderboard?board=daily|weekly|all&playerId=…` →
 * `{ entries, me }`: the top players on a board (best run each: 10 on
 * daily and weekly, 50 on all-time, see `boardLimit`; the panel pages
 * them) and, when `playerId` is given, that player's own rank and row.
 *
 * Anonymous requests are the same for everyone, so the CDN may serve them
 * for a few seconds; per-player ones are never cached.
 */
import {
  UUID_RULE,
  boardLimit,
  boardStart,
  isBoard,
  type BoardResponse,
} from "../src/core/leaderboard.js";
import { playerRank, topEntries } from "./_lib/db.js";
import { fail, json } from "./_lib/http.js";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const board = params.get("board") ?? "daily";
  const rawPlayer = params.get("playerId");
  if (!isBoard(board)) return fail("bad_request");
  if (rawPlayer !== null && !UUID_RULE.test(rawPlayer)) return fail("bad_request");
  const playerId = rawPlayer?.toLowerCase() ?? null;

  try {
    const since = boardStart(board, new Date());
    const [entries, me] = await Promise.all([
      topEntries(since, playerId, boardLimit(board)),
      playerId ? playerRank(since, playerId) : Promise.resolve(null),
    ]);
    const body: BoardResponse = { entries, me };
    return json(
      body,
      200,
      playerId ? {} : { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" },
    );
  } catch (err) {
    console.error("leaderboard: query failed", err);
    return fail("server");
  }
}
