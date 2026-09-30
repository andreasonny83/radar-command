/**
 * "Stats for nerds" panel: frame rate, frame time, renderer and sim numbers
 * in a small monospace box above the bottom-left corner. Markup in
 * hudMarkup.ts (`statsPanelMarkup`); this module fills in the values.
 *
 * DOM-only, so Storybook's HUD stories can mount it without Babylon. The
 * numbers themselves are gathered in main.ts (render/sceneStats.ts for the
 * renderer, ui/frameStats.ts for the frame rate).
 */

/** Everything the panel shows, gathered by main.ts once per refresh. */
export interface StatsSample {
  /** Smoothed frames per second (ui/frameStats.ts). */
  fps: number;
  /** Smoothed frame time (ms). */
  frameMs: number;
  /** Frames per second of the slowest 1% of recent frames. */
  low: number;
  /** CPU time spent in `scene.render` (ms). */
  renderMs: number;
  drawCalls: number;
  activeMeshes: number;
  triangles: number;
  /** Drawing buffer size (px) and Babylon's hardware scaling level (shown as pixel density, 1 / scaling). */
  width: number;
  height: number;
  scaling: number;
  /** Planes in the air or rolling out (not landed or departed yet). */
  planes: number;
  /** Game speed multiplier. */
  speed: number;
  /** Simulation sub-steps run in the last frame (more than 1 at fast speeds). */
  steps: number;
  /** Seconds of the shift so far. */
  elapsed: number;
  /** Used JS heap in MB; `null` where the browser doesn't expose it (not Chromium). */
  heapMb: number | null;
}

/** Static facts about the machine, shown once. */
export interface StatsInfo {
  /** GPU name and graphics API, e.g. "Apple M2 · WebGL 2". */
  gpu: string;
}

/** How often the values are rewritten (ms): readable, and cheap. */
export const STATS_REFRESH_MS = 250;

/** Rows in display order: the `data-stat` key and its label. */
export const STAT_SECTIONS: ReadonlyArray<{
  title: string;
  rows: ReadonlyArray<{ key: keyof typeof FORMATTERS | "gpu"; label: string }>;
}> = [
  {
    title: "Frame",
    rows: [
      { key: "fps", label: "FPS" },
      { key: "low", label: "1% low" },
      { key: "frame", label: "Frame time" },
      { key: "render", label: "Render (CPU)" },
    ],
  },
  {
    title: "Renderer",
    rows: [
      { key: "draws", label: "Draw calls" },
      { key: "meshes", label: "Active meshes" },
      { key: "tris", label: "Triangles" },
      { key: "size", label: "Buffer" },
      { key: "gpu", label: "GPU" },
    ],
  },
  {
    title: "Game",
    rows: [
      { key: "planes", label: "Planes" },
      { key: "speed", label: "Speed" },
      { key: "steps", label: "Sim steps/frame" },
      { key: "elapsed", label: "Shift time" },
      { key: "heap", label: "JS heap" },
    ],
  },
];

const int = new Intl.NumberFormat("en-GB");

/** How each sample field reads in the panel. */
const FORMATTERS = {
  fps: (s: StatsSample) => s.fps.toFixed(0),
  low: (s: StatsSample) => s.low.toFixed(0),
  frame: (s: StatsSample) => `${s.frameMs.toFixed(1)} ms`,
  render: (s: StatsSample) => `${s.renderMs.toFixed(1)} ms`,
  draws: (s: StatsSample) => int.format(s.drawCalls),
  meshes: (s: StatsSample) => int.format(s.activeMeshes),
  tris: (s: StatsSample) => int.format(s.triangles),
  size: (s: StatsSample) =>
    `${s.width}×${s.height}${s.scaling !== 1 ? ` @${(1 / s.scaling).toFixed(1)}×` : ""}`,
  planes: (s: StatsSample) => String(s.planes),
  speed: (s: StatsSample) => `${s.speed}×`,
  steps: (s: StatsSample) => String(s.steps),
  elapsed: (s: StatsSample) => {
    const total = Math.floor(s.elapsed);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  },
  heap: (s: StatsSample) => (s.heapMb === null ? "n/a" : `${s.heapMb.toFixed(0)} MB`),
};

/** Colour of the FPS figure: green at speed, amber, then red. */
function fpsTone(fps: number): string {
  if (fps >= 55) return "#4ade80";
  if (fps >= 30) return "#fbbf24";
  return "#f87171";
}

export interface StatsPanel {
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  setInfo(info: StatsInfo): void;
  /**
   * Call every frame while visible. `read` is only invoked (and the DOM only
   * touched) every `STATS_REFRESH_MS`, so the sorting behind the 1% low runs
   * a few times a second, not per frame. `now` is a millisecond clock.
   */
  update(now: number, read: () => StatsSample | null): void;
}

export function createStatsPanel(root: HTMLElement): StatsPanel {
  const panel = root.querySelector<HTMLElement>("#statsPanel");
  if (!panel) throw new Error("Missing #statsPanel");
  const cells = new Map<string, HTMLElement>();
  panel.querySelectorAll<HTMLElement>("[data-stat]").forEach((el) => {
    if (el.dataset.stat) cells.set(el.dataset.stat, el);
  });
  let shown = false;
  let lastWrite = -Infinity;

  const write = (key: string, text: string, color?: string) => {
    const el = cells.get(key);
    if (!el) return;
    if (el.textContent !== text) el.textContent = text;
    el.style.color = color ?? "";
  };

  return {
    get visible() {
      return shown;
    },
    setVisible(visible) {
      if (visible === shown) return;
      shown = visible;
      // `hidden` and `flex` both set `display`, so swap them rather than stack.
      panel.classList.toggle("hidden", !visible);
      panel.classList.toggle("flex", visible);
      // Refresh on the very next frame after opening.
      lastWrite = -Infinity;
    },
    setInfo(info) {
      write("gpu", info.gpu);
      const el = cells.get("gpu");
      if (el) el.title = info.gpu;
    },
    update(now, read) {
      if (!shown || now - lastWrite < STATS_REFRESH_MS) return;
      const sample = read();
      if (!sample) return;
      lastWrite = now;
      for (const [key, format] of Object.entries(FORMATTERS)) {
        write(key, format(sample), key === "fps" ? fpsTone(sample.fps) : undefined);
      }
    },
  };
}
