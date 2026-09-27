# Radar Command

A 3D air traffic control game for the browser, in the spirit of _Flight Control_ (2009). Planes fly
in from the edges of the map; drag a flight path from each one to the runway of its colour and land
as many as you can. If two planes touch, the shift is over.

Built with [Babylon.js](https://www.babylonjs.com/), TypeScript and Vite. No backend: it's a static
site that runs entirely in the browser, on desktop and mobile.

## How to play

- **Route planes:** drag from a plane to draw its flight path. It follows the path at a constant
  speed.
- **Land them:** a plane lands only if it crosses its runway's coloured threshold in the direction
  of the runway arrow. From the wrong end it just flies on; if the runway is busy it goes around.
- **Watch the edges:** an arrow on the screen edge warns where the next plane will fly in.
- **Keep them apart:** new runways open as your score grows (blue at 3 landings, yellow at 7), and
  more planes share the sky. One collision ends the shift.

### Controls

| Action                    | Mouse / touch          | Keyboard                |
| ------------------------- | ---------------------- | ----------------------- |
| Draw a flight path        | Drag from a plane      |                         |
| Pan the map               | Drag empty ground      | Arrow keys / WASD       |
| Zoom                      | Mouse wheel, + / − HUD | `+` / `−`               |
| Rotate the view           | ⟲ / ⟳ HUD buttons      | `Q` / `E`               |
| Follow a plane            | Right-click a plane    | `F` (next), `Shift + F` |
| Stop following            | Right-click again      | `X`                     |
| Start a shift / try again | START button           | `Enter` / `Space`       |
| Pause / continue          | ⏸ button               | `P` / `Esc` / `Space`   |
| Help (all controls)       | `?` button             | `H` / `?`               |

The in-game help panel is generated from the same shortcut table as the key handler
(`src/input/shortcuts.ts`), so it's always the up-to-date list.

## Running locally

Requires Node.js 26 (see `.nvmrc`).

```bash
npm install
npm run dev        # game at http://localhost:5173
```

| Script                    | What it does                                      |
| ------------------------- | ------------------------------------------------- |
| `npm run dev`             | Vite dev server with hot reload                   |
| `npm run build`           | Type-check and build the static site into `dist/` |
| `npm run preview`         | Serve the production build locally                |
| `npm run storybook`       | Storybook workbench at http://localhost:6006      |
| `npm run build-storybook` | Build Storybook as a static site                  |
| `npm test`                | Vitest unit tests for the simulation layer        |
| `npm run typecheck`       | `tsc --noEmit`                                    |
| `npm run lint`            | ESLint                                            |
| `npm run format`          | Prettier                                          |

`dist/` is plain static files: host it on GitHub Pages, Netlify, or any static file server.

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
[open an issue](https://github.com/andreasonny83/airport-simulator/issues/new) directly.

Pull requests are welcome. Before opening one, please run:

```bash
npm run typecheck && npm run lint
```

If your change touches something Storybook shows (HUD markup, meshes, animation, config constants),
update the matching stories too.

## Credits

Inspired by _Flight Control_ by Firemint. Built with Babylon.js, Vite, TypeScript and Tailwind CSS.

## License

The project's own source code is released under the [ISC license](LICENSE).

The game as built and served also bundles [meSpeak](https://www.masswerk.at/mespeak/)
(a build of the eSpeak speech synthesiser, used for the spoken terminal announcements),
which is licensed under the [GNU GPL v3](public/licenses/GPL-3.0.txt). The distributed
game as a whole is therefore conveyed under the terms of the GPL-3.0, with this repository
as its complete source. The in-game **Licenses** panel (start screen, game-over screen and
help panel) shows every license and third-party notice; the texts live in
[`public/licenses/`](public/licenses).
