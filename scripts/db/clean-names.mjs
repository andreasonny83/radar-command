#!/usr/bin/env node
/**
 * Finds offensive nicknames already on the leaderboard and, if you say so,
 * cleans them up. New submissions are checked as they arrive
 * (api/_lib/nameFilter.ts); this is for the names that got in before the
 * filter existed, or that a later, stricter filter would now refuse.
 *
 * It applies the same checks the API does to every distinct name in
 * `scores`: the word list and, with `--jev`, Jev. By default it only
 * REPORTS, changing nothing:
 *
 *   npm run db:clean-names                       list the names the word list rejects
 *   npm run db:clean-names -- --jev              also ask Jev about the rest (needs
 *                                                TYPESAFE_API_KEY; one question per name)
 *   npm run db:clean-names -- --apply            rename every run under a rejected name
 *                                                to "Anonymous" (scores stay on the board)
 *   npm run db:clean-names -- --apply --delete   delete those runs instead
 *
 * Read the list first: no filter is perfect, and Jev in particular is a
 * judgment call. `--apply` works on exactly the names it printed, in one
 * transaction. Renaming can't be undone from here (the old name isn't
 * kept), and neither can deleting: take a Neon branch or backup first if
 * the database matters.
 *
 * If Jev can't answer for some names (network, timeout, no key) they are
 * listed as "unchecked", nothing is assumed about them, and the exit code is
 * 1, so a partial run is never mistaken for a clean one. Names the word list
 * rejects are still handled either way.
 *
 * The database is whichever `DATABASE_URL` points at (`.env`, or the
 * environment, which wins). Needs Node 22.18+ (it loads the TypeScript
 * filter directly). Seeded rows (`npm run db:seed`) are checked like any.
 */
import { pathToFileURL } from "node:url";
import {
  NAME_OFFENSIVE_THRESHOLD,
  askJev,
  blockedByList,
  jevConfigured,
} from "../../api/_lib/nameFilter.ts";

/** What a renamed run is shown as (valid under NAME_RULE, core/leaderboard.ts). */
export const PLACEHOLDER = "Anonymous";

/** Print `--jev` progress every this many names. */
const PROGRESS_EVERY = 25;

/**
 * Check every distinct name in `scores` and, with `apply`, clean up the
 * rejected ones.
 *
 * @param db   `{ query(text, params) }` resolving to `{ rows, rowCount }`: a
 *             `pg`-style client (the script gives it a Neon `Pool` client).
 * @param opts `apply` change the database (else report only); `remove`
 *             delete instead of rename (needs `apply`); `useJev` ask Jev
 *             about names the list lets through; `ask` / `isBlocked` /
 *             `log` stand-ins for tests.
 * @returns `flagged` ({ name, runs, best, reason }), `unchecked` (names Jev
 *          couldn't judge) and `changed` (rows renamed or deleted).
 */
export async function cleanNames(
  db,
  {
    apply = false,
    remove = false,
    useJev = false,
    ask = askJev,
    isBlocked = blockedByList,
    log = console.log,
  } = {},
) {
  if (remove && !apply) throw new Error("--delete only makes sense with --apply");

  // Exact names, as stored: "Ann" and "ann" are separate rows here, and
  // each gets checked (the filter ignores case, so they'll agree).
  const { rows } = await db.query(
    `select name, count(*)::int as runs, max(score)::int as best
     from scores group by name order by max(score) desc, name`,
  );
  log(`${rows.length} distinct name(s) on the leaderboard`);

  const flagged = [];
  const unchecked = [];
  let asked = 0;
  for (const { name, runs, best } of rows) {
    if (isBlocked(name)) {
      flagged.push({ name, runs, best, reason: "word list" });
      continue;
    }
    if (!useJev) continue;
    try {
      const p = await ask(name);
      if (p >= NAME_OFFENSIVE_THRESHOLD) {
        flagged.push({ name, runs, best, reason: `Jev ${p.toFixed(2)}` });
      }
    } catch (err) {
      unchecked.push(name);
      log(`  could not ask Jev about "${name}": ${err instanceof Error ? err.message : err}`);
    }
    if (++asked % PROGRESS_EVERY === 0) log(`  asked Jev about ${asked} names…`);
  }

  if (!flagged.length) log("no names to clean up");
  else {
    log(`\n${flagged.length} name(s) rejected:`);
    for (const f of flagged) {
      log(
        `  ${f.name.padEnd(18)} ${String(f.runs).padStart(4)} run(s)  best ${f.best}  [${f.reason}]`,
      );
    }
  }
  if (unchecked.length) {
    log(`\n${unchecked.length} name(s) unchecked by Jev (see above): run again to retry them`);
  }

  let changed = 0;
  if (apply && flagged.length) {
    const names = flagged.map((f) => f.name);
    await db.query("begin");
    try {
      const result = remove
        ? await db.query("delete from scores where name = any($1::text[])", [names])
        : await db.query("update scores set name = $1 where name = any($2::text[])", [
            PLACEHOLDER,
            names,
          ]);
      changed = result.rowCount ?? 0;
      await db.query("commit");
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
    log(`\n${remove ? "deleted" : `renamed to "${PLACEHOLDER}"`}: ${changed} run(s)`);
  } else if (flagged.length) {
    log(
      "\nnothing changed (dry run). Re-run with --apply to rename these runs, or --apply --delete.",
    );
  }
  return { flagged, unchecked, changed };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const known = new Set(["--apply", "--delete", "--jev"]);
  const unknown = [...args].filter((a) => !known.has(a));
  if (unknown.length) throw new Error(`unknown option(s): ${unknown.join(" ")}`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (put it in .env, or in the environment)");
  if (args.has("--jev") && !jevConfigured()) {
    throw new Error("--jev needs TYPESAFE_API_KEY (put it in .env, or in the environment)");
  }
  // Say which database this is, never the credentials.
  console.log(`database: ${new URL(url).host}${new URL(url).pathname}`);

  // Same WebSocket `Pool` as migrate.mjs: a real transaction across queries.
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const { unchecked } = await cleanNames(client, {
      apply: args.has("--apply"),
      remove: args.has("--delete"),
      useJev: args.has("--jev"),
    });
    if (unchecked.length) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run as a script, not when a test imports `cleanNames`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`db:clean-names: ${err.message}`);
    process.exitCode = 1;
  });
}
