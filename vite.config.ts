/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { apiDev } from "./vite-plugins/apiDev.ts";
import { espeakNgData } from "./vite-plugins/espeakNgData.ts";
import { seo } from "./vite-plugins/seo.ts";

// Storybook reuses this file; it is a separate site that must not get the
// game's sitemap, robots.txt or service worker.
const storybook = Boolean(process.env.STORYBOOK);

export default defineConfig({
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
          seo(),
          // Service worker: precaches the app shell, scripts and sounds so the
          // game opens and plays offline (src/ui/offline.ts registers it).
          VitePWA({
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
              // The leaderboard API and the licence texts always go to the network.
              navigateFallbackDenylist: [/^\/api\//, /^\/licenses\//],
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
});
