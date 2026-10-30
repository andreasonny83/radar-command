/**
 * Offline support: registers the service worker that vite-plugin-pwa
 * generates at build time (see vite.config.ts), so once the game has loaded it
 * opens and plays without a network. Only the leaderboard needs one, and it
 * already copes with the API being down.
 *
 * `registerType: "prompt"` and no `onNeedRefresh` handler: a new deploy is
 * downloaded in the background and waits; it takes over the next time the game
 * is opened from a closed tab, so a shift is never reloaded under the player.
 *
 * Production only: in `npm run dev` a service worker would serve stale
 * modules and fight Vite's hot reload.
 */
import { registerSW } from "virtual:pwa-register";

export function registerOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  registerSW({ immediate: true });
}
