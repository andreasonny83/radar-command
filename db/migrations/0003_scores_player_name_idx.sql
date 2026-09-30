-- 0003: boards keep one entry per nickname on a browser, not one per
-- browser (people sharing a machine each get their own row): the "best run
-- per player" query is now `distinct on (player_id, lower(name))`, so index
-- it that way. Purely a speed-up: results don't depend on it.

create index if not exists scores_player_name_idx
  on scores (player_id, lower(name), score desc, created_at);
