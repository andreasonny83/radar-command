-- 0001: the leaderboard's `scores` table, as it first shipped.
--
-- Applied by `npm run db:migrate` (scripts/db/migrate.mjs). Written with
-- `if not exists` because databases created before the migration runner
-- already have this table: on those, this file changes nothing and is
-- only recorded as applied.
--
-- One row per submitted run (history is kept; boards pick each player's
-- best run in their window, see api/_lib/db.ts).

create table if not exists scores (
  id          bigint generated always as identity primary key,
  -- The run token's id: one submit per token (blocks replays).
  run_id      uuid        not null unique,
  -- Anonymous id the browser keeps in localStorage; groups a player's runs.
  player_id   uuid        not null,
  name        text        not null check (char_length(name) between 3 and 16),
  -- Computed by the server from the run's breakdown (src/core/scoring.ts).
  score       int         not null check (score between 0 and 100000),
  -- Seconds from the token's issue to the submit (pauses included).
  duration_s  int         not null,
  -- HMAC of the caller's IP address, for rate limiting only.
  ip_hash     text        not null,
  created_at  timestamptz not null default now()
);

-- Board windows (daily / weekly) filter on created_at.
create index if not exists scores_created_idx on scores (created_at);
-- Best run per player: distinct on (player_id) … order by score desc.
create index if not exists scores_player_idx  on scores (player_id, score desc, created_at);
-- Rate limit: recent runs from one address.
create index if not exists scores_ip_idx      on scores (ip_hash, created_at);
