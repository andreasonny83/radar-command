/**
 * `POST /api/run` → `{ token }`: a signed run token, requested as a shift
 * starts and sent back with its score (see api/_lib/token.ts). Nothing is
 * stored: the token carries everything the submit needs to check.
 */
import type { RunResponse } from "../src/core/leaderboard.js";
import { fail, json } from "./_lib/http.js";
import { signRun } from "./_lib/token.js";

export async function POST(): Promise<Response> {
  try {
    const body: RunResponse = { token: await signRun() };
    return json(body);
  } catch (err) {
    console.error("run: couldn't sign a token", err);
    return fail("server");
  }
}
