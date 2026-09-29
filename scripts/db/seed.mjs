#!/usr/bin/env node
/**
 * Fills the leaderboard with made-up runs, to see the boards with real
 * data (paging, columns, the player's own row) without playing 100 shifts.
 *
 * Every seeded row is tagged with `ip_hash = 'seed-test'` (a real row
 * holds an HMAC of the caller's address, so it can never match), which is
 * how `--clear` and `--status` find them again and why they never count
 * against anyone's rate limit.
 *
 * Each run is plausible on its own terms: a breakdown (landed, departed,
 * seconds flown) scored by the game's own `scoreOf` (src/core/scoring.ts),
 * a nickname that passes `NAME_RULE`, and a submit time spread over the
 * three board windows: about a fifth today, a fifth earlier this week, the
 * rest over the last `--days` days. Some players get more than one run, so
 * the boards' "best run per player" rule has something to pick from.
 *
 * Node runs the two src/core files directly (they're import-free, and
 * Node 24 strips TypeScript types on load), so seeds always score the way
 * the game does.
 *
 * The database is whichever `DATABASE_URL` points at: `.env` for local
 * runs, or the environment, which wins over `.env`. Seeding the database
 * the deployed game uses puts these names on its public boards: clear
 * them before anyone sees.
 *
 * Usage:
 *   npm run db:seed                      100 runs from 70 players
 *   npm run db:seed -- --count 300 --players 120 --days 90
 *   npm run db:seed -- --status          how many seeded rows there are
 *   npm run db:seed -- --clear           delete every seeded row
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Pool } from "@neondatabase/serverless";
import { boardStart, MAX_RUN_COUNT, NAME_RULE, RUN_MAX_AGE } from "../../src/core/leaderboard.ts";
import { scoreOf } from "../../src/core/scoring.ts";

/** The `ip_hash` every seeded row carries. */
const SEED_TAG = "seed-test";

/** Nickname stems; past the first round they get a suffix ("Maverick 2"). */
const NAMES = [
  "Maverick", "SkyQueen", "tower_ops", "Jet Lag", "R.Flyer", "Glide-Path", "nightowl",
  "ATC Nerd", "Holding 7", "LowAndSlow", "Vector", "Squawk", "Ground Ctl", "FinalApproach",
  "Tailwind", "Crosswind", "Flaps 30", "Mayday Mia", "Rotate", "V1 Cut", "GoAround",
  "Taxi Tom", "Beacon", "Runway 27L", "Glideslope",
]; // prettier-ignore
const SUFFIXES = ["", " 2", "_x", " Jr", "99", ".b", " III"];

/** A whole number in [lo, hi]. */
const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** Player `i`'s nickname, unique for the first NAMES × SUFFIXES players. */
function nameFor(i) {
  const stem = NAMES[i % NAMES.length];
  const suffix = SUFFIXES[Math.floor(i / NAMES.length) % SUFFIXES.length];
  // Long stems can overflow NAME_MAX with a suffix: trim the stem to fit.
  const name = (stem.slice(0, 16 - suffix.length) + suffix).trim();
  if (!NAME_RULE.test(name)) throw new Error(`seed name breaks NAME_RULE: "${name}"`);
  return name;
}

/**
 * A believable shift: 1–15 minutes flown, a landing every 18–35 s, a
 * departure per 4–9 landings. Scored by the game's `scoreOf`.
 */
function randomRun() {
  const seconds = rnd(60, 900);
  const landed = Math.max(1, Math.round(seconds / rnd(18, 35)));
  const departed = Math.round(landed / rnd(4, 9));
  const breakdown = { landed, departed, seconds };
  return { ...breakdown, score: scoreOf(breakdown) };
}

/**
 * When run `i` was submitted: bucket 0 today, 1 earlier this week (today
 * on a Monday, when the week is today), else up to `days` days back. Never
 * in the future.
 */
function randomTime(i, now, days) {
  const dayStart = boardStart("daily", now).getTime();
  const weekStart = boardStart("weekly", now).getTime();
  const t = now.getTime();
  const bucket = i % 5;
  if (bucket === 0 || (bucket === 1 && weekStart === dayStart)) return new Date(rnd(dayStart, t));
  if (bucket === 1) return new Date(rnd(weekStart, dayStart - 1));
  return new Date(t - rnd(2 * 86_400_000, Math.max(2, days) * 86_400_000));
}

/** `--name value` as a whole number in [min, max], or `fallback` when absent. */
function intOption(values, name, fallback, min, max) {
  if (values[name] === undefined) return fallback;
  const n = Number(values[name]);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`--${name} wants a whole number from ${min} to ${max}`);
  }
  return n;
}

async function main() {
  const { values } = parseArgs({
    options: {
      count: { type: "string" },
      players: { type: "string" },
      days: { type: "string" },
      clear: { type: "boolean", default: false },
      status: { type: "boolean", default: false },
    },
  });
  const count = intOption(values, "count", 100, 1, 5_000);
  const players = intOption(values, "players", Math.min(70, count), 1, count);
  const days = intOption(values, "days", 60, 2, 3_650);

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (put it in .env, or in the environment)");
  }
  // Say which database this is, never the credentials.
  console.log(`database: ${new URL(url).host}${new URL(url).pathname}`);

  const pool = new Pool({ connectionString: url });
  try {
    if (values.status) {
      const { rows } = await pool.query(
        `select count(*)::int as runs, count(distinct player_id)::int as players,
           min(created_at) as oldest, max(created_at) as newest
         from scores where ip_hash = $1`,
        [SEED_TAG],
      );
      const r = rows[0];
      console.log(
        r.runs
          ? `${r.runs} seeded runs from ${r.players} players, ` +
              `${r.oldest.toISOString()} to ${r.newest.toISOString()}`
          : "no seeded runs",
      );
      return;
    }

    if (values.clear) {
      const { rowCount } = await pool.query("delete from scores where ip_hash = $1", [SEED_TAG]);
      console.log(`deleted ${rowCount} seeded runs`);
      return;
    }

    // The first `players` runs give each player one; the rest are repeat
    // runs by players picked at random.
    const ids = Array.from({ length: players }, () => randomUUID());
    const now = new Date();
    const rows = Array.from({ length: count }, (_, i) => {
      const p = i < players ? i : rnd(0, players - 1);
      const run = randomRun();
      return {
        runId: randomUUID(),
        playerId: ids[p],
        name: nameFor(p),
        ...run,
        // Wall-clock time from token to submit: the flying plus some
        // pauses and name typing, within what a token allows.
        durationS: Math.min(run.seconds + rnd(5, 90), RUN_MAX_AGE),
        at: randomTime(i, now, days),
      };
    });
    if (rows.some((r) => r.landed > MAX_RUN_COUNT || r.departed > MAX_RUN_COUNT)) {
      throw new Error("seed run over MAX_RUN_COUNT");
    }

    // One statement for the lot: a column per array, unnest pairs them up.
    const col = (key) => rows.map((r) => r[key]);
    const { rowCount } = await pool.query(
      `insert into scores
         (run_id, player_id, name, score, landed, departed, flown_s, duration_s, ip_hash, created_at)
       select run_id, player_id, name, score, landed, departed, flown_s, duration_s, $9::text, created_at
       from unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[], $5::int[], $6::int[],
         $7::int[], $8::int[], $10::timestamptz[])
         as t(run_id, player_id, name, score, landed, departed, flown_s, duration_s, created_at)`,
      [
        col("runId"),
        col("playerId"),
        col("name"),
        col("score"),
        col("landed"),
        col("departed"),
        col("seconds"),
        col("durationS"),
        SEED_TAG,
        col("at"),
      ],
    );
    const scores = rows.map((r) => r.score);
    console.log(
      `seeded ${rowCount} runs from ${players} players ` +
        `(scores ${Math.min(...scores)}–${Math.max(...scores)}, over the last ${days} days)`,
    );
    console.log("remove them with: npm run db:seed -- --clear");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`seed failed: ${err.message}`);
  process.exitCode = 1;
});
