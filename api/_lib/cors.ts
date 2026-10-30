/**
 * CORS for the leaderboard functions, so the native app can call them.
 *
 * On the web the game and the API share an origin and need none of this. The
 * Android app's WebView runs at https://localhost (Capacitor) and calls the
 * production API cross-origin, and a JSON `POST` makes the browser send an
 * `OPTIONS` preflight first.
 *
 * `*` is safe here: the API is public and anonymous. It reads no cookies or
 * other ambient credentials (a run's proof is the signed token in the body),
 * and a request from any origin is rate-limited by address like any other.
 * It also keeps the CDN-cached leaderboard replies identical for everyone
 * (no `Vary: Origin` to split the cache).
 */

import { fail } from "./http.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Browsers may reuse a preflight answer this long (s).
  "access-control-max-age": "86400",
};

type Handler = (request: Request) => Promise<Response>;

/**
 * `handler`, with the CORS headers added to whatever it answers. A handler
 * that throws still gets them, on a `server` error: without the headers the
 * browser would hide the 500 behind an opaque network failure and the game
 * couldn't tell "server broke" from "offline".
 */
export function withCors(handler: Handler): Handler {
  return async (request) => {
    let response: Response;
    try {
      response = await handler(request);
    } catch (err) {
      console.error("api: unhandled error", err);
      response = fail("server");
    }
    for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
    return response;
  };
}

/** The answer to a preflight: no body, just the CORS headers. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
