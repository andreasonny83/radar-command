/// <reference types="node" />
/**
 * Keeping offensive nicknames off the leaderboard (server-side only: names
 * are shown to every player, and the client can't be trusted to filter).
 *
 * Two layers, cheapest first:
 *
 * 1. `blockedByList`: a word list (the `obscenity` library's English
 *    dataset, which sees through leetspeak, repeated letters and odd
 *    casing, and doesn't trip on innocent words that merely contain a bad
 *    one: "Assassin", "Scunthorpe"). Plus what a plain list gets wrong:
 *    - separators: "f.u.c.k" and "f u c k" are also tested with spaces,
 *      dots, dashes and underscores removed;
 *    - `EXTRA_BLOCKED`, terms the English dataset doesn't cover;
 *    - `ALLOWED`, innocent words it flags (a "Cockpit" is fair play in an
 *      air traffic game).
 *    Free, instant and deterministic, and works with every service down.
 *
 * 2. `flaggedByJev`: Jev, TypeSafe's System One model, judges what a list
 *    can't: a slur spelt a way nobody listed, another language, a phrase
 *    that is only offensive in context. One yes/no question per name (a
 *    Noul, so an answer is a probability), rejected at
 *    `NAME_OFFENSIVE_THRESHOLD`. It fails open: with no `TYPESAFE_API_KEY`,
 *    a slow or failing TypeSafe, or an unreadable answer, the name passes
 *    this layer, so an outage never stops anyone submitting a score. The
 *    list is the floor that always applies.
 *
 * No relative imports: scripts/db/clean-names.mjs loads this file directly.
 */
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
} from "obscenity";

/**
 * Terms the English dataset doesn't cover. Kept short and unambiguous: a
 * substring match has no notion of context, so anything that can sit inside
 * an ordinary name or word ("nazi" in "Nazir") is left to Jev.
 */
const EXTRA_BLOCKED = ["hitler"];

/** Innocent words the dataset flags (matched inside longer words too: "cockpits"). */
const ALLOWED = ["cockpit"];

let matcher: RegExpMatcher | undefined;

/** The word-list matcher, built on first use (the dataset takes a moment to compile). */
function listMatcher(): RegExpMatcher {
  if (matcher) return matcher;
  const dataset = new DataSet<{ originalWord: string }>().addAll(englishDataset);
  for (const word of EXTRA_BLOCKED) {
    dataset.addPhrase((p) =>
      p.setMetadata({ originalWord: word }).addPattern(parseRawPattern(word)),
    );
  }
  for (const word of ALLOWED) {
    dataset.addPhrase((p) => p.setMetadata({ originalWord: word }).addWhitelistedTerm(word));
  }
  matcher = new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });
  return matcher;
}

/** Does the word list reject `name` (as typed, or with its separators removed)? */
export function blockedByList(name: string): boolean {
  const m = listMatcher();
  return m.hasMatch(name) || m.hasMatch(name.replace(/[ _.-]+/g, ""));
}

/**
 * Jev's probability (0-1) above which a name counts as offensive. A guess
 * to tune against real names: raise it if innocent names get rejected,
 * lower it if bad ones slip through.
 */
export const NAME_OFFENSIVE_THRESHOLD = 0.8;

/** Give Jev this long (ms): a player is waiting on the submit. */
const JEV_TIMEOUT_MS = 3000;

/** The part of the TypeSafe client used here, so tests can stand in for the network. */
export interface NameClient {
  systemOne(request: {
    state: unknown;
    questions: { offensive: ReturnType<typeof noul> };
  }): PromiseLike<{
    model?: string;
    usage?: { input_tokens: number; output_tokens: number };
    answers: { offensive: { noul: number } };
  }>;
}

/** What Jev answered: the probability, and which model and how many tokens it took. */
export interface JevAnswer {
  probability: number;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * One JSON line per Jev event, for debugging from Vercel's function logs:
 * search for "nameFilter.jev" (filter by level to see only the errors).
 * Events, in `outcome`: `allowed` / `flagged` (Jev answered: `probability`,
 * `threshold`, `ms`, `model`, `usage`), `cached` (answered from memory,
 * Jev not asked), `error` (Jev didn't answer: `error`, and the name is let
 * through), `budget_exceeded` (an address used up its checks), and, once
 * per server instance, `no_key` (the Jev layer is off). The API key is
 * never logged. Nicknames are: a name Jev refuses is otherwise invisible.
 */
function logJev(level: "log" | "warn" | "error", fields: Record<string, unknown>): void {
  console[level]("nameFilter.jev", JSON.stringify(fields));
}

/** `err` reduced to what helps debugging: never headers or bodies. */
function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  const { status } = err as { status?: unknown };
  return { type: err.name, message: err.message, ...(status !== undefined && { status }) };
}

/** Is a TypeSafe key configured? (Without one the Jev layer is off.) */
export function jevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

let shared: TypeSafeClient | undefined;
function defaultClient(): NameClient {
  // No retries: a submit shouldn't wait on backoff.
  shared ??= new TypeSafeClient({ timeout: JEV_TIMEOUT_MS, retry: { maxRetries: 0 } });
  return shared as unknown as NameClient;
}

/**
 * Jev's answer on whether `name` is unacceptable on a public leaderboard.
 * Throws when it can't get one (no key, network, timeout): callers choose
 * what that means (`flaggedByJev` lets the name through).
 */
export async function askJevDetailed(
  name: string,
  client: NameClient = defaultClient(),
): Promise<JevAnswer> {
  const { answers, model, usage } = await client.systemOne({
    state: {
      context:
        "A player's chosen nickname for the public leaderboard of a family-friendly arcade game.",
      nickname: name,
    },
    questions: {
      offensive: noul(
        "Is `nickname` unacceptable on a public leaderboard? Yes for slurs, hateful or harassing terms, " +
          "sexual or profane words, threats and extremist references, including disguised spellings " +
          "(leetspeak, spacing, punctuation, homophones). No for ordinary names, words and handles, " +
          "including silly, edgy-but-harmless or non-English ones.",
        {
          true: "Offensive: it would upset players or embarrass the game if shown on a public board",
          false: "Acceptable: an ordinary name, word or handle",
        },
      ),
    },
  });
  return { probability: answers.offensive.noul, model, usage };
}

/** Just the probability (0-1) from `askJevDetailed`. */
export async function askJev(name: string, client?: NameClient): Promise<number> {
  return (await askJevDetailed(name, client)).probability;
}

/** Verdicts already given, so a retried submit doesn't ask again (oldest dropped first). */
const verdicts = new Map<string, { flagged: boolean; probability: number }>();
const VERDICTS_MAX = 500;

/** Has this instance said the Jev layer is off (no key) yet? Once is enough. */
let warnedNoKey = false;

/**
 * Does Jev find `name` offensive (at `NAME_OFFENSIVE_THRESHOLD`)? False
 * when there is no key or no answer: this layer fails open. Every outcome
 * is logged (see `logJev`).
 */
export async function flaggedByJev(name: string, client?: NameClient): Promise<boolean> {
  if (!client && !jevConfigured()) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      logJev("warn", {
        outcome: "no_key",
        note: "TYPESAFE_API_KEY is not set: only the word list applies",
      });
    }
    return false;
  }
  const key = name.toLowerCase();
  const known = verdicts.get(key);
  if (known) {
    logJev("log", { outcome: "cached", name, ...known, threshold: NAME_OFFENSIVE_THRESHOLD });
    return known.flagged;
  }
  const started = Date.now();
  try {
    const { probability, model, usage } = await askJevDetailed(name, client);
    const flagged = probability >= NAME_OFFENSIVE_THRESHOLD;
    if (verdicts.size >= VERDICTS_MAX) verdicts.delete(verdicts.keys().next().value as string);
    verdicts.set(key, { flagged, probability });
    logJev("log", {
      outcome: flagged ? "flagged" : "allowed",
      name,
      probability,
      threshold: NAME_OFFENSIVE_THRESHOLD,
      ms: Date.now() - started,
      model,
      usage,
    });
    return flagged;
  } catch (err) {
    logJev("error", {
      outcome: "error",
      name,
      ms: Date.now() - started,
      error: describeError(err),
      note: "letting the name through",
    });
    return false;
  }
}

/** Jev questions one address may cause per minute (each costs API credit). */
const JEV_CHECKS_PER_MINUTE = 20;

/** Question times (ms) per hashed address, for the last minute. */
const recentChecks = new Map<string, number[]>();

/**
 * Take one Jev check from `who`'s allowance; false when they've used it up.
 * Counted per server instance (nothing is stored), so it bounds one
 * instance's spend and is best effort on a scaled-out deploy. It exists
 * because a name Jev rejects is never inserted, so the submit rate limit
 * (which counts inserted runs) doesn't see those attempts.
 */
export function takeJevCheck(who: string, now = Date.now()): boolean {
  const times = (recentChecks.get(who) ?? []).filter((t) => now - t < 60_000);
  const ok = times.length < JEV_CHECKS_PER_MINUTE;
  if (ok) times.push(now);
  else
    logJev("warn", {
      outcome: "budget_exceeded",
      address: who,
      limitPerMinute: JEV_CHECKS_PER_MINUTE,
    });
  recentChecks.set(who, times);
  // Don't let the map grow without bound on a long-lived instance.
  if (recentChecks.size > 5000) {
    for (const [k, v] of recentChecks) if (!v.some((t) => now - t < 60_000)) recentChecks.delete(k);
  }
  return ok;
}
