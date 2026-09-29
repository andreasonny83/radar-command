/**
 * The game's side of the conflict advice (see core/conflictAdvice.ts):
 * decides when to ask `POST /api/conflicts`, remembers the answers, and
 * hands the HUD whatever it has. Nothing here throws or blocks: with the
 * API down, unconfigured or rate limited the list simply has no advice.
 *
 * Every question costs API credit, so it asks sparingly:
 * - only about pairs it has no verdict for yet, or whose verdict has gone
 *   stale (`REFRESH_MS`: the situation changes as the planes close in);
 * - at most one request in flight, and one per `MIN_GAP_MS`;
 * - after a failure it stays quiet for `BACKOFF_MS` (a long time for a
 *   dead key or a spent token, which won't fix themselves).
 */
import {
  MAX_ADVICE_CONFLICTS,
  type AdviceRequest,
  type AdviceResponse,
  type AdviceVerdict,
} from "../core/conflictAdvice";
import { adviceFacts, conflictKey, type Conflict } from "../core/conflicts";
import type { GameState } from "../core/types";
import { call } from "./leaderboardApi";

/** Ask again about a pair whose verdict is older than this (ms). */
const REFRESH_MS = 12_000;
/** Least time between two requests (ms). */
const MIN_GAP_MS = 3_000;
/** Quiet time after a failed request (ms). */
const BACKOFF_MS = 30_000;

export interface ConflictAdvisor {
  /**
   * Call whenever the predicted `conflicts` are refreshed. Starts a request
   * if one is due, and returns the verdicts held for the pairs listed now.
   */
  update(state: GameState, conflicts: readonly Conflict[]): ReadonlyMap<string, AdviceVerdict>;
  /** Forget everything (a new shift: plane ids start over). */
  reset(): void;
}

/**
 * @param getToken the shift's run token, or null when it couldn't be had
 *                 (offline at shift start): then no advice is asked for.
 * @param now      clock in ms, injectable for tests.
 */
export function createConflictAdvisor(
  getToken: () => Promise<string | null> | null,
  now: () => number = () => performance.now(),
): ConflictAdvisor {
  const verdicts = new Map<string, { verdict: AdviceVerdict; at: number }>();
  let inFlight = false;
  let lastRequest = -Infinity;
  let quietUntil = -Infinity;
  /** Bumped by `reset`, so an answer from the previous shift is dropped. */
  let generation = 0;

  async function ask(request: Omit<AdviceRequest, "token">, gen: number): Promise<void> {
    inFlight = true;
    try {
      const token = await getToken();
      if (!token) {
        quietUntil = now() + BACKOFF_MS;
        return;
      }
      const result = await call<AdviceResponse>("/api/conflicts", {
        method: "POST",
        body: JSON.stringify({ token, ...request } satisfies AdviceRequest),
      });
      if (gen !== generation) return;
      if (!result.ok) {
        quietUntil = now() + BACKOFF_MS;
        return;
      }
      for (const [key, verdict] of Object.entries(result.data.verdicts ?? {})) {
        verdicts.set(key, { verdict, at: now() });
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    update(state, conflicts) {
      const t = now();
      const keys = new Set(conflicts.map(conflictKey));
      // A pair that has gone (resolved, or crashed) needs no verdict any more.
      for (const key of verdicts.keys()) if (!keys.has(key)) verdicts.delete(key);

      const due = conflicts.filter((c) => {
        const held = verdicts.get(conflictKey(c));
        return !held || t - held.at > REFRESH_MS;
      });
      if (due.length > 0 && !inFlight && t >= quietUntil && t - lastRequest >= MIN_GAP_MS) {
        lastRequest = t;
        // The soonest first: they need the answer most.
        const conflictsToSend = adviceFacts(due, state, MAX_ADVICE_CONFLICTS);
        if (conflictsToSend.length > 0) void ask({ conflicts: conflictsToSend }, generation);
      }

      const out = new Map<string, AdviceVerdict>();
      for (const [key, { verdict }] of verdicts) out.set(key, verdict);
      return out;
    },
    reset() {
      generation++;
      verdicts.clear();
      quietUntil = -Infinity;
      lastRequest = -Infinity;
    },
  };
}
