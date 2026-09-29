/**
 * `POST /api/conflicts` `{ token, conflicts }` → `{ verdicts }`.
 *
 * The game predicts collisions itself (src/core/conflicts.ts) and sends the
 * facts of the soonest few; Jev judges each one (api/_lib/advice.ts) and
 * the verdicts come back keyed by pair. The client never sends question
 * text and never sees the TypeSafe key (`TYPESAFE_API_KEY`).
 *
 * Every request costs API credit, so before Jev is asked:
 * 1. the body's shape and ranges are checked (`isAdviceConflict`);
 * 2. the run token must be one this server signed and still valid, so only
 *    a real shift can ask;
 * 3. one address gets at most `ADVICE_PER_MINUTE` requests. The counter is
 *    per server instance (nothing is stored), so it bounds a single
 *    instance's spend and is best effort across a scaled-out deploy.
 * The game plays fine without any of this: a failure here just means no
 * advice on the list.
 */
import {
  MAX_ADVICE_CONFLICTS,
  isAdviceConflict,
  type AdviceConflict,
  type AdviceResponse,
} from "../src/core/conflictAdvice.js";
import { RUN_MAX_AGE } from "../src/core/leaderboard.js";
import { adviseConflicts } from "./_lib/advice.js";
import { fail, ipHash, json } from "./_lib/http.js";
import { verifyRun } from "./_lib/token.js";

/** Requests one address may make per minute. */
const ADVICE_PER_MINUTE = 30;

/** Request times (ms) per hashed address, for the last minute. */
const recent = new Map<string, number[]>();

/** Record a request from `who`; false when they're over the limit. */
function allow(who: string, now = Date.now()): boolean {
  const times = (recent.get(who) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= ADVICE_PER_MINUTE) {
    recent.set(who, times);
    return false;
  }
  times.push(now);
  recent.set(who, times);
  // Don't let the map grow without bound on a long-lived instance.
  if (recent.size > 5000)
    for (const k of recent.keys())
      if (!recent.get(k)?.some((t) => now - t < 60_000)) recent.delete(k);
  return true;
}

export async function POST(request: Request): Promise<Response> {
  let token: unknown;
  let conflicts: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return fail("bad_request");
    ({ token, conflicts } = body as Record<string, unknown>);
  } catch {
    return fail("bad_request");
  }
  if (
    typeof token !== "string" ||
    !Array.isArray(conflicts) ||
    conflicts.length === 0 ||
    conflicts.length > MAX_ADVICE_CONFLICTS ||
    !conflicts.every(isAdviceConflict)
  ) {
    return fail("bad_request");
  }
  const facts: AdviceConflict[] = conflicts;

  try {
    const claims = await verifyRun(token);
    if (!claims) return fail("bad_token");
    const age = Date.now() / 1000 - claims.issuedAt;
    if (age < 0 || age > RUN_MAX_AGE) return fail("expired");
    if (!allow(await ipHash(request))) return fail("rate_limited");

    const body: AdviceResponse = { verdicts: await adviseConflicts(facts) };
    return json(body);
  } catch (err) {
    // No key configured, TypeSafe down or slow, an unreadable answer: log it, no advice.
    console.error("conflicts: couldn't get advice", err);
    return fail("server");
  }
}
