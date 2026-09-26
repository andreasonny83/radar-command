# CLAUDE.md

**Important: Ignore tests until further notice. The current test suite is incomplete and may not reflect the final game logic.**

## Project Overview

This project is an Air Traffic Control game, inspired by classic mobile games like _Flight Control_ (https://airport.apunen.com). The player drags flight paths from aircraft to their matching colored runways, attempting to land as many planes as possible without causing a collision.

## Technology Stack

- **Frontend Framework:** TypeScript (strict) client-side app, built and served by Vite. No backend.
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) for the HTML HUD/overlay layered over the canvas.
- **Rendering:** Babylon.js (`@babylonjs/core`, ES module deep imports for tree-shaking), WebGL. Tilted orthographic `ArcRotateCamera`; rotate/zoom via HUD buttons + mouse wheel; pan via arrow keys / WASD or dragging empty ground (a drag that starts on a plane always draws its flight path instead). Every action also has a keyboard shortcut: one table in `src/input/shortcuts.ts` drives the key handler and the in-game help panel (the "?" button or H). `@babylonjs/lite` was rejected for now (WebGPU-only, young API); keep all Babylon code inside `src/render/` and `src/input/` so a later migration stays contained.
- **Tests:** Vitest, for the pure `src/core` layer (`npm test`).
- **Architecture:** Three layers with one-way dependencies:
  - `src/core/` — pure simulation (state, rules, `step(state, dt)`), no DOM or Babylon imports. Sim runs in 2D world units: height fixed at 100, width = 100 × aspect.
  - `src/render/`, `src/input/`, `src/ui/` — Babylon scene sync, pointer input, HTML HUD. They read state; only input mutates it (via `core/path.ts`).
  - `src/main.ts` — wiring and the render loop.
  - Sim `(x, y)` maps to Babylon `(x, z)` via `src/render/coords.ts`.
- **Scripts:** `dev`, `build`, `preview`, `storybook`, `build-storybook`, `test`, `typecheck`, `lint`, `format`.
- **Storybook:** (`@storybook/html-vite`) showcases every UI element for tuning. HUD stories live in `src/ui/*.stories.ts`, Babylon stories in `src/render/stories/` (shared stage in `stage.ts`). HUD markup lives in `src/ui/hudMarkup.ts` (injected by `createHud`), so game and stories share one source. Edit a constant and the open story hot-reloads. Flight animation (banking, wing flex, props, lights, wind) lives in `src/render/flightTuning.ts` as named presets; the game plays `ACTIVE_PRESET`, and the "Tuning/Flight" stories edit values live and emit a preset snippet to paste back. The "Scene/River" stories cover the river boats (`render/boats.ts`, traffic in `core/boats.ts`). The "Scene/Countryside" stories cover airport grounds (`core/airports.ts` → `render/airportGrounds.ts`) and the fields, roads, village, cars and drawbridge (`core/countryside.ts`, `core/cars.ts`, `core/bridges.ts` → `render/countryside.ts`, `render/cars.ts`, `render/bridges.ts`); all of it is built by `Landscape`.
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
