-- Leaderboard schema (Neon Postgres). Apply once per database / branch:
--   psql "$DATABASE_URL" -f db/schema.sql
-- or paste into the Neon SQL editor. Safe to re-run.
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
  -- Computed by the server from the parts below (src/core/scoring.ts).
  score       int         not null check (score between 0 and 100000),
  -- The run's breakdown, as the client reported it.
  landed      int         not null default 0 check (landed >= 0),
  departed    int         not null default 0 check (departed >= 0),
  -- Seconds of sim time flown (pauses excluded).
  flown_s     int         not null default 0 check (flown_s >= 0),
  -- Seconds from the token's issue to the submit (pauses included).
  duration_s  int         not null,
  -- HMAC of the caller's IP address, for rate limiting only.
  ip_hash     text        not null,
  created_at  timestamptz not null default now()
);

-- Columns added after the table first shipped: `create table if not exists`
-- skips an existing table, so bring older databases up to date here (the
-- API checks the values, so these skip the table's check constraints).
alter table scores add column if not exists landed   int not null default 0;
alter table scores add column if not exists departed int not null default 0;
alter table scores add column if not exists flown_s  int not null default 0;

-- Board windows (daily / weekly) filter on created_at.
create index if not exists scores_created_idx on scores (created_at);
-- Best run per player: distinct on (player_id) … order by score desc.
create index if not exists scores_player_idx  on scores (player_id, score desc, created_at);
-- Rate limit: recent runs from one address.
create index if not exists scores_ip_idx      on scores (ip_hash, created_at);
