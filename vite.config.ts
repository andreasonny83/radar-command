/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { apiDev } from "./vite-plugins/apiDev.ts";
import { espeakNgData } from "./vite-plugins/espeakNgData.ts";
import { seo } from "./vite-plugins/seo.ts";

// Storybook reuses this file; it is a separate site that must not get the
// game's sitemap, robots.txt or service worker.
const storybook = Boolean(process.env.STORYBOOK);

export default defineConfig(({ mode }) => {
  // The Android app (capacitor.config.ts): assets ship inside the app, so no
  // service worker, sitemap or robots.txt; `.env.android` sets the API origin.
  const native = mode === "android";
  if (native) {
    // Without it the app would call its own https://localhost/api/... and the
    // leaderboard would never work, with no build error to say so.
    const apiBase = loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE_URL;
    if (!apiBase?.startsWith("https://")) {
      throw new Error(
        "Android build: set VITE_API_BASE_URL=https://<production domain> in .env.android " +
          "(the origin whose /api/* the app calls).",
      );
    }
  }
  return {
    plugins: [
      tailwindcss(),
      // The speech engine's voice data (src/audio/speech.ts), trimmed to the
      // language the PA speaks (`ANNOUNCER_VOICE`).
      espeakNgData(["en"]),
      // The leaderboard functions (api/*.ts) on the dev server, as Vercel
      // serves them in production.
      apiDev(),
      ...(storybook
        ? []
        : [
            // Canonical / social URLs, robots.txt and sitemap.xml (vite-plugins/seo.ts).
            seo({ emitFiles: !native }),
            // Service worker: precaches the app shell, scripts and sounds so the
            // game opens and plays offline (src/ui/offline.ts registers it).
            VitePWA({
              // The native app has its assets inside; the registration stays a no-op.
              disable: native,
              // public/manifest.webmanifest is hand-written and linked from index.html.
              manifest: false,
              injectRegister: false,
              // "prompt": a new build waits until the game is closed and reopened,
              // so a deploy never reloads the page mid-shift.
              registerType: "prompt",
              workbox: {
                globPatterns: ["**/*.{html,js,css,wasm,data,flac,mp3,svg,png,webmanifest}"],
                // The main bundle and the speech engine are over Workbox's 2 MiB default.
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                // The leaderboard API, the licence texts and the privacy page always go to the network.
                navigateFallbackDenylist: [/^\/api\//, /^\/licenses\//, /^\/privacy\.html$/],
                cleanupOutdatedCaches: true,
              },
            }),
          ]),
    ],
    optimizeDeps: {
      // Served as is, so espeakNgData can trim the engine's package listing.
      exclude: ["@echogarden/espeak-ng-emscripten"],
    },
    build: {
      // Babylon core is large even when tree-shaken; raise the warning threshold
      // so a normal build does not spam chunk-size warnings.
      chunkSizeWarningLimit: 2000,
    },
    test: {
      // Only the pure simulation layer is unit tested; it has no DOM dependency.
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});
