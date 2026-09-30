/**
 * Game state construction. The state object is plain data: the simulation
 * mutates it, the renderer and UI only read it.
 */
import {
  COLOR_UNLOCK_LANDINGS,
  DEPARTURE_INTERVAL_MIN,
  DEPARTURE_START_LANDINGS,
  SPAWN_INTERVAL_START,
  WIND_FIRST_DELAY,
  WORLD_ASPECT,
} from "../config";
import { DAY_SECONDS } from "./daytime";
import { computeWorldSize, layoutRunways, safeViewAspect } from "./layout";
import { isAirspaceCompact } from "./progression";
import type { GameState, OrientedRect } from "./types";

/**
 * Fresh state waiting on the start screen. The world is fixed; `viewAspect`
 * (window width / height) only affects where arrivals start.
 */
export function createGameState(viewAspect = WORLD_ASPECT): GameState {
  const world = computeWorldSize();
  return {
    phase: "start",
    landed: 0,
    departed: 0,
    elapsed: 0,
    scoredSeconds: 0,
    unlockedAt: {},
    spawnTimer: 0,
    spawnInterval: SPAWN_INTERVAL_START,
    traffic: 1,
    streams: [],
    windTimer: WIND_FIRST_DELAY,
    nextStreamId: 1,
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

/** Clear planes/counts/timers for a new shift. World and runways are kept. */
export function resetGameState(state: GameState): void {
  state.phase = "playing";
  state.landed = 0;
  state.departed = 0;
  state.elapsed = 0;
  state.scoredSeconds = 0;
  state.unlockedAt = {};
  state.spawnTimer = 0;
  state.spawnInterval = SPAWN_INTERVAL_START;
  state.streams = [];
  state.windTimer = WIND_FIRST_DELAY;
  state.nextStreamId = 1;
  state.departureTimer = 0;
  state.departureInterval = DEPARTURE_INTERVAL_MIN;
  state.nextGroundSeq = 0;
  state.planes = [];
  // Only the first runway is open again: the airspace shrinks back round it.
  state.world.compactAirspace = isAirspaceCompact(0, state.runways);
}

/**
 * Development aid: begin the new shift `hours` game hours in (see
 * `DEBUG_START_HOURS`). The clock and the wind level follow `elapsed`
 * (one game hour is `DAY_SECONDS / 24` s of play); runways and departures
 * follow the landing count, so `landed` is lifted to the highest threshold,
 * which opens every runway, starts departures and widens the airspace.
 * Call right after `resetGameState`. The landing count is made up, so the
 * score is too: such a shift must never reach the leaderboard.
 */
export function seedShift(state: GameState, hours: number): void {
  state.elapsed = (hours * DAY_SECONDS) / 24;
  state.landed = Math.max(DEPARTURE_START_LANDINGS, ...Object.values(COLOR_UNLOCK_LANDINGS));
  state.world.compactAirspace = isAirspaceCompact(state.landed, state.runways);
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
