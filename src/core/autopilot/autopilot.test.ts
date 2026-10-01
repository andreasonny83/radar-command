import { describe, expect, it } from "vitest";
import { DEMO_MEAN_DAYS_BETWEEN_MISTAKES } from "../../config";
import { DAY_SECONDS } from "../daytime";
import { isInAirspace } from "../layout";
import { mulberry32 } from "../math";
import { createPlane } from "../plane";
import { startGame, step } from "../simulation";
import { createGameState } from "../state";
import { autopilotStep, createAutopilot } from "./index";

/** Sim step: 30 steps a second, finer than the game's `MAX_DT`. */
const DT = 1 / 30;

interface RunResult {
  crashed: boolean;
  /** What happened at the crash (planes, positions), for debugging. */
  detail: string;
  /** Sim-seconds flown. */
  at: number;
  landed: number;
  departed: number;
  /** Lapses that began. */
  lapses: number;
  /** Longest spell a plane flew inside the airspace with no path, in seconds. */
  maxBare: number;
  /** Wall-clock milliseconds. */
  ms: number;
}

/** Fly a demo headless for up to `seconds` of sim time. */
function runDemo(seed: number, seconds: number, meanMistakeSeconds: number): RunResult {
  const rng = mulberry32(seed);
  const state = createGameState(16 / 9);
  startGame(state, rng);
  const pilot = createAutopilot(rng, { meanMistakeSeconds });
  let lapses = 0;
  let wasBlind = false;
  let bare = 0;
  let maxBare = 0;
  let detail = "";
  const t0 = performance.now();
  while (state.phase === "playing" && state.elapsed < seconds) {
    autopilotStep(pilot, state, DT);
    if (pilot.blind && !wasBlind) lapses++;
    wasBlind = pilot.blind !== null;
    const events = step(state, DT, rng);
    const crash = events.find((e) => e.type === "crash");
    if (crash && crash.type === "crash") {
      detail =
        `${crash.cause} at ${state.elapsed.toFixed(0)} s, planes ${crash.planeIds.join(",")}; ` +
        state.planes
          .map(
            (p) =>
              `#${p.id} ${p.color} ${p.phase} (${p.pos.x.toFixed(0)},${p.pos.y.toFixed(0)}) ` +
              `path ${p.path.length}${p.pathAnchored ? " anchored" : ""}`,
          )
          .join("; ");
    }
    // A plane flying bare inside the airspace is nobody's responsibility.
    const anyBare = state.planes.some(
      (p) => p.phase === "flying" && p.path.length === 0 && isInAirspace(p.pos, state.world),
    );
    bare = anyBare ? bare + DT : 0;
    maxBare = Math.max(maxBare, bare);
  }
  return {
    crashed: state.phase === "gameover",
    detail,
    at: state.elapsed,
    landed: state.landed,
    departed: state.departed,
    lapses,
    maxBare,
    ms: performance.now() - t0,
  };
}

describe("demo autopilot", () => {
  it("plans a bare plane inside the airspace even when urgent planes use up the budget", () => {
    const state = createGameState(16 / 9);
    startGame(state, mulberry32(7));
    const red = state.runways.find((r) => r.color === "red")!;
    // A departure cleared onto the red runway closes it, so both anchored
    // red approaches are urgent (they have to be pulled off it).
    const departure = createPlane(13, "violet", { x: 30, y: 20 }, 0);
    departure.phase = "outbound";
    departure.departure = {
      runway: "red",
      standId: 0,
      leaveStandS: 0,
      holdS: 0,
      uTurnS: 0,
      cleared: true,
      waited: 0,
      lineupTime: 0,
      speed: 0,
      climbed: 0,
      credited: false,
    };
    const a = createPlane(10, "red", { x: 48, y: 0 }, red.heading);
    const b = createPlane(11, "red", { x: 62, y: 0 }, red.heading);
    for (const p of [a, b]) {
      p.path = [{ ...red.threshold }];
      p.pathAnchored = true;
    }
    // A newcomer, inside the airspace and bare: nobody steers it.
    const bare = createPlane(12, "blue", { x: 90, y: 60 }, 0);
    state.planes = [departure, a, b, bare];

    const pilot = createAutopilot(mulberry32(1), { meanMistakeSeconds: Infinity });
    autopilotStep(pilot, state, 0.01);
    expect(bare.path.length).toBeGreaterThan(0);
  });

  it("flies four game days without a lapse and without a crash", () => {
    // Four days cover the wind (from day 2) and the black streams (from day 3).
    for (const seed of [1, 2, 3]) {
      const r = runDemo(seed, 4 * DAY_SECONDS, Infinity);
      expect(r.detail, `seed ${seed}`).toBe("");
      expect(r.crashed, `seed ${seed}`).toBe(false);
      expect(r.landed, `seed ${seed}`).toBeGreaterThan(20);
      expect(r.maxBare, `seed ${seed}: longest bare spell`).toBeLessThan(2);
    }
  }, 300_000);

  it("a lapse can end in a crash, with the real sim deciding", () => {
    // Lapses every minute on average: some run must end in a collision.
    const results = [1, 2, 3, 4, 5, 6].map((seed) => runDemo(seed, 2000, 60));
    expect(results.some((r) => r.lapses > 0)).toBe(true);
    expect(results.some((r) => r.crashed)).toBe(true);
  }, 300_000);
});

// Long calibration run for DEMO_MEAN_DAYS_BETWEEN_MISTAKES. Off by default:
// VITE_DEMO_SOAK=1 npx vitest run src/core/autopilot/autopilot.test.ts
describe.skipIf(!import.meta.env.VITE_DEMO_SOAK)("demo autopilot calibration", () => {
  it("reports how long the demo lasts at the configured lapse rate", () => {
    const meanMistake = DEMO_MEAN_DAYS_BETWEEN_MISTAKES * DAY_SECONDS;
    const runs = Array.from({ length: 8 }, (_, i) =>
      runDemo(100 + i, 12 * DAY_SECONDS, meanMistake),
    );
    const days = runs.map((r) => r.at / DAY_SECONDS);
    const crashes = runs.filter((r) => r.crashed).length;
    console.info(
      `lapse mean ${meanMistake} s: ${crashes}/${runs.length} crashed; ` +
        `days flown ${days.map((d) => d.toFixed(1)).join(" ")}; ` +
        `lapses ${runs.map((r) => r.lapses).join(" ")}; ` +
        `landed ${runs.map((r) => r.landed).join(" ")}; ` +
        `wall ${runs.map((r) => (r.ms / 1000).toFixed(0)).join(" ")} s`,
    );
    expect(runs.length).toBe(8);
  }, 3_600_000);
});
