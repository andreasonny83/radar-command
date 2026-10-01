/**
 * Entry point: wires the pure simulation (core) to the Babylon renderer,
 * pointer input and HTML HUD, then runs the game loop.
 *
 *   core  (state + rules, no DOM)  ←  render / input / ui / audio  ←  main.ts
 */
import "./style.css";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { GameAudio, type AudioScene } from "./audio/mixer";
import {
  CRASH_OVERLAY_DELAY,
  DEBUG_START_HOURS,
  DEBUG_TRAFFIC_PERCENT,
  GAME_SPEEDS,
  MAX_DT,
  ROTATE_STEP,
  ZOOM_STEP,
} from "./config";
import { layoutAirports, openAirportsView } from "./core/airports";
import { NAME_HINT, normalizeName } from "./core/leaderboard";
import { unlockedColors } from "./core/progression";
import { breakdownOf } from "./core/scoring";
import { startGame, step, togglePause } from "./core/simulation";
import { createGameState, setLiveView, setViewAspect } from "./core/state";
import type { CrashCause, SimEvent } from "./core/types";
import { attachPanKeys } from "./input/keyboard";
import { attachPointerInput } from "./input/pointer";
import { attachShortcuts } from "./input/shortcuts";
import {
  errorMessage,
  fetchBoard,
  isRetryable,
  playerId,
  saveBoard,
  savedBoard,
  savedName,
  saveName,
  startRun,
  submitScore,
} from "./net/leaderboardApi";
import { arrivalMarkers } from "./render/arrivals";
import { CameraController, trackPlane } from "./render/camera";
import { toScene } from "./render/coords";
import { DayCycle } from "./render/dayCycle";
import { MeshFactory } from "./render/meshes";
import { RenderScaler } from "./render/quality";
import { createScene } from "./render/scene";
import { createSceneStats } from "./render/sceneStats";
import { SceneSync } from "./render/sceneSync";
import { toastFor } from "./ui/eventToasts";
import { FrameStats } from "./ui/frameStats";
import { createFullscreen } from "./ui/fullscreen";
import { createScreenWake } from "./ui/wakeLock";
import { createHud } from "./ui/hud";
import { savedUiHidden, saveUiHidden } from "./ui/preferences";
import { weatherAlerts } from "./ui/weatherAlerts";

// Vercel Web Analytics: the framework-agnostic equivalent of the React
// `<Analytics/>` component. Only the game entry calls this, so Storybook
// never reports page views. In dev it runs in debug mode (console only).
inject({ mode: import.meta.env.DEV ? "development" : "production" });
injectSpeedInsights();
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const { engine, scene, shadows, fill, key, quality } = createScene(canvas);
// Trades resolution for frame rate when the GPU struggles (render/quality.ts),
// down to 1 pixel per CSS pixel. A no-op range on a plain 1x desktop screen.
const renderScaler = new RenderScaler(engine, { max: quality.maxScale });
const aspect = () => engine.getRenderWidth() / engine.getRenderHeight();

// --- State (pure data, advanced only by `step`) ----------------------------
const state = createGameState(aspect());
// Dev aid: thinner traffic (config.ts `DEBUG_TRAFFIC_PERCENT`; 100 = normal).
state.traffic = DEBUG_TRAFFIC_PERCENT / 100;

// --- Rendering ---------------------------------------------------------------
const cameraController = new CameraController(scene, canvas);
const sceneSync = new SceneSync(scene, new MeshFactory(scene), shadows);
// Time of day: moves the sun/moon, sky fill and shadows through the shift
// (render/dayCycle.ts); the same `night` value drives the night lights,
// the music and ambience, and the HUD clock (render loop below).
const dayCycle = new DayCycle({ scene, fill, key, shadows });
/** Page background last written (mirrors the scene clear colour). */
let bodyColor = "";

// --- Sound ---------------------------------------------------------------------
// Effects and background music (audio/mixer.ts). Browsers only allow audio
// after a user gesture: start it on the first press of anything (the START
// button counts), resume it on later ones.
const audio = new GameAudio();
for (const type of ["pointerdown", "keydown"] as const) {
  window.addEventListener(type, () => audio.unlock(), { capture: true });
}
/** The mix for each game phase: music dips while paused, fades after a crash. */
const AUDIO_SCENES: Record<typeof state.phase, AudioScene> = {
  start: "title",
  playing: "playing",
  paused: "paused",
  gameover: "crash",
};

// The world is fixed-size, so the static scene is built once. Resizing the
// window only refits the camera (every frame, from `aspect()`).
cameraController.setWorld(state.world);
// A shift starts with the red runway alone; the others are built as their
// colours open (see core/progression.ts).
sceneSync.setRunwayProgression(true);
sceneSync.rebuildWorld(state);

// --- Opening view ------------------------------------------------------------
// A shift opens over the first airport alone: the others aren't built until
// their first runway opens (render/sceneSync.ts `AIRPORT_REVEAL_DELAY`).
const airports = layoutAirports(state.runways, state.world);
/** How many airports the camera last framed (see `frameOpenAirports`). */
let framedAirports = 0;

/**
 * Glide the camera to frame every airport with a runway open (see
 * core/airports.ts `openAirportsView`), if that's more than it last framed:
 * the first airport alone as a shift opens, then pulled back as each
 * further one opens, just before it's built, so the player watches it go up.
 */
function frameOpenAirports(): void {
  const open = unlockedColors(state.landed, state.runways);
  const view = openAirportsView(airports, open, state.world, aspect());
  if (view.count === framedAirports) return;
  framedAirports = view.count;
  const center = toScene(view.center, state.world, 0);
  cameraController.glideTo({ x: center.x, z: center.z }, view.zoom);
}

/**
 * Seconds until the game-over panel appears, while a crash cinematic plays
 * without it (see `CRASH_OVERLAY_DELAY`); null otherwise.
 */
let gameOverIn: number | null = null;

/** What ended the shift, for the game-over headline (set by the `crash` event). */
let crashCause: CrashCause = "collision";

// --- Leaderboard ---------------------------------------------------------------
/**
 * This shift's run token (net/leaderboardApi.ts), requested as it starts:
 * resolves to null when the API can't be reached (the shift still plays,
 * it just can't be submitted). Cleared once the run is on the board.
 */
let runToken: Promise<string | null> | null = null;

/** Crash screen: offer the leaderboard form if this run can go on the board. */
async function offerSubmit(): Promise<void> {
  const breakdown = breakdownOf(state);
  hud.showGameOver(breakdown, savedName(), crashCause);
  // Time alone doesn't qualify: the run has to have moved some traffic.
  if (breakdown.landed + breakdown.departed === 0) {
    hud.setSubmitState({
      kind: "unavailable",
      message: "Land a plane or fly a departure out to get on the leaderboard.",
    });
    return;
  }
  // A mocked start (DEBUG_START_HOURS) made up its landing count.
  if (DEBUG_START_HOURS > 0) {
    hud.setSubmitState({
      kind: "unavailable",
      message: `Dev shift (started ${DEBUG_START_HOURS} h in) can't be submitted.`,
    });
    return;
  }
  const token = await runToken;
  // A new shift started while the token was still on its way.
  if (state.phase !== "gameover") return;
  hud.setSubmitState(
    token
      ? { kind: "ready" }
      : { kind: "unavailable", message: "Leaderboard offline: this shift can't be submitted." },
  );
}

/** SUBMIT on the game-over screen: send the run, then show where it placed. */
async function submitRun(rawName: string): Promise<void> {
  const name = normalizeName(rawName);
  if (!name) {
    hud.setSubmitState({ kind: "error", message: `Name: ${NAME_HINT}.` });
    return;
  }
  const token = await runToken;
  if (!token) return;
  saveName(name);
  hud.setSubmitState({ kind: "sending" });
  // The parts, not the total: the server recomputes the score (scoreOf) and
  // checks each part is plausible for the shift's length.
  const result = await submitScore({ token, playerId: playerId(), name, ...breakdownOf(state) });
  // The player moved on to a new shift meanwhile: its form is gone.
  if (state.phase !== "gameover") return;
  if (result.ok) {
    runToken = null; // one submit per run
    hud.setSubmitState({ kind: "done", ranks: result.data.ranks });
    // Today's board, with the player's row lit up.
    hud.setLeaderboardOpen(true, "daily");
  } else {
    const message = errorMessage(result.error);
    hud.setSubmitState(
      isRetryable(result.error) ? { kind: "error", message } : { kind: "unavailable", message },
    );
  }
}

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
  startGame(state, Math.random, DEBUG_START_HOURS);
  setGameSpeed(GAME_SPEEDS[0]);
  // Fire and forget: the token only matters if this shift gets submitted.
  runToken = DEBUG_START_HOURS > 0 ? null : startRun();
  // Glide in over the first airport (the others are closed again).
  framedAirports = 0;
  frameOpenAirports();
  hud.setScore(breakdownOf(state));
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
 * Panels that pause the shift while open (help, leaderboard; they can
 * stack). Did opening the first one pause the game? Then closing the last
 * one continues; a player who had already paused stays paused.
 */
const openPanels = new Set<string>();
let panelPaused = false;

function onPanel(panel: string, open: boolean): void {
  if (open) openPanels.add(panel);
  else openPanels.delete(panel);
  if (openPanels.size > 0 && state.phase === "playing") {
    setPaused(true);
    panelPaused = true;
  } else if (openPanels.size === 0 && panelPaused) {
    panelPaused = false;
    setPaused(false);
  }
}

let gameSpeed: (typeof GAME_SPEEDS)[number] = GAME_SPEEDS[0];
function setGameSpeed(speed: (typeof GAME_SPEEDS)[number]): void {
  gameSpeed = speed;
  hud.setSpeed(speed);
}

// Stats for nerds (ui/stats.ts): renderer numbers and the frame-time window
// are only gathered while the panel is open.
const sceneStats = createSceneStats(engine, scene);
const frameStats = new FrameStats();
/** Simulation sub-steps run in the last frame (see the game loop). */
let simSteps = 0;

const hud = createHud(document.body, {
  onStart: () => void startShift(),
  onTogglePause: togglePaused,
  onSpeedChange: setGameSpeed,
  onRotate: rotate,
  onZoom: zoom,
  onToggleSound: toggleSound,
  onToggleMusic: toggleMusic,
  onToggleFullscreen: toggleFullscreen,
  onHelp: (open) => onPanel("help", open),
  onLeaderboard: (open) => onPanel("leaderboard", open),
  onStats: (open) => {
    sceneStats.setEnabled(open);
    if (open) frameStats.reset();
  },
  onUiHidden: saveUiHidden,
  initialUiHidden: savedUiHidden(),
  onSubmitScore: (name) => void submitRun(name),
  loadBoard: (board) => fetchBoard(board, playerId(), savedName() || undefined),
  initialBoard: savedBoard(),
  onBoardChange: saveBoard,
});

const gpu = sceneStats.gpu();
hud.setStatsInfo({ gpu: `${gpu.renderer} · ${gpu.api}` });
hud.setMuted(audio.muted);
hud.setMusicOn(audio.musicOn);
hud.setSpeed(gameSpeed);

function toggleSound(): void {
  audio.setMuted(!audio.muted);
  hud.setMuted(audio.muted);
}

function toggleMusic(): void {
  audio.setMusicOn(!audio.musicOn);
  hud.setMusicOn(audio.musicOn);
}

/** Keeps the screen on while a shift is running or paused. */
const screenWake = createScreenWake();

// Full screen (ui/fullscreen.ts): the button follows the browser's own
// state, so leaving with Esc updates it too. The renderer needs nothing:
// the window resizes and the handler below refits the engine.
const fullscreen = createFullscreen();
hud.setFullscreenAvailable(fullscreen.supported);
hud.setFullscreen(fullscreen.active);
fullscreen.onChange((active) => hud.setFullscreen(active));

/** Button or Z. Returns false (key not handled) where full screen isn't supported. */
function toggleFullscreen(): boolean | void {
  if (!fullscreen.supported) return false;
  void fullscreen.toggle().then((ok) => {
    if (!ok) hud.showToast("The browser refused full screen");
  });
}

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
  // Two fingers on empty ground: spread to zoom in, close to zoom out.
  onPinch: (scale) => cameraController.zoomBy(scale),
  // Right-click a plane to follow it; again (or on empty ground) to stop.
  // Right-click again (anywhere) to go back to the view from before.
  onFollow: (planeId) => {
    if (cameraController.following) cameraController.returnFromFollow();
    else if (planeId !== null) followPlane(planeId);
  },
  // The tower reads the new route back over the radio.
  onPathDrawn: (_planeId, anchored) => audio.readback(anchored),
  // Let go on a runway without locking on: that landing won't happen. A red
  // X where the path ends (not the green ring) and the "denied" buzz.
  onLandingRejected: (_planeId, at) => {
    sceneSync.showRejectMark(at, state.world);
    audio.reject();
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
    // Closing is the panel's own key handler (ui/leaderboard.ts).
    toggleLeaderboard: () => hud.setLeaderboardOpen(true),
    toggleStats: () => hud.setStatsOpen(!hud.statsOpen),
    toggleUi: () => hud.setUiHidden(!hud.uiHidden),
    toggleSound,
    toggleMusic,
    toggleFullscreen,
    speed1: () => setGameSpeed(GAME_SPEEDS[0]),
    speed15: () => setGameSpeed(GAME_SPEEDS[1]),
    speed2: () => setGameSpeed(GAME_SPEEDS[2]),
    speed3: () => setGameSpeed(GAME_SPEEDS[3]),
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
  audio.setHidden(document.hidden);
});

// Resize: new canvas size and camera frustum only. The map stays put.
window.addEventListener("resize", () => {
  engine.resize();
  setViewAspect(state, aspect());
});

/** Where a plane is across the screen, for stereo placement (see audio/cues.ts). */
const panFor = (planeId: number) => sceneSync.panFor(planeId);

function handleEvent(event: SimEvent): void {
  // Notices (runway open / busy / closed, departures): wording in ui/eventToasts.ts.
  const toast = toastFor(event);
  if (toast) hud.showToast(toast.text, toast.color);
  // Sounds for moments: the departure chime, a go-around's engines.
  audio.onSimEvent(event, panFor);
  switch (event.type) {
    case "unlocked":
      // A runway at a new airport: pull back to show it being built.
      frameOpenAirports();
      break;
    case "goAround": {
      // The runway turned the approach away: the red X on its threshold
      // (the buzz comes with the go-around sound, see audio/mixer.ts).
      const runway = state.runways.find((r) => r.color === event.color);
      if (runway) sceneSync.showRejectMark(runway.threshold, state.world);
      break;
    }
    case "crash": {
      // Wreck the planes, fly the camera over and start the slow orbit. The
      // game-over panel waits, so nothing covers the fireball.
      crashCause = event.cause;
      const site = sceneSync.crash(event.planeIds);
      if (site) cameraController.focusOn(site);
      gameOverIn = CRASH_OVERLAY_DELAY;
      hud.setPhase(state.phase);
      break;
    }
    default:
      // The rest only toast and sound (above).
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

  // At 1.5-3x one frame covers more sim time than `MAX_DT`; feed it in
  // pieces no bigger than that, so fast play can't tunnel planes through
  // each other or skip a landing. A crash ends the shift: stop stepping.
  simSteps = 0;
  for (let left = dt * gameSpeed; left > 1e-9 && state.phase === "playing";) {
    const h = Math.min(left, MAX_DT);
    left -= h;
    simSteps++;
    for (const event of step(state, h)) handleEvent(event);
  }
  if (gameOverIn !== null && (gameOverIn -= dt) <= 0) {
    gameOverIn = null;
    void offerSubmit();
  }

  // No panning behind the help panel (the keys still track, for release).
  if (!hud.helpOpen) cameraController.panBy(panKeys.direction(), dt);
  cameraController.update(dt, aspect());
  // Arrivals start beyond whatever the camera shows now (zoomed out,
  // rotated or panned), so none pops up on screen (core/spawner.ts).
  setLiveView(state, cameraController.groundView(aspect()));
  // Badge on while following; covers every way out (right-click, pan,
  // plane gone, crash), since the camera decides those itself.
  hud.setTracking(cameraController.following);
  // Light up the plane under the mouse (or held): planes move under a still
  // cursor, so hover is re-checked every frame, not only on pointer moves.
  // Time of day follows the sim clock (frozen while paused or after a
  // crash); `dt` is real time so a new shift's catch-up still plays.
  dayCycle.update(state.elapsed, dt);
  // The page behind the canvas matches the edge-of-map colour at any hour.
  if (dayCycle.clearColor !== bodyColor) {
    bodyColor = dayCycle.clearColor;
    document.body.style.backgroundColor = bodyColor;
  }
  sceneSync.setNight(dayCycle.night);
  audio.setNight(dayCycle.night);
  hud.setClock(dayCycle.hours, dayCycle.night);
  // Every frame, not on events: time survived adds to the score as it goes
  // (and a departure leaving the map raises no event of its own).
  hud.setScore(breakdownOf(state));
  // Forecasts of weather still to come (only during a shift: a finished one
  // keeps its streams until the next starts).
  const inShift = state.phase === "playing" || state.phase === "paused";
  hud.setWeatherAlerts(inShift ? weatherAlerts(state) : []);
  sceneSync.setHighlighted(pointer.refreshHover());
  sceneSync.syncPlanes(state, time);
  // Sound: animation-timed cues from this frame's sync (gear, touchdown,
  // whoosh, warnings), engines and rollouts from state, ambience and music
  // on their own clocks (softer while paused).
  // Following a plane, its sounds lead and the rest recede (audio/sfx.ts).
  audio.setFocus(cameraController.following ? followedId : null);
  for (const cue of sceneSync.takeAudioCues()) audio.cue(cue);
  audio.setScene(AUDIO_SCENES[state.phase]);
  audio.update(state, panFor);
  scene.render();
  // Only a running shift counts: the title screen and pause are cheap and
  // say nothing about the real load.
  renderScaler.update(engine.getDeltaTime(), state.phase === "playing");
  // A phone must not dim or lock its screen mid-shift (ui/wakeLock.ts).
  screenWake.sync(state.phase === "playing" || state.phase === "paused");
  if (hud.statsOpen) {
    // Raw frame time, not the clamped `dt`: a stall should show up.
    frameStats.push(engine.getDeltaTime());
    hud.updateStats(performance.now(), () => {
      const frame = frameStats.snapshot();
      if (!frame) return null;
      // Chromium-only, hence not in lib.dom.d.ts.
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return {
        ...frame,
        ...sceneStats.read(),
        planes: state.planes.filter((p) => p.phase !== "landed" && p.phase !== "departed").length,
        speed: gameSpeed,
        steps: simSteps,
        elapsed: state.elapsed,
        heapMb: heap ? heap.usedJSHeapSize / 1048576 : null,
      };
    });
  }
  // After render, so the arrows use this frame's camera matrices.
  hud.setArrivals(arrivalMarkers(state, scene, canvas));
});

// Expose state for debugging / automated browser checks in dev builds only.
if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = {
    state,
    cameraController,
    audio,
    sceneSync,
    dayCycle,
  };
}
