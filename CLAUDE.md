# CLAUDE.md

**Important: Ignore tests until further notice. The current test suite is incomplete and may not reflect the final game logic.**

## Git

**Never commit or push.** Git history is the user's call: leave every change uncommitted in the working tree, even when a skill or plan says to commit. At the end of a task, tell the user the work is ready and list the changed files, with a suggested commit message; they decide how to commit, split or push it. `.claude/settings.json` denies `git commit` and `git push`, so an attempt is blocked anyway. Don't try to work around the block. Read-only git (`status`, `diff`, `log`, `show`) and `git mv` are fine.

## Project Overview

This project is an Air Traffic Control game, inspired by classic mobile games. The player drags flight paths from aircraft to their matching colored runways, attempting to land as many planes as possible without causing a collision.

## Technology Stack

- **Frontend Framework:** TypeScript (strict) client-side app, built and served by Vite.
- **Backend (leaderboard only):** Vercel Functions in `api/` (Web-standard `GET`/`POST` exports taking a `Request`) over Neon Postgres via `@neondatabase/serverless` (HTTP driver; schema in `db/schema.sql`, applied once per database/branch). Routes: `POST /api/run` (signed run token, issued at shift start), `POST /api/scores` (verify token, plausibility, rate limit, insert), `GET /api/leaderboard` (daily/weekly/all-time top 10 + the player's rank). Shared code in `api/_lib/` (underscore = not a route). Env vars `DATABASE_URL` and `LEADERBOARD_SECRET` (see `.env.example`; `.env` is git-ignored). `npm run dev` serves `api/` too, via the dev-only `vite-plugins/apiDev.ts` middleware. Imports inside `api/` use `.js` extensions (Vercel runs them as plain Node ESM). The game must stay fully playable with the API down.
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) for the HTML HUD/overlay layered over the canvas.
- **Rendering:** Babylon.js (`@babylonjs/core`, ES module deep imports for tree-shaking), WebGL. Tilted orthographic `ArcRotateCamera`; rotate/zoom via HUD buttons + mouse wheel; pan via arrow keys / WASD or dragging empty ground (a drag that starts on a plane always draws its flight path instead). Every action also has a keyboard shortcut: one table in `src/input/shortcuts.ts` drives the key handler and the in-game help panel (the "?" button or H). `@babylonjs/lite` was rejected for now (WebGPU-only, young API); keep all Babylon code inside `src/render/` and `src/input/` so a later migration stays contained.
- **Tests:** Vitest, for the pure `src/core` layer (`npm test`).
- **Architecture:** Three layers with one-way dependencies:
  - `src/core/` — pure simulation (state, rules, `step(state, dt)`), no DOM or Babylon imports. Sim runs in 2D world units: height fixed at 100, width = 100 × aspect. Each plane's aircraft type (`core/fleet.ts`, from its id) is shared by the renderer (models) and the sound (engines). The shift's time of day comes from `state.elapsed` (`core/daytime.ts`: clock, sun/moon arcs, `nightFactor`).
  - `src/render/`, `src/input/`, `src/ui/`, `src/audio/` — Babylon scene sync, pointer input, HTML HUD, Web Audio sound (the planes' engines, runway, gear and fly-bys and the terminal are real CC0 field recordings in `src/audio/assets/`, loaded by `audio/samples.ts`; the game's signals — chime, alert, readback — are synthesised. Effects in `audio/sfx.ts`, airport ambience in `audio/ambience.ts` (the terminal recording; PA announcements spoken by the lazy-loaded, GPL-3.0 eSpeak NG engine via `audio/speech.ts`, its voice data trimmed to English by `vite-plugins/espeakNgData.ts`, lines in `audio/announcements.ts`), generative background music in `audio/music.ts`, all mixed by `audio/mixer.ts`; animation-timed sounds arrive as cues from `SceneSync.takeAudioCues`, typed in `audio/cues.ts`). Day/night: `render/dayCycle.ts` blends the palette in `render/dayTuning.ts` onto the scene's lights; `SceneSync.setNight` fans `night` out to fake night lights (`render/nightLights.ts`, halos via the shared `render/glow.ts`); music, ambience and the HUD clock follow the same value. They read state; only input mutates it (via `core/path.ts`).
  - `src/net/` — the browser side of the leaderboard (`leaderboardApi.ts`: typed `fetch` wrappers that never throw, plus the anonymous player id / nickname / last board kept in `localStorage`). Leaderboard rules shared with `api/` (name rule, plausibility, board windows, wire types) live in `src/core/leaderboard.ts`, which must stay import-free. Panel UI in `src/ui/leaderboard.ts`.
  - `src/main.ts` — wiring and the render loop.
  - Sim `(x, y)` maps to Babylon `(x, z)` via `src/render/coords.ts`.
- **Scripts:** `dev`, `build`, `preview`, `storybook`, `build-storybook`, `test`, `typecheck`, `lint`, `format`, `audio:build`.
- **Sound recordings:** `scripts/audio/sources.json` lists every recorded sound (Freesound id, author, license, the cut, processing); `npm run audio:build` (`scripts/audio/build-audio.mjs`, ffmpeg from the `ffmpeg-static` dev dependency) downloads the previews into the git-ignored `.cache/`, cuts and encodes them into `src/audio/assets/` (loops FLAC with a baked crossfade, one-shots MP3) and generates the credits (`src/audio/assets/credits.json`, shown in the Licenses panel, and `CREDITS.md`). Only CC0 sources are accepted. After editing `sources.json`, run `npm run audio:build`; the outputs are checked in, so the game build needs neither ffmpeg nor the network. `npm run audio:build -- --analyse <freesoundId> [seconds]` finds steady windows to cut.
- **Storybook:** (`@storybook/html-vite`) showcases every UI element for tuning. HUD stories live in `src/ui/*.stories.ts` ("HUD/Leaderboard" covers the leaderboard panel and game-over submit form with canned data, `src/ui/leaderboard.stories.ts`), Babylon stories in `src/render/stories/` (shared stage in `stage.ts`). HUD markup lives in `src/ui/hudMarkup.ts` (injected by `createHud`), so game and stories share one source. Edit a constant and the open story hot-reloads. Flight animation (banking, wing flex, props, lights, wind) lives in `src/render/flightTuning.ts` as named presets; the game plays `ACTIVE_PRESET`, and the "Tuning/Flight" stories edit values live and emit a preset snippet to paste back. The "Scene/Gameplay/Departure" story covers take-offs (violet planes the game flies out of the hangars: `core/departures.ts`, drawn with a dotted route, heard via `audio/sfx.ts`). The "Audio/Music" story plays the background music with per-layer toggles (`src/audio/music.stories.ts`); "Audio/Effects" is a soundboard for every effect (per aircraft type) and the ambience layers (`src/audio/effects.stories.ts`); "Audio/Samples" plays every raw recording, loops repeating, to check the cuts (`src/audio/samples.stories.ts`). The "Scene/River" stories cover the river boats (`render/boats.ts`, traffic in `core/boats.ts`). The "Scene/Countryside" stories cover airport grounds (`core/airports.ts` → `render/airportGrounds.ts`) and the fields, roads, village, cars and drawbridge (`core/countryside.ts`, `core/cars.ts`, `core/bridges.ts` → `render/countryside.ts`, `render/cars.ts`, `render/bridges.ts`); all of it is built by `Landscape`. The "Tuning/Time of day" stories (`src/render/stories/dayCycle.stories.ts`) play the day/night cycle on the full scene and edit each palette keyframe live, emitting a `DAY_KEYFRAMES` snippet to paste back.
- **Licensing:** own code is ISC (`LICENSE`); the served game bundles GPL-3.0 eSpeak NG, so the in-game Licenses panel (`src/ui/licenses.ts`, texts in `public/licenses/`) must list every bundled runtime dependency (server-only ones such as `@neondatabase/serverless`, used only in `api/`, are not bundled). Adding one? Add its notice and license text there. The sound recordings are credited there too, from the generated `src/audio/assets/credits.json`.
- `sample.html` is the original single-file 2D prototype, kept as a reference only (not built).

## Game Design & Inspiration

The project is a modern spiritual successor to mobile classics like Flight Control (2009).
Mechanics: You route incoming aircraft of different colors to their corresponding runways by dragging flight paths.
I'm looking to build something similar, the most direct route today is using Phaser 3 (if you want to stick to 2D sprites) or Three.js (if you want actual 3D models with a pixelation shader), bundled with a tool like Vite.

## Core Mechanics & Specifications

- **Runways:** Fixed colored runways (e.g., Red, Blue, Yellow). Each runway has a specific landing threshold (a visual indicator at the end) and a required approach angle.
- **Planes:** Spawning off-screen, planes have a color matching a runway. They move at a constant speed.
- **Pathing:** Players click/touch a plane and drag to create a path (array of x/y coordinates). The plane follows this path.
- **Landing:** A plane successfully lands _only_ if it passes over the runway's threshold from the correct direction. Once landing, it should snap to the runway heading, decelerate, and visually fade out.
- **Collisions:** If the radius of two flying planes overlaps, the game ends.
- **Input:** Must support both mouse (`mousedown`, `mousemove`, `mouseup`) and touch events (`touchstart`, `touchmove`, `touchend`) for mobile playability.

## Coding Conventions

- **State Management:** Keep game state variables (score, game over state, plane arrays) clearly separated from the rendering logic.
- **Responsiveness:** The canvas must resize to fit the inner window dimensions, and runways should be placed relative to screen size (e.g., `canvas.width * 0.25`).
- **Linting:** Use ESLint and Prettier with a standard configuration to maintain code quality and consistency.

## Developer Instructions

- Generate clean, heavily commented code.
- Ensure all game loop updates are delta-time (dt) dependent so the game runs at the same speed regardless of monitor refresh rate.
- **Keep Storybook in sync — at the end of every task:** review whether the change touched anything Storybook shows (HUD markup, meshes, models, landscape, animation, config constants a story reads or documents). If so, update the affected stories (or add a new story for a new visual element), refresh story doc comments that name changed constants/files, then verify: `npm run typecheck`, and render every story (Storybook dev server, `iframe.html?id=<story-id>`) checking for console/page errors. Mention the Storybook updates in the task summary.
