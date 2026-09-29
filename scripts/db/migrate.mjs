#!/usr/bin/env node
/**
 * Applies the leaderboard's pending database migrations (db/migrations/).
 *
 * Every change to the database is a new file in db/migrations/, named
 * `NNNN_what_it_does.sql` (four digits, then lowercase words), and files
 * run in name order. A `schema_migrations` table records which files have
 * run, with a SHA-256 of each, so this script only ever applies the new
 * ones. For each pending file it:
 *
 * 1. opens a transaction and takes a transaction-level advisory lock, so
 *    two runs at once (two terminals, two deploys) can't both apply it
 *    (a session lock would be unsafe on Neon's pooled URL: PgBouncer may
 *    run the unlock on another connection);
 * 2. checks again, under the lock, that no one else applied it meanwhile;
 * 3. runs the whole file as one query, then records it, then commits. A
 *    failing statement rolls the whole file back: nothing is recorded,
 *    and the next run tries it again.
 *
 * Rules for migrations:
 * - Never edit a file once it has been applied anywhere: add a new one.
 *   The script refuses to run if an applied file's checksum has changed.
 * - One transaction per file, so no statements that can't run inside one
 *   (e.g. `create index concurrently`).
 *
 * The connection uses the Neon driver's WebSocket `Pool` (not the HTTP
 * `neon()` the API uses): it runs a file of several statements in one go,
 * and holds a real transaction across queries.
 *
 * The database is whichever `DATABASE_URL` points at: `.env` for local
 * runs, or the environment, which wins over `.env`, for another database:
 *   DATABASE_URL="postgresql://…" npm run db:migrate
 * (quote it: Neon URLs contain `&`, which the shell would otherwise cut at).
 *
 * Usage:
 *   npm run db:migrate               apply every pending migration
 *   npm run db:migrate -- --status   list applied and pending, change nothing
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** `0001_create_scores.sql`: four digits, an underscore, lowercase words. */
const FILE_RULE = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Any fixed number: the key every run of this script locks on. */
const LOCK_KEY = 7_214_001;

/** SHA-256 of a file's text (line endings normalised, so a checkout on Windows matches). */
function checksum(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

/** The migration files, in the order they apply: `{ name, sql, sum }`. */
async function readMigrations() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith(".sql")).sort();
  const bad = names.filter((n) => !FILE_RULE.test(n));
  if (bad.length) {
    throw new Error(`badly named migration(s): ${bad.join(", ")} (want NNNN_name.sql)`);
  }
  // Two files with one number would apply in an order that depends on their names.
  const numbers = names.map((n) => n.slice(0, 4));
  const dup = numbers.find((n, i) => numbers.indexOf(n) !== i);
  if (dup) throw new Error(`two migrations numbered ${dup}`);

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(MIGRATIONS_DIR + name, "utf8");
      return { name, sql, sum: checksum(sql) };
    }),
  );
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (put it in .env, or in the environment)");
  }
  // Say which database this is, never the credentials.
  console.log(`database: ${new URL(url).host}${new URL(url).pathname}`);

  const migrations = await readMigrations();
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    // `--status` only reads: on a database that has never been migrated,
    // there's no table yet, and so nothing applied.
    if (!statusOnly) {
      await client.query(`
        create table if not exists schema_migrations (
          name       text        primary key,
          checksum   text        not null,
          applied_at timestamptz not null default now()
        )`);
    }
    const {
      rows: [{ exists }],
    } = await client.query("select to_regclass('schema_migrations') is not null as exists");
    const { rows } = exists
      ? await client.query("select name, checksum from schema_migrations")
      : { rows: [] };
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    // An applied file that has changed since means this database and the
    // repo disagree about the schema: stop before making it worse.
    const edited = migrations.filter((m) => applied.has(m.name) && applied.get(m.name) !== m.sum);
    if (edited.length) {
      throw new Error(
        `applied migration(s) edited since: ${edited.map((m) => m.name).join(", ")}. ` +
          "Restore the file(s) and put the change in a new migration.",
      );
    }
    // Recorded here but gone from the repo: fine to go on, worth knowing.
    const known = new Set(migrations.map((m) => m.name));
    for (const name of applied.keys()) {
      if (!known.has(name)) console.warn(`warning: ${name} is applied but has no file`);
    }

    const pending = migrations.filter((m) => !applied.has(m.name));
    if (statusOnly) {
      for (const m of migrations)
        console.log(`${applied.has(m.name) ? "applied" : "pending"}  ${m.name}`);
      return;
    }
    if (!pending.length) {
      console.log("up to date: no pending migrations");
      return;
    }

    for (const m of pending) {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
        const done = await client.query("select 1 from schema_migrations where name = $1", [
          m.name,
        ]);
        if (done.rowCount) {
          await client.query("rollback");
          console.log(`skipped  ${m.name} (applied meanwhile)`);
          continue;
        }
        await client.query(m.sql);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
          m.name,
          m.sum,
        ]);
        await client.query("commit");
        console.log(`applied  ${m.name}`);
      } catch (err) {
        // A broken connection can fail the rollback too: report the first error.
        await client.query("rollback").catch(() => {});
        throw new Error(`${m.name} failed, rolled back: ${err.message}`, { cause: err });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`db:migrate: ${err.message}`);
  process.exitCode = 1;
});
