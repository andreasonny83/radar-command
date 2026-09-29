/// <reference types="node" />
/**
 * Leaderboard queries against Neon Postgres (schema in db/schema.sql).
 *
 * Uses Neon's HTTP driver: every query is one HTTPS request, with no
 * connection to open or pool to drain, which suits short-lived serverless
 * functions. `DATABASE_URL` is only ever read here, on the server.
 *
 * One row per submitted run; every board shows each player's best run in
 * its window (ties: the earlier run ranks higher).
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { BOARD_SIZE, type BoardEntry } from "../../src/core/leaderboard.js";

let client: NeonQueryFunction<false, false> | null = null;

/** The query function, created on first use (so a missing URL is a 500, not a crash at import). */
function sql(): NeonQueryFunction<false, false> {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = neon(url);
  return client;
}

/** Each player's best run submitted at or after `since`: one row per player. */
function bestRuns(since: Date) {
  return sql()`
    select distinct on (player_id) player_id, name, score, created_at
    from scores
    where created_at >= ${since}
    order by player_id, score desc, created_at asc`;
}

/** A new run. Returns false when `runId` was already submitted. */
export async function insertScore(row: {
  runId: string;
  playerId: string;
  name: string;
  score: number;
  /** The breakdown the score was computed from (see src/core/scoring.ts). */
  landed: number;
  departed: number;
  /** Seconds of sim time the client reports (`flown_s`). */
  seconds: number;
  durationS: number;
  ipHash: string;
}): Promise<boolean> {
  const inserted = await sql()`
    insert into scores
      (run_id, player_id, name, score, landed, departed, flown_s, duration_s, ip_hash)
    values (${row.runId}, ${row.playerId}, ${row.name}, ${row.score}, ${row.landed},
      ${row.departed}, ${row.seconds}, ${row.durationS}, ${row.ipHash})
    on conflict (run_id) do nothing
    returning id`;
  return inserted.length > 0;
}

/** Runs submitted from `ipHash` in the last minute (for the rate limit). */
export async function recentSubmits(ipHash: string): Promise<number> {
  const rows = await sql()`
    select count(*)::int as n from scores
    where ip_hash = ${ipHash} and created_at > now() - interval '1 minute'`;
  return Number(rows[0]?.n ?? 0);
}

/** The top `BOARD_SIZE` players since `since`, `me` set on `playerId`'s row. */
export async function topEntries(since: Date, playerId: string | null): Promise<BoardEntry[]> {
  const rows = await sql()`
    select name, score, created_at, coalesce(player_id = ${playerId}::uuid, false) as me
    from (${bestRuns(since)}) best
    order by score desc, created_at asc
    limit ${BOARD_SIZE}`;
  return rows.map((r, i) => ({
    rank: i + 1,
    name: String(r.name),
    score: Number(r.score),
    at: new Date(r.created_at as string).toISOString(),
    me: Boolean(r.me),
  }));
}

/**
 * `playerId`'s rank and best score since `since`, or null when they have
 * no run in that window. Rank = 1 + players whose best beats theirs.
 */
export async function playerRank(
  since: Date,
  playerId: string,
): Promise<{ rank: number; score: number } | null> {
  const rows = await sql()`
    with best as (${bestRuns(since)}),
    mine as (select score, created_at from best where player_id = ${playerId}::uuid)
    select mine.score,
      1 + (
        select count(*) from best b
        where b.score > mine.score or (b.score = mine.score and b.created_at < mine.created_at)
      )::int as rank
    from mine`;
  const row = rows[0];
  return row ? { rank: Number(row.rank), score: Number(row.score) } : null;
}
