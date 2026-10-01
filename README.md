# Radar Command

A 3D air traffic control game for the browser, in the spirit of _Flight Control_ (2009). Planes fly
in from the edges of the map; drag a flight path from each one to the runway of its colour and land
as many as you can. If two planes touch, the shift is over.

Built with [Babylon.js](https://www.babylonjs.com/), TypeScript and Vite. The game is a static
site that runs entirely in the browser, on desktop and mobile; only the optional online leaderboard
uses a backend.

## How to play

- **Route planes:** drag from a plane to draw its flight path. It follows the path at a constant
  speed.
- **Land them:** a plane lands only if it crosses its runway's coloured threshold in the direction
  of the runway arrow. From the wrong end it just flies on; if the runway is busy it goes around.
- **Watch the edges:** an arrow on the screen edge warns where the next plane will fly in.
- **Keep them apart:** new runways open as your score grows (blue at 3 landings, yellow at 7), and
  more planes share the sky. One collision ends the shift.

### Controls

| Action                    | Mouse / touch          | Keyboard                                     |
| ------------------------- | ---------------------- | -------------------------------------------- |
| Draw a flight path        | Drag from a plane      |                                              |
| Pan the map               | Drag empty ground      | Arrow keys / WASD                            |
| Zoom                      | Mouse wheel, + / − HUD | `+` / `−`                                    |
| Rotate the view           | ⟲ / ⟳ HUD buttons      | `Q` / `E`                                    |
| Follow a plane            | Right-click a plane    | `F` (next), `Shift + F`                      |
| Stop following            | Right-click again      | `X`                                          |
| Start a shift / try again | START button           | `Enter` / `Space`                            |
| Pause / continue          | ⏸ button               | `P` / `Esc` / `Space`                        |
| Full screen               | Bottom-right button    | `Z` (`Esc` leaves it)                        |
| Game speed                | Speed button           | `1` (normal), `2` (1.5×), `3` (2×), `4` (3×) |
| Help (all controls)       | `?` button             | `H` / `?`                                    |

The in-game help panel is generated from the same shortcut table as the key handler
(`src/input/shortcuts.ts`), so it's always the up-to-date list.

## Running locally

Requires Node.js 26 (see `.nvmrc`).

```bash
npm install
npm run dev        # game at http://localhost:5173
```

| Script                    | What it does                                                   |
| ------------------------- | -------------------------------------------------------------- |
| `npm run dev`             | Vite dev server with hot reload (also serves `api/`)           |
| `npm run build`           | Type-check and build the site into `dist/`                     |
| `npm run preview`         | Serve the production build locally                             |
| `npm run storybook`       | Storybook workbench at http://localhost:6006                   |
| `npm run build-storybook` | Build Storybook as a static site                               |
| `npm test`                | Vitest unit tests for the simulation layer (single run)        |
| `npm run test:watch`      | Vitest in watch mode                                           |
| `npm run typecheck`       | `tsc --noEmit`                                                 |
| `npm run lint`            | ESLint                                                         |
| `npm run format`          | Prettier, rewriting files in place                             |
| `npm run audio:build`     | Rebuild the sound recordings from `scripts/audio/sources.json` |
| `npm run db:migrate`      | Apply pending leaderboard database migrations                  |
| `npm run vercel-build`    | What Vercel runs: migrate the database, then `build`           |
| `npm run db:clean-names`  | Find (and optionally clean up) offensive leaderboard names     |
| `npm run db:seed`         | Fill the leaderboard with made-up runs, to see it with data    |

The game itself is plain static files in `dist/`: host it on GitHub Pages, Netlify, or any static
file server. Only the online leaderboard needs a backend (see below), and the game stays fully
playable without it.

### Audio script

`npm run audio:build` downloads the CC0 previews listed in `scripts/audio/sources.json`, cuts and
encodes them into `src/audio/assets/` and regenerates the credits. It needs ffmpeg (bundled through
the `ffmpeg-static` dev dependency) and the network the first time; the outputs are checked in, so
a normal build needs neither.

```bash
npm run audio:build                              # rebuild everything
npm run audio:build -- <id> [<id>]               # only these entries (credits still cover all)
npm run audio:build -- --analyse <freesoundId> [seconds]   # find steady windows to cut (default 5 s)
```

### Leaderboard database scripts

The leaderboard (`api/`, Vercel Functions over Neon Postgres) reads two variables from `.env` (copy
`.env.example`): `DATABASE_URL` and `LEADERBOARD_SECRET`. Both scripts use `.env`'s `DATABASE_URL`
unless your shell environment sets one, which wins. Quote the URL: Neon URLs contain `&`.

```bash
npm run db:migrate                # apply every pending migration in db/migrations/
npm run db:migrate -- --status    # list applied and pending, change nothing

npm run db:seed                   # 100 made-up runs from 70 players
npm run db:seed -- --count 300 --players 120 --days 90
npm run db:seed -- --status       # how many seeded rows exist
npm run db:seed -- --clear        # delete every seeded row
```

On Vercel the migrations run by themselves: the `vercel-build` script runs
`scripts/db/vercel-migrate.mjs` before `npm run build` on Production and Preview builds, so a
deployment only goes live once the database is up to date, and a failing migration stops the
deploy. It uses that environment's `DATABASE_URL` (with the Vercel ↔ Neon integration each preview
gets its own Neon branch). It skips, with a note in the build log, when `DATABASE_URL` isn't set or
`SKIP_DB_MIGRATE=1` is; set that on Preview if it shares the production database, or a pull
request's migrations would run on the live one. It needs Vercel's default build command (a custom
"Build Command" in the project settings replaces `vercel-build`) and Node 22+.

### Nickname filter

A nickname is checked when a score is submitted (`api/_lib/nameFilter.ts`, server-side): first a
word list (the `obscenity` library, which sees through leetspeak, repeated letters and spacing,
plus a short list of extra terms and an allowlist such as "cockpit"), then, if `TYPESAFE_API_KEY`
is set, [Jev](https://docs.typesafe.ai) judges what a list can't. The Jev layer fails open (no key,
or TypeSafe down: the list alone applies), so it never stops a score being submitted. A refused
name returns `bad_name`; nothing is stored and the player can pick another name and resubmit.

Every Jev call is logged as one JSON line in the function logs (Vercel → Logs, search
`nameFilter.jev`): `outcome` (`allowed`, `flagged`, `cached`, `error`, `budget_exceeded`, `no_key`),
the name, Jev's `probability` against the `threshold`, latency, model and token usage. Errors are
logged at error level and the name is let through. The API key is never logged.

For names already on the boards:

```bash
npm run db:clean-names                       # list what the word list rejects; changes nothing
npm run db:clean-names -- --jev              # also ask Jev about every other name
npm run db:clean-names -- --apply            # rename those runs to "Anonymous"
npm run db:clean-names -- --apply --delete   # delete those runs instead
```

Read the list before `--apply`: no filter is perfect. It can't be undone from the script, so take a
Neon branch first if the data matters.

Schema changes are new numbered files (`NNNN_what_it_does.sql`); never edit one that has been
applied. Seeded rows are tagged `ip_hash = 'seed-test'`. Don't seed the database the deployed game
uses: the fake names would show on its public boards.

## Project structure

The code is split into three layers with one-way dependencies:

```
src/
├── core/     Pure simulation: game state, rules and step(state, dt). No DOM, no Babylon.
├── render/   Babylon.js scene: aircraft, airfield, landscape, camera, crash effects.
├── input/    Pointer and keyboard input; the only layer that changes game state.
├── ui/       HTML HUD over the canvas (Tailwind CSS): score, overlays, help panel.
├── config.ts Gameplay and tuning constants.
└── main.ts   Wiring and the render loop.
```

- **Simulation** runs in 2D world units (100 units tall, 16:9) and is fully delta-time based, so the
  game plays at the same speed on any refresh rate. Sim `(x, y)` maps to Babylon `(x, z)` in
  `src/render/coords.ts`.
- **Rendering** uses a tilted orthographic camera over a procedurally generated low-poly
  countryside: fields, roads, a village with traffic, a river with boats and a drawbridge.
- **Babylon.js** is imported as ES module deep imports for tree-shaking, and kept inside
  `src/render/` and `src/input/`.

## Storybook

Every HUD element and 3D model has a Storybook story, from the score panel to the aircraft, runways,
river boats and countryside. The **Tuning/Flight** stories let you tweak the flight animation
(banking, wing flex, propellers, lights, wind) live and copy the result back into
`src/render/flightTuning.ts` as a preset.

```bash
npm run storybook
```

## Feedback & contributing

Found a bug or have an idea? Use **Send feedback** in the game (start screen or help panel), or
[open an issue](https://github.com/andreasonny83/radar-command/issues/new) directly.

Pull requests are welcome. Before opening one, please run:

```bash
npm run typecheck && npm run lint
```

If your change touches something Storybook shows (HUD markup, meshes, animation, config constants),
update the matching stories too.

## Credits

Inspired by _Flight Control_ by Firemint. Built with Babylon.js, Vite, TypeScript and Tailwind CSS.

The planes' engines, runway and gear sounds, the fly-bys and the terminal ambience are cut from
real field recordings shared on [Freesound](https://freesound.org) and dedicated to the public
domain (CC0 1.0). Every recording and its author is listed in [CREDITS.md](CREDITS.md) and in
the game's **Licenses** panel. To change a sound, edit `scripts/audio/sources.json` and run
`npm run audio:build`.

## License

The project's own source code is released under the [ISC license](LICENSE).

The game as built and served also bundles [eSpeak NG](https://github.com/espeak-ng/espeak-ng)
(the speech synthesiser behind the terminal announcements, via its
[JavaScript port](https://github.com/echogarden-project/espeak-ng-emscripten)),
which is licensed under the [GNU GPL v3](public/licenses/GPL-3.0.txt). The distributed
game as a whole is therefore conveyed under the terms of the GPL-3.0, with this repository
as its complete source. The in-game **Licenses** panel (start screen, game-over screen and
help panel) shows every license and third-party notice; the texts live in
[`public/licenses/`](public/licenses).
