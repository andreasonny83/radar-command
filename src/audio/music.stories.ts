/**
 * The background music (audio/music.ts) through the game's own mixer
 * (audio/mixer.ts), for tuning by ear.
 *
 * Press "Start audio" first: browsers only play sound after a click. The
 * args switch the three layers (pads, piano, bass) on and off,
 * pick the game scene the mix is set for (full on the title and in play,
 * dipped while paused, faded out after a crash) and change the tempo
 * (seconds per chord). The panel shows the chord sounding now.
 *
 * Tuning loop: the chord loop (`MUSIC_PROGRESSION`), `CHORD_SECONDS`, the
 * layer levels (`LAYER_LEVELS`), pad / piano / reverb / ambience constants
 * in music.ts; the bus levels (`MUSIC_VOLUME`, `SCENE_LEVELS`) in mixer.ts.
 * Save and the story reloads (press Start again). The airport ambience
 * that plays alongside (chatter, announcements, jets) has its own story,
 * "Audio/Effects".
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { createGameState } from "../core/state";
import { GameAudio, type AudioScene } from "./mixer";
import { CHORD_SECONDS, MUSIC_PROGRESSION, type MusicLayer } from "./music";

interface MusicArgs {
  pads: boolean;
  piano: boolean;
  bass: boolean;
  /** The game scene the mix is set for. */
  scene: AudioScene;
  /** Seconds per chord (the game uses `CHORD_SECONDS`). */
  chordSeconds: number;
}

const LAYERS: MusicLayer[] = ["pads", "piano", "bass"];

/** The audio of the story on screen; closed when the next one mounts. */
let active: { audio: GameAudio; frame: number } | null = null;

const meta: Meta<MusicArgs> = {
  title: "Audio/Music",
  argTypes: {
    scene: { control: "inline-radio", options: ["title", "playing", "paused", "crash"] },
    chordSeconds: { control: { type: "range", min: 4, max: 16, step: 0.5 } },
  },
  args: {
    pads: true,
    piano: true,
    bass: true,
    scene: "playing",
    chordSeconds: CHORD_SECONDS,
  },
};
export default meta;

export const Music: StoryObj<MusicArgs> = {
  render: (args) => {
    if (active) {
      cancelAnimationFrame(active.frame);
      active.audio.close();
      active = null;
    }
    const root = document.createElement("div");
    root.className =
      "flex h-full w-full items-center justify-center bg-slate-950 p-8 text-slate-100";
    root.innerHTML = `
      <div class="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg">
        <h2 class="glow-text mb-1 text-2xl font-black tracking-wider text-sky-400">Background music</h2>
        <p class="mb-5 text-sm text-slate-400">Generative airport-lounge ambience (audio/music.ts)</p>
        <button id="startAudio" class="hud-button w-auto px-4 text-base">▶ Start audio</button>
        <div class="mt-6 text-xs font-bold tracking-widest text-slate-400 uppercase">Chord</div>
        <div id="chords" class="mt-2 flex gap-2"></div>
        <div id="status" class="mt-4 text-sm text-slate-400">Stopped: press Start.</div>
      </div>`;
    const chords = root.querySelector<HTMLElement>("#chords")!;
    chords.innerHTML = MUSIC_PROGRESSION.map(
      (c) =>
        `<span class="chord rounded-lg border border-slate-700 px-3 py-1 font-mono text-sm text-slate-400 transition">${c.name}</span>`,
    ).join("");
    const chips = Array.from(chords.querySelectorAll<HTMLElement>(".chord"));
    const status = root.querySelector<HTMLElement>("#status")!;

    // No storage: the args decide, not the player's saved settings.
    const audio = new GameAudio(null);
    audio.setScene(args.scene);
    const state = createGameState(); // no planes: music only
    const session = { audio, frame: 0 };
    active = session;

    root.querySelector<HTMLButtonElement>("#startAudio")!.addEventListener("click", () => {
      audio.unlock();
      // Music alone: the ambience has its own story.
      for (const layer of ["room", "chatter", "pa", "outside"] as const) {
        audio.setAmbienceLayer(layer, false);
      }
      audio.music?.setChordSeconds(args.chordSeconds);
      for (const layer of LAYERS) audio.setMusicLayer(layer, args[layer]);
      status.textContent = `Playing: scene "${args.scene}", ${args.chordSeconds} s per chord.`;
    });

    let mounted = false;
    const tick = () => {
      // Stop once Storybook has moved on to another story (the root is
      // attached after `render` returns, so only after it has been).
      mounted ||= root.isConnected;
      if (mounted && !root.isConnected) {
        audio.close();
        if (active === session) active = null;
        return;
      }
      audio.update(state);
      const current = audio.music?.currentChord() ?? null;
      chips.forEach((chip, i) => {
        const on = i === current;
        // Swap, don't stack: two text/border colours on one element fight.
        chip.classList.toggle("border-sky-400", on);
        chip.classList.toggle("text-sky-300", on);
        chip.classList.toggle("border-slate-700", !on);
        chip.classList.toggle("text-slate-400", !on);
      });
      session.frame = requestAnimationFrame(tick);
    };
    session.frame = requestAnimationFrame(tick);
    return root;
  },
};
