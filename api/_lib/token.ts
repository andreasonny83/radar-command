/**
 * Run tokens: `runId.issuedAt.signature`.
 *
 * The game asks for one as a shift starts (`POST /api/run`) and sends it
 * back with the score. The signature (HMAC-SHA256 with the server secret)
 * proves the server issued it, so `issuedAt` can be trusted: that's what
 * the time-vs-score plausibility check measures from. `runId` is stored
 * with the score under a unique constraint, so a token submits once.
 *
 * Stateless: nothing is written when a token is issued.
 */
import { hmacKey } from "./http.js";

export interface RunClaims {
  runId: string;
  /** Unix time (seconds) the token was issued. */
  issuedAt: number;
}

/** base64url without padding. */
function toBase64Url(bytes: ArrayBuffer): string {
  let text = "";
  for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Bytes of a base64url string, or null when it isn't one. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A fresh token for a run starting now. */
export async function signRun(now = Date.now()): Promise<string> {
  const payload = `${crypto.randomUUID()}.${Math.floor(now / 1000)}`;
  const key = await hmacKey(["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(mac)}`;
}

/**
 * The claims in `token`, or null when it's malformed or its signature
 * doesn't match. `crypto.subtle.verify` compares in constant time.
 */
export async function verifyRun(token: string): Promise<RunClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [runId, issued, signature] = parts as [string, string, string];
  if (!/^[0-9a-f-]{36}$/.test(runId) || !/^\d{1,12}$/.test(issued)) return null;
  const mac = fromBase64Url(signature);
  if (!mac) return null;
  const key = await hmacKey(["verify"]);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    mac,
    new TextEncoder().encode(`${runId}.${issued}`),
  );
  return ok ? { runId, issuedAt: Number(issued) } : null;
}
