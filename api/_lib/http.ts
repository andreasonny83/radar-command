/// <reference types="node" />
/**
 * Small HTTP helpers for the leaderboard functions: JSON responses, the
 * `{ error: code }` shape, the caller's address and the server secret.
 *
 * Files under api/_lib are shared code, not routes: Vercel skips paths
 * that start with an underscore when it builds functions.
 */
import type { ApiErrorCode } from "../../src/core/leaderboard.js";

/** A JSON response (never cached unless `headers` say otherwise). */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** HTTP status for each error code. */
const ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  bad_name: 400,
  implausible: 400,
  bad_token: 401,
  expired: 401,
  duplicate: 409,
  rate_limited: 429,
  server: 500,
};

/** A failed request, as `{ error: code }` with the matching status. */
export function fail(code: ApiErrorCode): Response {
  return json({ error: code }, ERROR_STATUS[code]);
}

/**
 * The secret that signs run tokens and hashes addresses
 * (`LEADERBOARD_SECRET`, 32+ random bytes). Throws when it's missing or
 * short, so a misconfigured deploy fails loudly (as a 500) rather than
 * signing with a guessable key.
 */
export function secret(): string {
  const value = process.env.LEADERBOARD_SECRET;
  if (!value || value.length < 32) throw new Error("LEADERBOARD_SECRET is not set (32+ chars)");
  return value;
}

/**
 * The caller's IP address. On Vercel the edge network sets
 * `x-forwarded-for` itself (a client can't spoof its first entry); the dev
 * middleware (vite-plugins/apiDev.ts) fills it from the socket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** Hex string of `bytes`. */
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 key from `secret()`, for `usages`. */
export function hmacKey(usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

/**
 * The caller's address, keyed-hashed: enough to rate-limit by address
 * without ever storing the address itself.
 */
export async function ipHash(request: Request): Promise<string> {
  const key = await hmacKey(["sign"]);
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`ip:${clientIp(request)}`),
  );
  return hex(mac);
}
