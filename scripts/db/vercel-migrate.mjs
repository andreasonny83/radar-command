#!/usr/bin/env node
/**
 * Applies pending database migrations as part of a Vercel deployment build,
 * so a deploy never goes live ahead of the schema it needs.
 *
 * Wired in as the `vercel-build` npm script (package.json), which Vercel
 * runs instead of `build` when it exists:
 *
 *   vercel-build = node scripts/db/vercel-migrate.mjs && npm run build
 *
 * so a failed migration stops the build and the deployment never happens.
 * Local `npm run build` (and Storybook) don't touch a database.
 *
 * This only decides *whether* to migrate; the work is `migrate.mjs`, the
 * same runner as `npm run db:migrate` (transactional, an advisory lock so
 * two deployments building at once can't collide, and a checksum guard).
 * It migrates:
 *
 * - Production and Preview builds (`VERCEL_ENV`), against the
 *   `DATABASE_URL` set for that environment. With the Vercel ↔ Neon
 *   integration each preview deployment gets its own Neon branch, so a
 *   pull request's migrations run on a copy, not the live database. If
 *   Preview shares the production `DATABASE_URL` instead, a PR's
 *   migrations would run on the live database when its preview builds: set
 *   `SKIP_DB_MIGRATE=1` for Preview, or give it its own database.
 *
 * It skips, with a note in the build log and a zero exit (the game is
 * fully playable without the leaderboard, see CLAUDE.md):
 * - anything that isn't a Vercel Production/Preview build (a local
 *   `npm run vercel-build`, `vercel dev`);
 * - `SKIP_DB_MIGRATE=1` (or `true`);
 * - no `DATABASE_URL` in the environment (the leaderboard isn't set up).
 *
 * Everything else, including the database being unreachable, fails the
 * build: deploying code that expects a schema that isn't there is worse.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIGRATE = fileURLToPath(new URL("./migrate.mjs", import.meta.url));

const log = (msg) => console.log(`vercel-migrate: ${msg}`);

/** Why to skip the migration, or null to run it. */
function skipReason(env) {
  if (["1", "true"].includes(String(env.SKIP_DB_MIGRATE).toLowerCase())) {
    return "SKIP_DB_MIGRATE is set";
  }
  if (env.VERCEL_ENV !== "production" && env.VERCEL_ENV !== "preview") {
    return `not a Vercel Production/Preview build (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})`;
  }
  if (!env.DATABASE_URL) {
    return `DATABASE_URL is not set for ${env.VERCEL_ENV}: the leaderboard database isn't configured`;
  }
  return null;
}

const reason = skipReason(process.env);
if (reason) {
  log(`skipping migrations: ${reason}`);
} else {
  // The runner's Neon `Pool` speaks WebSocket; Node 22+ has it built in.
  if (typeof WebSocket === "undefined") {
    console.error(
      `vercel-migrate: this Node (${process.version}) has no global WebSocket, which the ` +
        "migration runner needs. Use Node 22 or newer (Project Settings → Node.js Version).",
    );
    process.exit(1);
  }
  log(`applying pending migrations (${process.env.VERCEL_ENV})`);
  const { status, error } = spawnSync(process.execPath, [MIGRATE], { stdio: "inherit" });
  if (error || status !== 0) {
    console.error("vercel-migrate: migration failed, stopping the build so nothing deploys.");
    process.exit(status ?? 1);
  }
  log("database is up to date");
}
