/// <reference types="vitest/config" />
/// <reference types="node" />
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * meSpeak's engine (node_modules/mespeak/src/ESpeak.js, the PA voice: see
 * src/audio/speech.ts) is saved as Latin-1, not UTF-8: a few comments hold
 * accented letters ("// À .. Ö"). The bundler only reads UTF-8 and refuses
 * the file, so read it as Latin-1 instead. Only those comments change (they
 * become proper UTF-8); the code is plain ASCII and stays byte for byte the
 * same. Used for the build and for dev pre-bundling alike.
 */
function latin1Source(file: RegExp): Plugin {
  return {
    name: "latin1-source",
    load(id) {
      return file.test(id) ? readFileSync(id, "latin1") : null;
    },
  };
}
const meSpeakEngine = latin1Source(/[\\/]mespeak[\\/]src[\\/]ESpeak\.js$/);

export default defineConfig({
  plugins: [tailwindcss(), meSpeakEngine],
  optimizeDeps: {
    rolldownOptions: { plugins: [meSpeakEngine] },
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
