/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { espeakNgData } from "./vite-plugins/espeakNgData.ts";

export default defineConfig({
  plugins: [
    tailwindcss(),
    // The speech engine's voice data (src/audio/speech.ts), trimmed to the
    // language the PA speaks (`ANNOUNCER_VOICE`).
    espeakNgData(["en"]),
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
