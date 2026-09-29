# Leaderboard — design

Date: 2026-09-29
Status: approved in conversation, implemented

## Goal

A persistent, public, arcade-style leaderboard for Radar Command, backed by
Neon Postgres and served by Vercel Functions next to the static Vite game.

Success means:

- after a crash the player types a nickname and submits the shift's score;
- they see where it placed today, this week and all-time;
- boards (today, this week, all-time) show each player's best shift, top 10,
  plus the player's own rank when outside it;
- the boards open from the start and game-over screens, the help panel and
  the `L` key (pausing a running shift, like help);
- the game stays fully playable with the API down or not deployed;
- no new console errors; every Storybook story renders.

## Decisions

- **Identity:** nickname only (3–16 chars, `[A-Za-z0-9 _.-]`, trimmed,
  inner spaces collapsed), remembered in `localStorage`, plus an anonymous
  random `playerId` (UUID in `localStorage`) grouping one browser's runs.
  No accounts.
- **Anti-cheat:** plausibility, not proof: a server-signed run token issued
  at shift start, the score checked against the time since (`isPlausibleScore`),
  a 2 h token lifetime, one submit per token, 5 submits/min per address.
- **Boards:** daily (from 00:00 UTC), weekly (from Monday 00:00 UTC),
  all-time; best run per player; ties go to the earlier run.

## Architecture

```
browser (Vite app)                 Vercel Functions (/api)            Neon Postgres
src/net/leaderboardApi.ts  ──►  api/run.ts         (sign token)
                           ──►  api/scores.ts      (validate+insert) ──► scores table
                           ──►  api/leaderboard.ts (top 10 + me)     ──► scores table
```

- The browser never sees `DATABASE_URL`; only the functions talk to Neon,
  over its HTTP driver (`@neondatabase/serverless`, server-only, so not in
  the Licenses panel).
- Handlers are Web-standard (`export async function POST(request: Request)`).
- Pure shared rules live in `src/core/leaderboard.ts` (no imports at all, so
  Vercel's plain-ESM runtime can load it); the server re-checks everything.
- `vite-plugins/apiDev.ts` serves `api/*.ts` from `npm run dev` (Node
  request ⇄ Web `Request`/`Response`, env from `.env` via `loadEnv`).

## Database (`db/schema.sql`)

One row per submitted run (`run_id` unique, `player_id`, `name`, `score`,
`duration_s`, `ip_hash`, `created_at`), indexes on `created_at`,
`(player_id, score desc, created_at)` and `(ip_hash, created_at)`.
Boards use `distinct on (player_id)` for each player's best in the window;
rank = 1 + players whose best beats it.

## API

| Route | Does |
|---|---|
| `POST /api/run` | `{ token }` = `runId.issuedAt.HMAC-SHA256`. Stateless. |
| `POST /api/scores` `{ token, playerId, name, score }` | Checks shape, name, token signature and age, plausibility, rate limit; inserts (duplicate run → 409). Returns `{ ranks: { daily, weekly, all }, best }`. |
| `GET /api/leaderboard?board=&playerId=` | `{ entries, me }`; CDN-cacheable (`s-maxage=15, stale-while-revalidate=60`) when anonymous. |

Errors: `{ error: code }` with 400 / 401 / 409 / 429 / 500; the client maps
codes to short messages (`errorMessage` in `src/net/leaderboardApi.ts`).

Env: `DATABASE_URL`, `LEADERBOARD_SECRET` (32+ chars). See `.env.example`.

## UI

- Game-over overlay: name field (prefilled), SUBMIT SCORE, status line
  ("#4 today · #12 this week · #87 all-time"). States: ready, sending, done,
  error (retryable), unavailable (offline run, zero score, refused).
  On a mouse/keyboard screen the name field takes focus, so Enter submits;
  once submitted (or Esc) Enter means "try again" again. Keys typed in the
  field never reach shortcuts or panning.
- Start overlay: LEADERBOARD button. Help panel footer: Leaderboard link.
  `L` opens the panel; Esc / L / ✕ / backdrop close it; ← → switch tabs.
- Panel: tabs, top 10 with gold/silver/bronze ranks, the player's row
  highlighted ("YOU"), or appended after a gap when outside the top 10;
  loading, empty and offline states. Last tab remembered.
- Storybook: "HUD/Leaderboard" (every panel and form state, canned data),
  plus "HUD/Elements" SubmitForm and LeaderboardPanel.

## Out of scope

Accounts, profanity filtering beyond the charset, replay verification,
score deletion / admin UI. Tests: `CLAUDE.md` says to ignore them for now;
`src/core/leaderboard.ts` is pure and easy to cover later.
