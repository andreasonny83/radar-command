-- 0002: store each run's breakdown next to its score (the scoring rework:
-- score = f(landed, departed, time flown), see src/core/scoring.ts).
--
-- Existing rows get 0s. No check constraints: the API validates the
-- values before inserting (api/scores.ts). `if not exists` because the
-- live database got these columns by hand before the migration runner.

-- Planes landed and departures flown out, as the client reported them.
alter table scores add column if not exists landed   int not null default 0;
alter table scores add column if not exists departed int not null default 0;
-- Seconds of sim time flown (pauses excluded).
alter table scores add column if not exists flown_s  int not null default 0;
