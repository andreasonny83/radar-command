/**
 * The game's side of the leaderboard: typed `fetch` wrappers for the
 * api/ routes, plus what the browser remembers between visits (anonymous
 * player id, nickname, last board viewed) in localStorage.
 *
 * Nothing here throws: every call resolves to a result the UI can show,
 * with "offline" for a network failure or timeout. The game must stay
 * fully playable when the API is down or not deployed.
 */
import {
  isBoard,
  type ApiErrorCode,
  type Board,
  type BoardResponse,
  type RunResponse,
  type SubmitRequest,
  type SubmitResponse,
} from "../core/leaderboard";

/** Give up on a request after this long (ms): the game never waits on it. */
const TIMEOUT_MS = 8000;

/** Anything a call can fail with: the API's own codes, or no answer at all. */
export type LeaderboardError = ApiErrorCode | "offline";

export type Result<T> = { ok: true; data: T } | { ok: false; error: LeaderboardError };

/** POST/GET `path` and parse the JSON reply into a `Result`. */
async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && body !== null) return { ok: true, data: body as T };
    const code = (body as { error?: unknown } | null)?.error;
    // A reply that isn't ours (e.g. a static host's 404 page): no API here.
    return { ok: false, error: typeof code === "string" ? (code as ApiErrorCode) : "offline" };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/**
 * A signed run token for the shift starting now, or null without one
 * (offline: that run can't be submitted, but plays the same).
 */
export async function startRun(): Promise<string | null> {
  const result = await call<RunResponse>("/api/run", { method: "POST" });
  return result.ok ? result.data.token : null;
}

/** Submit a finished run. */
export function submitScore(request: SubmitRequest): Promise<Result<SubmitResponse>> {
  return call<SubmitResponse>("/api/scores", { method: "POST", body: JSON.stringify(request) });
}

/**
 * One board, with the player's own rank when `playerId` is given. `name` is
 * the nickname playing now: people sharing a browser share its `playerId`,
 * so the name says which of them is "you".
 */
export function fetchBoard(
  board: Board,
  playerId?: string,
  name?: string,
): Promise<Result<BoardResponse>> {
  const query = new URLSearchParams({ board });
  if (playerId) query.set("playerId", playerId);
  if (playerId && name) query.set("name", name);
  return call<BoardResponse>(`/api/leaderboard?${query}`);
}

/** Short, player-facing text for a failed call. */
export function errorMessage(error: LeaderboardError): string {
  switch (error) {
    case "offline":
      return "Leaderboard unreachable. Check your connection.";
    case "bad_name":
      return "That name isn't allowed.";
    case "bad_token":
    case "expired":
      return "This shift can't be submitted any more.";
    case "implausible":
      return "That score doesn't add up for this shift.";
    case "duplicate":
      return "This shift is already on the board.";
    case "rate_limited":
      return "Too many submissions. Try again in a minute.";
    case "bad_request":
    case "server":
      return "The leaderboard hit a snag. Try again later.";
  }
}

/** Can the same run be sent again after `error` (vs. never for this run)? */
export function isRetryable(error: LeaderboardError): boolean {
  return error === "offline" || error === "rate_limited" || error === "server";
}

// ---------------------------------------------------------------------------
// Remembered between visits
// ---------------------------------------------------------------------------

const PLAYER_ID_KEY = "radar-command.playerId";
const NAME_KEY = "radar-command.name";
const BOARD_KEY = "radar-command.board";

/** localStorage, or nothing (private mode, storage disabled, Storybook in a sandbox). */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

/** A random v4 UUID, also where `crypto.randomUUID` is missing (plain http). */
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * This browser's anonymous player id: made up on first use and kept, so a
 * player's runs group together on the boards. Not an account: clearing
 * site data starts a new player.
 */
export function playerId(): string {
  const saved = read(PLAYER_ID_KEY);
  if (saved) return saved;
  const id = randomUuid();
  write(PLAYER_ID_KEY, id);
  return id;
}

/** The nickname last submitted from this browser ("" the first time). */
export function savedName(): string {
  return read(NAME_KEY) ?? "";
}

export function saveName(name: string): void {
  write(NAME_KEY, name);
}

/** The board tab last viewed (daily the first time). */
export function savedBoard(): Board {
  const board = read(BOARD_KEY);
  return isBoard(board) ? board : "daily";
}

export function saveBoard(board: Board): void {
  write(BOARD_KEY, board);
}
