/**
 * Game state construction. The state object is plain data: the simulation
 * mutates it, the renderer and UI only read it.
 */
import { DEPARTURE_INTERVAL_MIN, SPAWN_INTERVAL_START, WORLD_ASPECT } from "../config";
import { computeWorldSize, layoutRunways, safeViewAspect } from "./layout";
import type { GameState, OrientedRect } from "./types";

/**
 * Fresh state waiting on the start screen. The world is fixed; `viewAspect`
 * (window width / height) only affects where arrivals start.
 */
export function createGameState(viewAspect = WORLD_ASPECT): GameState {
  const world = computeWorldSize();
  return {
    phase: "start",
    score: 0,
    elapsed: 0,
    spawnTimer: 0,
    spawnInterval: SPAWN_INTERVAL_START,
    departureTimer: 0,
    departureInterval: DEPARTURE_INTERVAL_MIN,
    nextPlaneId: 1,
    nextGroundSeq: 0,
    world,
    viewAspect: safeViewAspect(viewAspect),
    liveView: null,
    runways: layoutRunways(world),
    planes: [],
  };
}

/** Clear planes/score/timers for a new shift. World and runways are kept. */
export function resetGameState(state: GameState): void {
  state.phase = "playing";
  state.score = 0;
  state.elapsed = 0;
  state.spawnTimer = 0;
  state.spawnInterval = SPAWN_INTERVAL_START;
  state.departureTimer = 0;
  state.departureInterval = DEPARTURE_INTERVAL_MIN;
  state.nextGroundSeq = 0;
  state.planes = [];
}

/**
 * Record the window's new shape after a resize. The world, runways and
 * planes are untouched: only where future arrivals start changes.
 */
export function setViewAspect(state: GameState, aspect: number): void {
  state.viewAspect = safeViewAspect(aspect);
}

/**
 * Record the ground the camera shows now (sim coordinates), so arrivals
 * start beyond it however the view is zoomed, rotated or panned (see
 * `GameState.liveView`). Cheap: call it every frame.
 */
export function setLiveView(state: GameState, view: OrientedRect | null): void {
  state.liveView = view;
}
