/**
 * The game's recorded sounds: real, copyright-free field recordings cut by
 * the audio pipeline (scripts/audio/build-audio.mjs, from
 * scripts/audio/sources.json) into src/audio/assets/, credited in the
 * Licenses panel (ui/licenses.ts) and CREDITS.md.
 *
 * - loops (FLAC, sample-exact, seamless): each aircraft type's engines at
 *   idle and at full power, the rollout rumble, the gear's hydraulic pump;
 * - one-shots (MP3): the touchdown chirp, reverse thrust, the gear clunk,
 *   three fly-by whooshes;
 * - the terminal bed (MP3, 60 s): the ambience's `terminal` layer.
 *
 * `Samples` fetches and decodes all of them once, in the background, when
 * the mixer starts (audio/mixer.ts). Until a file has decoded, or if it
 * fails, `get` returns null and whoever plays it skips that sound: nothing
 * falls back to the synthesiser.
 */
import engineJetFull from "./assets/engine-jet-full.flac?url";
import engineJetIdle from "./assets/engine-jet-idle.flac?url";
import enginePistonFull from "./assets/engine-piston-full.flac?url";
import enginePistonIdle from "./assets/engine-piston-idle.flac?url";
import engineTurbopropFull from "./assets/engine-turboprop-full.flac?url";
import engineTurbopropIdle from "./assets/engine-turboprop-idle.flac?url";
import gearClunk from "./assets/gear-clunk.mp3?url";
import gearHydraulic from "./assets/gear-hydraulic.flac?url";
import reverseThrust from "./assets/reverse-thrust.mp3?url";
import rollout from "./assets/rollout.flac?url";
import terminal from "./assets/terminal.mp3?url";
import touchdownChirp from "./assets/touchdown-chirp.mp3?url";
import whoosh1 from "./assets/whoosh-1.mp3?url";
import whoosh2 from "./assets/whoosh-2.mp3?url";
import whoosh3 from "./assets/whoosh-3.mp3?url";

/** Where each recorded sound is served from (hashed asset URLs in the build). */
export const SAMPLE_URLS = {
  terminal,
  "engine-jet-idle": engineJetIdle,
  "engine-jet-full": engineJetFull,
  "engine-turboprop-idle": engineTurbopropIdle,
  "engine-turboprop-full": engineTurbopropFull,
  "engine-piston-idle": enginePistonIdle,
  "engine-piston-full": enginePistonFull,
  rollout,
  "gear-hydraulic": gearHydraulic,
  "touchdown-chirp": touchdownChirp,
  "reverse-thrust": reverseThrust,
  "gear-clunk": gearClunk,
  "whoosh-1": whoosh1,
  "whoosh-2": whoosh2,
  "whoosh-3": whoosh3,
} as const;

export type SampleId = keyof typeof SAMPLE_URLS;

/** The sounds that loop (see the header): the rest play once. */
export const LOOPED: ReadonlySet<SampleId> = new Set<SampleId>([
  "engine-jet-idle",
  "engine-jet-full",
  "engine-turboprop-idle",
  "engine-turboprop-full",
  "engine-piston-idle",
  "engine-piston-full",
  "rollout",
  "gear-hydraulic",
]);

export class Samples {
  private readonly buffers = new Map<SampleId, AudioBuffer>();
  /** Settles once every file has loaded or failed (never rejects). */
  readonly ready: Promise<void>;

  /** Start fetching and decoding every sound for `ctx`, in the background. */
  constructor(ctx: BaseAudioContext) {
    const ids = Object.keys(SAMPLE_URLS) as SampleId[];
    this.ready = Promise.all(ids.map((id) => this.load(ctx, id))).then(() => undefined);
  }

  /** The decoded sound, or null if it hasn't loaded (yet, or at all). */
  get(id: SampleId): AudioBuffer | null {
    return this.buffers.get(id) ?? null;
  }

  /** How many sounds have decoded so far. */
  get loaded(): number {
    return this.buffers.size;
  }

  private async load(ctx: BaseAudioContext, id: SampleId): Promise<void> {
    const url = SAMPLE_URLS[id];
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.buffers.set(id, await ctx.decodeAudioData(await response.arrayBuffer()));
    } catch (err) {
      console.warn(`Sound "${id}" unavailable (${url}); it stays silent.`, err);
    }
  }
}
