/**
 * Storybook: a workbench for every UI element (HTML HUD + Babylon meshes).
 *
 * Uses the project's own vite.config.ts (Tailwind plugin included), so the
 * stories render with exactly the styles and modules the game ships. Edit a
 * constant in src/config.ts, src/render/*.ts or src/ui/*.ts and the open
 * story hot-reloads with the new value.
 */
import { defineMain } from "@storybook/html-vite/node";

export default defineMain({
  framework: "@storybook/html-vite",
  stories: ["../src/**/*.stories.ts"],
  // Serve public/ like the game does (the Licenses panel fetches its texts
  // from public/licenses/).
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
});
