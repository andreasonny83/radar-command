/**
 * Entry point: wires the pure simulation (core) to the Babylon renderer,
 * pointer input and HTML HUD, then runs the game loop.
 *
 *   core  (state + rules, no DOM)  ←  render / input / ui  ←  main.ts
 */
import "./style.css";
import { COLOR_HEX, CRASH_OVERLAY_DELAY, MAX_DT, ROTATE_STEP, ZOOM_STEP } from "./config";
import { startGame, step, togglePause } from "./core/simulation";
import { createGameState, setViewAspect } from "./core/state";
import type { SimEvent } from "./core/types";
import { attachPanKeys } from "./input/keyboard";
import { attachPointerInput } from "./input/pointer";
import { attachShortcuts } from "./input/shortcuts";
import { arrivalMarkers } from "./render/arrivals";
import { CameraController, trackPlane } from "./render/camera";
import { MeshFactory } from "./render/meshes";
import { createScene } from "./render/scene";
import { SceneSync } from "./render/sceneSync";
import { createHud } from "./ui/hud";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const { engine, scene, shadows } = createScene(canvas);
const aspect = () => engine.getRenderWidth() / engine.getRenderHeight();

// --- State (pure data, advanced only by `step`) ----------------------------
const state = createGameState(aspect());

// --- Rendering ---------------------------------------------------------------
const cameraController = new CameraController(scene, canvas);
const sceneSync = new SceneSync(scene, new MeshFactory(scene), shadows);

// The world is fixed-size, so the static scene is built once. Resizing the
// window only refits the camera (every frame, from `aspect()`).
cameraController.setWorld(state.world);
sceneSync.rebuildWorld(state);

/**
 * Seconds until the game-over panel appears, while a crash cinematic plays
 * without it (see `CRASH_OVERLAY_DELAY`); null otherwise.
 */
let gameOverIn: number | null = null;

// --- UI + input ----------------------------------------------------------------
function setPaused(paused: boolean): void {
  if ((state.phase === "paused") !== paused && togglePause(state)) hud.setPhase(state.phase);
}

/**
 * Start a shift from the title or game-over screen. Ignored mid-shift, and
 * while the crash cinematic plays before the game-over panel (so a key
 * press can't skip it: the Enter/Space shortcut lands here too). Returns
 * whether it started, so a shared key (Space) can fall through to pause.
 */
function startShift(): boolean {
  if (state.phase === "playing" || state.phase === "paused" || gameOverIn !== null) return false;
  // Leave the crash site: the camera glides back to the default view.
  cameraController.release();
  startGame(state);
  hud.setScore(state.score);
  hud.hideOverlay();
  hud.setPhase(state.phase);
  return true;
}

/** Pause / continue, mid-shift only. */
function togglePaused(): void {
  setPaused(state.phase !== "paused");
}

const rotate = (dir: -1 | 1) => cameraController.rotateBy(dir * ROTATE_STEP);
const zoom = (dir: -1 | 1) => cameraController.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);

/**
 * Did opening the help panel pause the game? Then closing it continues;
 * a player who had already paused stays paused.
 */
let helpPaused = false;

const hud = createHud(document.body, {
  onStart: () => void startShift(),
  onTogglePause: togglePaused,
  onRotate: rotate,
  onZoom: zoom,
  onHelp: (open) => {
    if (open && state.phase === "playing") {
      setPaused(true);
      helpPaused = true;
    } else if (!open && helpPaused) {
      helpPaused = false;
      setPaused(false);
    }
  },
});

// --- Follow camera -----------------------------------------------------------
/** Id of the plane the camera was last told to follow (see `cycleFollow`). */
let followedId: number | null = null;

function followPlane(planeId: number): void {
  cameraController.follow(trackPlane(() => state, planeId));
  followedId = planeId;
}

/**
 * F / Shift+F: follow the next (+1) or previous (-1) plane, in order of
 * arrival (plane ids count up as they spawn), wrapping round. With nothing
 * followed yet, F picks the oldest plane and Shift+F the newest.
 */
function cycleFollow(dir: -1 | 1): void {
  if (state.phase !== "playing" && state.phase !== "paused") return;
  const ids = state.planes
    .filter((p) => p.phase !== "landed" && p.phase !== "departed")
    .map((p) => p.id)
    .sort((a, b) => a - b);
  if (ids.length === 0) return;
  // The camera drops a subject by itself (pan, plane gone, crash): only
  // trust `followedId` while it's still following.
  const current = cameraController.following ? ids.indexOf(followedId ?? -1) : -1;
  const next =
    current < 0 ? (dir > 0 ? 0 : ids.length - 1) : (current + dir + ids.length) % ids.length;
  const id = ids[next];
  if (id !== undefined) followPlane(id);
}

const pointer = attachPointerInput(canvas, scene, cameraController.camera, () => state, {
  // Dragging empty ground grabs the map.
  onPan: (dx, dy) => cameraController.dragBy(dx, dy),
  // Right-click a plane to follow it; again (or on empty ground) to stop.
  // Right-click again (anywhere) to go back to the view from before.
  onFollow: (planeId) => {
    if (cameraController.following) cameraController.returnFromFollow();
    else if (planeId !== null) followPlane(planeId);
  },
});

// Arrow keys / WASD pan the map (held keys are polled in the render loop).
const panKeys = attachPanKeys();

// Every other key: one table in input/shortcuts.ts, also listed in the
// help panel. A handler returns false when the press doesn't fit the phase
// (Space: start on the title screen, else pause).
attachShortcuts(
  {
    start: startShift,
    togglePause: () => {
      if (state.phase !== "playing" && state.phase !== "paused") return false;
      togglePaused();
    },
    toggleHelp: () => hud.setHelpOpen(!hud.helpOpen),
    rotateLeft: () => rotate(-1),
    rotateRight: () => rotate(1),
    zoomIn: () => zoom(1),
    zoomOut: () => zoom(-1),
    followNext: () => cycleFollow(1),
    followPrevious: () => cycleFollow(-1),
    stopFollow: () => cameraController.returnFromFollow(),
  },
  { helpOpen: () => hud.helpOpen },
);

// Auto-pause when the tab is hidden, so switching away never costs a crash.
// Stays paused on return: the player continues when they're ready.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});

// Resize: new canvas size and camera frustum only. The map stays put.
window.addEventListener("resize", () => {
  engine.resize();
  setViewAspect(state, aspect());
});

function handleEvent(event: SimEvent): void {
  switch (event.type) {
    case "landed":
      hud.setScore(state.score);
      break;
    case "crash": {
      // Wreck the planes, fly the camera over and start the slow orbit. The
      // game-over panel waits, so nothing covers the fireball.
      const site = sceneSync.crash(event.planeIds);
      if (site) cameraController.focusOn(site);
      gameOverIn = CRASH_OVERLAY_DELAY;
      hud.setPhase(state.phase);
      break;
    }
    case "unlocked":
      hud.showToast(`${event.color.toUpperCase()} runway open`, COLOR_HEX[event.color]);
      break;
    case "goAround":
      hud.showToast(`${event.color.toUpperCase()} runway busy — go around`, COLOR_HEX[event.color]);
      break;
    case "spawned":
      break;
  }
}

// --- Game loop -------------------------------------------------------------------
let time = 0;
engine.runRenderLoop(() => {
  // Seconds since last frame, clamped so a backgrounded tab doesn't make
  // planes teleport (and tunnel through each other) when it resumes.
  const dt = Math.min(engine.getDeltaTime() / 1000, MAX_DT);
  // Animation clock (warning pulse, water shimmer) stops while paused too, so
  // the whole scene freezes. The camera below still eases on real dt.
  if (state.phase !== "paused") time += dt;

  for (const event of step(state, dt)) handleEvent(event);
  if (gameOverIn !== null && (gameOverIn -= dt) <= 0) {
    gameOverIn = null;
    hud.showGameOver(state.score);
  }

  // No panning behind the help panel (the keys still track, for release).
  if (!hud.helpOpen) cameraController.panBy(panKeys.direction(), dt);
  cameraController.update(dt, aspect());
  // Badge on while following; covers every way out (right-click, pan,
  // plane gone, crash), since the camera decides those itself.
  hud.setTracking(cameraController.following);
  // Light up the plane under the mouse (or held): planes move under a still
  // cursor, so hover is re-checked every frame, not only on pointer moves.
  sceneSync.setHighlighted(pointer.refreshHover());
  sceneSync.syncPlanes(state, time);
  scene.render();
  // After render, so the arrows use this frame's camera matrices.
  hud.setArrivals(arrivalMarkers(state, scene, canvas));
});

// Expose state for debugging / automated browser checks in dev builds only.
if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = { state, cameraController };
}
