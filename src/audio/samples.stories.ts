/**
 * Every recorded sound (audio/samples.ts) on its own, raw: the listening
 * bench for the cuts made by the audio pipeline.
 *
 * Press "Start audio" (browsers only play sound after a click), then play
 * any sound; loops repeat until stopped, so a seam or a click at the loop
 * point is easy to hear. Each row names the recording it was cut from.
 *
 * Tuning loop: change a cut (`cut.start` / `cut.length`) or its processing
 * in scripts/audio/sources.json, run `npm run audio:build`, then reload
 * the story. How the game plays these (levels, pitch, blending) lives in
 * audio/sfx.ts and audio/ambience.ts: hear that in "Audio/Effects".
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import credits from "./assets/credits.json";
import { LOOPED, SAMPLE_URLS, Samples, type SampleId } from "./samples";

/** The audio of the story on screen; closed when the next one mounts. */
let active: AudioContext | null = null;

const meta: Meta = { title: "Audio/Samples" };
export default meta;

/** The recording a sound was cut from (its file is `<id>.flac|mp3`). */
function creditFor(id: SampleId) {
  return credits.find((c) => c.files.some((f) => f.replace(/\.\w+$/, "") === id));
}

export const AllSamples: StoryObj = {
  name: "Samples",
  render: () => {
    void active?.close();
    active = null;
    const root = document.createElement("div");
    root.className =
      "flex h-full w-full items-center justify-center bg-slate-950 p-8 text-slate-100";
    const panel = document.createElement("div");
    panel.className =
      "w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg";
    panel.innerHTML = `
      <h2 class="glow-text mb-1 text-2xl font-black tracking-wider text-sky-400">Recorded sounds</h2>
      <p class="mb-5 text-sm text-slate-400">src/audio/assets/, cut by npm run audio:build</p>`;
    const start = document.createElement("button");
    start.className = "hud-button mb-4 w-auto px-4 text-base";
    start.textContent = "▶ Start audio";
    const status = document.createElement("div");
    status.className = "mb-4 text-sm text-slate-400";
    status.textContent = "Stopped: press Start.";
    const list = document.createElement("div");
    list.className = "divide-y divide-slate-800";
    panel.append(start, status, list);
    root.append(panel);

    let samples: Samples | null = null;
    let ctx: AudioContext | null = null;
    /** What's playing, per sound (loops keep going until pressed again). */
    const playing = new Map<SampleId, AudioBufferSourceNode>();

    for (const id of Object.keys(SAMPLE_URLS) as SampleId[]) {
      const credit = creditFor(id);
      const row = document.createElement("div");
      row.className = "flex items-center gap-3 py-2";
      const button = document.createElement("button");
      button.className = "hud-button h-9 w-9 shrink-0 text-base";
      button.textContent = "▶";
      button.title = `Play ${id}`;
      const label = document.createElement("div");
      label.className = "min-w-0 flex-1";
      label.innerHTML = `
        <div class="font-mono text-sm text-slate-100">${id}${LOOPED.has(id) ? " <span class='text-sky-400'>(loop)</span>" : ""}
          <span data-duration class="text-slate-500"></span></div>
        <div class="truncate text-xs text-slate-400">${
          credit
            ? `<a class="text-sky-300 underline" href="${credit.url}" target="_blank" rel="noopener noreferrer">${credit.title}</a> by ${credit.author}, ${credit.license}`
            : ""
        }</div>`;
      row.append(button, label);
      list.append(row);

      button.addEventListener("click", () => {
        const buffer = samples?.get(id);
        if (!ctx || !buffer) {
          status.textContent = ctx ? `${id} hasn't loaded.` : "Press Start first.";
          return;
        }
        const current = playing.get(id);
        if (current) {
          current.stop();
          return;
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = LOOPED.has(id);
        src.connect(ctx.destination);
        src.addEventListener("ended", () => {
          playing.delete(id);
          button.textContent = "▶";
        });
        src.start();
        playing.set(id, src);
        button.textContent = "■";
      });
    }

    start.addEventListener("click", () => {
      if (ctx) return;
      ctx = new AudioContext();
      active = ctx;
      samples = new Samples(ctx);
      status.textContent = "Loading…";
      void samples.ready.then(() => {
        const total = Object.keys(SAMPLE_URLS).length;
        status.textContent = `${samples!.loaded}/${total} loaded. Press ▶ to play, ■ to stop a loop.`;
        for (const [i, id] of (Object.keys(SAMPLE_URLS) as SampleId[]).entries()) {
          const buffer = samples!.get(id);
          const cell = list.children[i]?.querySelector("[data-duration]");
          if (cell && buffer) cell.textContent = ` ${buffer.duration.toFixed(2)} s`;
        }
      });
    });
    return root;
  },
};
