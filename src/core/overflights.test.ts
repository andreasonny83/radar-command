import { describe, expect, it } from "vitest";
import { COLLISION_DISTANCE, OVERFLIGHT_INTERVAL_MAX } from "../config";
import { detectCollisions } from "./collision";
import { DAY_SECONDS } from "./daytime";
import { airspaceCenter } from "./layout";
import { createPlane } from "./plane";
import { AIRLINES, scheduleOverflights } from "./overflights";
import { step } from "./simulation";
import { createGameState, resetGameState } from "./state";
import type { Plane, PlaneColor, WorldSize } from "./types";

/** A plane of `color` at `at`; "grey" ones are overflights. */
function plane(id: number, color: PlaneColor, at: { x: number; y: number }): Plane {
  const p = createPlane(id, color, at, 0);
  if (color === "grey") {
    p.phase = "overflight";
    p.overflight = { airline: 0 };
  }
  if (color === "violet") p.phase = "climbout";
  return p;
}

describe("overflight collisions", () => {
  const world: WorldSize = createGameState().world;
  const c = airspaceCenter(world);
  const near = { x: c.x + COLLISION_DISTANCE * 0.5, y: c.y };

  it("crashes into an arrival", () => {
    const result = detectCollisions([plane(1, "grey", c), plane(2, "red", near)], world);
    expect(result.crash).not.toBeNull();
  });

  it("never meets another overflight or a departure", () => {
    for (const other of ["grey", "violet"] as const) {
      const result = detectCollisions([plane(1, "grey", c), plane(2, other, near)], world);
      expect(result.crash).toBeNull();
      expect(result.warnings.size).toBe(0);
    }
  });
});

describe("scheduleOverflights", () => {
  it("sends none on the first game day", () => {
    const state = createGameState();
    resetGameState(state);
    for (let t = 0; t < DAY_SECONDS - 1; t++) {
      state.elapsed = t;
      scheduleOverflights(state, 1, Math.random);
    }
    expect(state.planes).toHaveLength(0);
  });

  it("keeps a steady, low pace from the second day", () => {
    const state = createGameState();
    resetGameState(state);
    state.elapsed = DAY_SECONDS;
    let sent = 0;
    for (let t = 0; t < 600; t++) {
      state.elapsed = DAY_SECONDS + t;
      const p = scheduleOverflights(state, 1, Math.random);
      if (p) {
        sent++;
        expect(p.color).toBe("grey");
        expect(p.phase).toBe("overflight");
        expect(AIRLINES[p.overflight!.airline]).toBeDefined();
      }
      // Free the slots: only the pace is under test here.
      state.planes = [];
    }
    expect(sent).toBeGreaterThanOrEqual(Math.floor(600 / OVERFLIGHT_INTERVAL_MAX));
    expect(sent).toBeLessThanOrEqual(15);
  });

  it("flies straight across the map and is gone", () => {
    const state = createGameState();
    resetGameState(state);
    state.elapsed = DAY_SECONDS;
    state.overflightTimer = state.overflightInterval;
    const flight = scheduleOverflights(state, 0.1, () => 0.5)!;
    const heading = flight.heading;
    let seenInAirspace = false;
    for (let i = 0; i < 20 * 60 && state.planes.includes(flight); i++) {
      state.phase = "playing";
      step(state, 0.25, () => 0.5);
      if (!flight.inbound) seenInAirspace = true;
      if (state.phase !== "playing") break;
    }
    expect(seenInAirspace).toBe(true);
    expect(flight.heading).toBeCloseTo(heading);
    expect(state.planes.includes(flight)).toBe(false);
  });
});
