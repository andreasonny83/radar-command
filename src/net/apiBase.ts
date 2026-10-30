/**
 * Where the leaderboard API lives.
 *
 * On the web the game and `/api/*` share an origin, so paths stay relative
 * (empty base). The native app's pages are served from inside the app
 * (https://localhost), where a relative `/api/...` would hit nothing, so its
 * build (`vite build --mode android`) sets `VITE_API_BASE_URL` in
 * `.env.android` to the production site and every call goes there instead
 * (the API answers with CORS headers: api/_lib/cors.ts).
 */
const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

/** `path` ("/api/...") on the API's origin. */
export function apiUrl(path: string): string {
  return `${base}${path}`;
}
