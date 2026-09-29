/**
 * The simulation step: the only place game state advances in time.
 *
 * Order matters:
 *   1. spawn   – new planes appear at the edges, but only while fewer are
 *                flying than the progression cap allows (core/progression.ts);
 *                later in the shift, departures roll out of the hangars
 *                (core/departures.ts)
 *   2. move    – every plane advances by dt: airborne ones along their
 *                paths, ones on the ground along their taxi routes. First,
 *                planes outside the airspace pick their avoidance turns
 *                (core/avoidance.ts), so they keep clear of each other.
 *                Then departures move on a stage: cleared onto the runway,
 *                lined up, rolling, or lifting off
 *   3. land    – planes over a matching threshold touch down and get a
 *                ground route; a landing may open a new runway colour. A
 *                runway closed for a departure sends arrivals around
 *   4. collide – any remaining flying planes that overlap inside the
 *                airspace end the game (outside it they never collide)
 *   5. prune   – planes stowed in a hangar, or flown off the world, are
 *                removed
 */
import { resolveOuterTraffic } from "./avoidance";
import { advanceDepartures, isRunwayClosed, scheduleDepartures } from "./departures";
import { checkLanding } from "./landing";
import { detectCollisions } from "./collision";
import { isTouchdownZoneClear, touchDown, updateGround } from "./ground";
import { updatePlane } from "./plane";
import { flyingCount, maxAirborne, newlyUnlockedColors } from "./progression";
import { nextSpawnInterval, spawnPlane } from "./spawner";
import { resetGameState } from "./state";
import type { GameState, Rng, Runway, SimEvent } from "./types";

/**
 * Begin a new shift: reset state and put the first plane in the air. The
 * opening plane can't be sent off the world: the player has to land it.
 * It flies in straight for its runway, so it crosses the opening view (the
 * camera starts zoomed in over the first airport) and its arrow shows.
 */
export function startGame(state: GameState, rng: Rng = Math.random): void {
  resetGameState(state);
  const first = spawnPlane(state, rng, true);
  if (first) first.canDepart = false;
}

/**
 * Pause a running shift, or continue a paused one. No-op on the start and
 * game-over screens, so a stray key press can't resurrect a finished game.
 * @returns true if the phase changed.
 */
export function togglePause(state: GameState): boolean {
  if (state.phase === "playing") state.phase = "paused";
  else if (state.phase === "paused") state.phase = "playing";
  else return false;
  return true;
}

/**
 * Advance the game by `dt` seconds.
 * @returns what happened this step, for the UI and renderer to react to.
 */
export function step(state: GameState, dt: number, rng: Rng = Math.random): SimEvent[] {
  if (state.phase !== "playing" || dt <= 0) return [];
  const events: SimEvent[] = [];

  state.elapsed += dt;

  // 1. Spawn. Subtract (rather than zero) the timer so leftover time carries over.
  state.spawnTimer += dt;
  if (state.spawnTimer >= state.spawnInterval) {
    if (flyingCount(state.planes) < maxAirborne(state.landed, state.elapsed)) {
      state.spawnTimer -= state.spawnInterval;
      const plane = spawnPlane(state, rng);
      if (plane) events.push({ type: "spawned", planeId: plane.id });
      state.spawnInterval = nextSpawnInterval(state.spawnInterval, state.landed, state.elapsed);
    } else {
      // At the cap: hold the timer "due" without banking extra time, so a
      // freed slot fills on the next step but never triggers a burst.
      state.spawnTimer = state.spawnInterval;
    }
  }
  scheduleDepartures(state, dt, rng, events);

  // 2. Move. Avoidance first, from where everyone is at the start of the step.
  resolveOuterTraffic(state.planes, state.world);
  for (const plane of state.planes) updatePlane(plane, dt, state.world);
  updateGround(state, dt);
  advanceDepartures(state, dt, events);

  // 3. Land (or go around, if the touchdown zone is blocked or the runway
  // is closed for a departure).
  const isClear = (r: Runway) =>
    isTouchdownZoneClear(r, state.planes) && !isRunwayClosed(r, state.planes);
  for (const plane of state.planes) {
    const result = checkLanding(plane, state.runways, isClear);
    if (result?.type === "goAround") {
      events.push({ type: "goAround", planeId: plane.id, color: result.runway.color });
    } else if (result) {
      const { runway } = result;
      touchDown(plane, runway, state.nextGroundSeq++);
      state.landed++;
      events.push({ type: "landed", planeId: plane.id, color: runway.color });
      for (const color of newlyUnlockedColors(state.landed - 1, state.landed, state.runways)) {
        events.push({ type: "unlocked", color });
      }
    }
  }

  // 4. Collide.
  const { crash, warnings } = detectCollisions(state.planes, state.world);
  for (const plane of state.planes) plane.warning = warnings.has(plane.id);
  if (crash) {
    const [a, b] = crash;
    state.phase = "gameover";
    events.push({
      type: "crash",
      planeIds: [a.id, b.id],
      at: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
    });
    // Leave the planes in place so the crash stays visible behind the overlay.
    return events;
  }

  // 5. Count departures that made it out, then prune. Arrivals that
  // strayed off the map are `departed` too, but only a plane with a
  // `departure` plan took off from the field and earns the credit. (A crash
  // returned above, so nothing leaving on the crash frame counts.)
  for (const p of state.planes) if (p.phase === "departed" && p.departure) state.departed++;
  state.planes = state.planes.filter((p) => p.phase !== "landed" && p.phase !== "departed");
  return events;
}
