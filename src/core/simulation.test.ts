import { describe, expect, it } from "vitest";
import { createPlane } from "./plane";
import { flyingCount } from "./progression";
import { startGame, step, togglePause } from "./simulation";
import { createGameState } from "./state";

/** Deterministic rng for reproducible spawns. */
const rng = () => 0.5;

describe("step", () => {
  it("does nothing before the shift starts", () => {
    const state = createGameState(16 / 9);
    expect(step(state, 1, rng)).toEqual([]);
    expect(state.planes).toEqual([]);
  });

  it("startGame spawns one plane and enters the playing phase", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    expect(state.phase).toBe("playing");
    expect(state.planes).toHaveLength(1);
  });

  it("scores and prunes a plane that lands", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    const runway = state.runways[0]!;
    state.planes = [createPlane(99, runway.color, { ...runway.threshold }, runway.heading)];
    const events = step(state, 0.01, rng);
    expect(events).toContainEqual({ type: "landed", planeId: 99, color: runway.color });
    expect(state.landed).toBe(1);
    // Roll out completely: the plane is pruned.
    for (let i = 0; i < 300; i++) step(state, 1 / 60, rng);
    expect(state.planes.find((p) => p.id === 99)).toBeUndefined();
  });

  it("ends the game on collision", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    state.planes = [
      createPlane(1, "red", { x: 40, y: 20 }, 0),
      createPlane(2, "blue", { x: 41, y: 20 }, Math.PI),
    ];
    const events = step(state, 0.01, rng);
    expect(events.some((e) => e.type === "crash")).toBe(true);
    expect(state.phase).toBe("gameover");
    // Frozen after game over.
    expect(step(state, 1, rng)).toEqual([]);
  });

  it("spawns a new plane once spawnInterval elapses", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    state.planes = [];
    step(state, state.spawnInterval + 0.001, rng);
    expect(state.planes).toHaveLength(1);
  });
});

describe("onboarding", () => {
  it("keeps a single plane in the air at the start of a shift", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    // Several spawn intervals pass while the first plane is still flying.
    for (let i = 0; i < 5 * 60; i++) step(state, 1 / 60, rng);
    expect(state.phase).toBe("playing");
    expect(flyingCount(state.planes)).toBe(1);
  });

  it("fills a freed slot on the next step, without a burst", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    for (let i = 0; i < 10; i++) step(state, 1, rng);
    state.planes = [];
    step(state, 0.01, rng);
    expect(state.planes).toHaveLength(1);
    // The time spent at the cap wasn't banked: no second spawn right away.
    step(state, 0.01, rng);
    expect(state.planes).toHaveLength(1);
  });

  it("only spawns red planes before any landings", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    for (let i = 0; i < 20; i++) {
      state.planes = [];
      step(state, state.spawnInterval, rng);
    }
    expect(state.planes.every((p) => p.color === "red")).toBe(true);
  });

  it("announces a runway colour when a landing unlocks it", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    state.landed = 2;
    const runway = state.runways.find((r) => r.color === "red")!;
    state.planes = [createPlane(99, "red", { ...runway.threshold }, runway.heading)];
    const events = step(state, 0.01, rng);
    expect(state.landed).toBe(3);
    expect(events).toContainEqual({ type: "unlocked", color: "blue" });
  });
});

describe("togglePause", () => {
  it("freezes planes, timers and spawning while paused", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    expect(togglePause(state)).toBe(true);
    expect(state.phase).toBe("paused");

    const before = structuredClone(state);
    // Long enough to move planes and trigger several spawns if not frozen.
    expect(step(state, state.spawnInterval * 3, rng)).toEqual([]);
    expect(state).toEqual(before);
  });

  it("continues where it left off", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    const start = { ...state.planes[0]!.pos };
    togglePause(state);
    togglePause(state);
    expect(state.phase).toBe("playing");
    step(state, 0.5, rng);
    expect(state.planes[0]!.pos).not.toEqual(start);
  });

  it("does nothing on the start and game-over screens", () => {
    const state = createGameState(16 / 9);
    expect(togglePause(state)).toBe(false);
    expect(state.phase).toBe("start");
    state.phase = "gameover";
    expect(togglePause(state)).toBe(false);
    expect(state.phase).toBe("gameover");
  });
});
