/// <reference types="node" />
/**
 * Asking Jev about predicted collisions (see src/core/conflictAdvice.ts).
 *
 * The game's own geometry finds the conflicts; here Jev, TypeSafe's System
 * One model, judges each one with two typed questions over the same state,
 * sent together so they run in parallel:
 *
 * - `severity`, a Score: how urgently must the player act?
 * - `reroute`, a Choice: which of the two planes should they redirect?
 *
 * Code keeps what code knows. Whether a plane *can* be redirected is a fact
 * handed to Jev, and the verdict is checked against it afterwards: a
 * departure can't be steered, so Jev's pick never overrides that.
 */
import {
  choice,
  score,
  TypeSafeClient,
  type ChoiceQuestion,
  type ScoreQuestion,
  type SystemOneResult,
} from "@typesafe-ai/sdk";
import type {
  AdviceConflict,
  AdviceVerdict,
  RerouteAdvice,
} from "../../src/core/conflictAdvice.js";

/** The state Jev sees: the conflicts, named fields, no game jargon it can't use. */
export function adviceState(conflicts: readonly AdviceConflict[]): unknown {
  return {
    about:
      "Air traffic control game. Each entry is a predicted mid-air collision between planes a and b. " +
      "Distances are in game map units; a and b collide if they come closer than collisionDistance.",
    // The key is ours (it matches verdicts to conflicts), not something to judge.
    conflicts: conflicts.map((c) => ({
      seconds: c.seconds,
      miss: c.miss,
      collisionDistance: c.collisionDistance,
      angle: c.angle,
      a: c.a,
      b: c.b,
    })),
  };
}

const severityLevels = [
  "Minor: the planes only just come within collision range, or there is plenty of time, so a small path change is not urgent",
  "Act soon: a real crossing or overtaking conflict with a few seconds to react",
  "Act now: an imminent or head-on collision, with little time or a near-certain hit",
] as const;

const rerouteOptions = {
  a: "Plane a is the better one to redirect: it can be steered and has more freedom than b",
  b: "Plane b is the better one to redirect: it can be steered and has more freedom than a",
  either: "Either plane could be redirected equally well",
} as const;

/** The questions for conflict number `i` (which `conflicts[i]` in the state paths refers to). */
function questionsFor(i: number): {
  severity: ScoreQuestion<typeof severityLevels>;
  reroute: ChoiceQuestion<typeof rerouteOptions>;
} {
  const at = `\`conflicts[${i}]\``;
  return {
    severity: score(
      `How urgently must the player act to prevent the collision in ${at}? ` +
        "Weigh the seconds left, how far inside the collision distance the planes get, " +
        "and how the headings meet (an angle near 180 is head-on).",
      severityLevels,
    ),
    reroute: choice(
      `Which plane in ${at} should the player redirect to resolve the conflict? ` +
        "A plane that cannot be steered can't be redirected. " +
        "A plane committed to landing is locked onto its runway approach, so redirecting it costs the most.",
      rerouteOptions,
    ),
  };
}

/** Both questions for every conflict, as one request's `questions` (names `c<i>_severity`, `c<i>_reroute`). */
function buildQuestions(count: number) {
  const out: Record<
    string,
    ScoreQuestion<typeof severityLevels> | ChoiceQuestion<typeof rerouteOptions>
  > = {};
  for (let i = 0; i < count; i++) {
    const q = questionsFor(i);
    out[`c${i}_severity`] = q.severity;
    out[`c${i}_reroute`] = q.reroute;
  }
  return out;
}

/**
 * Fit a raw pick to who can be steered: never send the player to redirect
 * a plane they can't. When that decides it, it's a rule rather than a
 * judgment, so it is certain; with neither plane steerable there is nothing
 * to suggest (confidence 0).
 */
export function fitReroute(
  pick: RerouteAdvice,
  confidence: number,
  conflict: AdviceConflict,
): Pick<AdviceVerdict, "reroute" | "rerouteConfidence"> {
  const { a, b } = conflict;
  if (!a.steerable && !b.steerable) return { reroute: "either", rerouteConfidence: 0 };
  if (a.steerable && !b.steerable) return { reroute: "a", rerouteConfidence: 1 };
  if (b.steerable && !a.steerable) return { reroute: "b", rerouteConfidence: 1 };
  return { reroute: pick, rerouteConfidence: confidence };
}

/** The minimal client surface used here, so tests can stand in for the network. */
export interface AdviceClient {
  systemOne(request: {
    state: unknown;
    questions: ReturnType<typeof buildQuestions>;
  }): PromiseLike<Pick<SystemOneResult<ReturnType<typeof buildQuestions>>, "answers">>;
}

/** One client per server instance: reads `TYPESAFE_API_KEY` (throws if it's missing). */
let shared: TypeSafeClient | undefined;
function defaultClient(): AdviceClient {
  // Short timeout, one retry: the game shows the list without advice meanwhile.
  shared ??= new TypeSafeClient({ timeout: 6000, retry: { maxRetries: 1 } });
  return shared as unknown as AdviceClient;
}

/** Jev's verdicts on `conflicts`, keyed by each conflict's `key`. */
export async function adviseConflicts(
  conflicts: readonly AdviceConflict[],
  client: AdviceClient = defaultClient(),
): Promise<Record<string, AdviceVerdict>> {
  const { answers } = await client.systemOne({
    state: adviceState(conflicts),
    questions: buildQuestions(conflicts.length),
  });
  const verdicts: Record<string, AdviceVerdict> = {};
  conflicts.forEach((conflict, i) => {
    const severity = answers[`c${i}_severity`];
    const reroute = answers[`c${i}_reroute`];
    if (severity?.type !== "score" || reroute?.type !== "choice") return;
    verdicts[conflict.key] = {
      severity: severity.score,
      severityConfidence: severity.confidence,
      ...fitReroute(reroute.choice as RerouteAdvice, reroute.confidence, conflict),
    };
  });
  return verdicts;
}
