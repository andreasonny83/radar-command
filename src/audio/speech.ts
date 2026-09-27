/**
 * Spoken words for the PA announcements (audio/ambience.ts), rendered by
 * meSpeak: eSpeak, the open-source speech synthesiser, compiled to
 * JavaScript.
 *
 * meSpeak and eSpeak are GPL-3.0 licensed. They're bundled into the game
 * as served, so the game as a whole is conveyed under GPL-3.0 (the
 * project's own source stays ISC): see the Licenses panel (ui/licenses.ts).
 *
 * The engine is ~1 MB, so it isn't in the main bundle: `loadSpeech` fetches
 * it (engine, config and one voice) as a separate chunk the first time an
 * announcement needs it. `speak` renders a line of text to an AudioBuffer,
 * so the words play through the same tinny PA speaker, hall echo and mixer
 * bus as everything else (mute, pause and volume just work).
 *
 * The same engine voices the crowd chattering in the terminal
 * (audio/crowd.ts): `loadCrowdVoices` adds a few more accents and
 * languages (small files, ~8-120 KB each), and `speakAs` renders a line
 * in any of them.
 */

/** The parts of meSpeak's CommonJS API used here. */
interface MeSpeak {
  loadConfig(config: unknown): void;
  loadVoice(voice: unknown): void;
  speak(text: string, options: Record<string, unknown>): number[] | null;
}

/**
 * How the announcer sounds (meSpeak options). `voice` is the eSpeak voice
 * (British English, "received pronunciation"); `variant` picks a timbre
 * (m1-m7 male, f1-f5 female); `speed` is words per minute (a measured PA
 * pace: slower than conversation); `pitch` is 0-99 (50 = default).
 */
export const ANNOUNCER_VOICES: readonly { variant: string; pitch: number }[] = [
  { variant: "f2", pitch: 55 },
  { variant: "m3", pitch: 42 },
];
const ANNOUNCER_SPEED = 145;
const ANNOUNCER_WORDGAP = 1;
/** The announcer's eSpeak voice, loaded with the engine. */
const ANNOUNCER_VOICE = "en/en-rp";

/**
 * The crowd's voices (eSpeak voice ids): English accents plus the
 * languages you'd overhear at a European regional airport. Each one is a
 * separate chunk; see `CROWD_VOICE_FILES`.
 */
export const CROWD_VOICES = ["en/en-rp", "en/en-us", "en/en-sc", "fr", "de", "es", "it"] as const;
export type CrowdVoice = (typeof CROWD_VOICES)[number];

/**
 * Loaders for the crowd voices beyond the announcer's (spelled out, so
 * the bundler can split each file into its own chunk).
 */
const CROWD_VOICE_FILES: Record<Exclude<CrowdVoice, "en/en-rp">, () => Promise<unknown>> = {
  "en/en-us": () => import("mespeak/voices/en/en-us.json"),
  "en/en-sc": () => import("mespeak/voices/en/en-sc.json"),
  fr: () => import("mespeak/voices/fr.json"),
  de: () => import("mespeak/voices/de.json"),
  es: () => import("mespeak/voices/es.json"),
  it: () => import("mespeak/voices/it.json"),
};

/** How one line is spoken (meSpeak options; see `ANNOUNCER_VOICES`). */
export interface SpeechStyle {
  voice: CrowdVoice;
  /** Timbre: m1-m7 male, f1-f5 female. */
  variant: string;
  /** 0-99, 50 = default. */
  pitch: number;
  /** Words per minute. */
  speed: number;
  /** Extra gap between words (10 ms units). */
  wordgap?: number;
}

let engine: Promise<MeSpeak | null> | null = null;
let crowdVoices: Promise<boolean> | null = null;

/**
 * Load the speech engine (once; later calls share the same promise).
 * Resolves false if it can't load (offline, blocked): announcements then
 * fall back to the wordless babble voice.
 */
export function loadSpeech(): Promise<boolean> {
  engine ??= (async () => {
    try {
      const [mod, config, voice] = await Promise.all([
        import("mespeak"),
        import("mespeak/src/mespeak_config.json"),
        import("mespeak/voices/en/en-rp.json"),
      ]);
      // CommonJS module: its exports arrive as the default export.
      const meSpeak = ((mod as { default?: MeSpeak }).default ?? mod) as MeSpeak;
      meSpeak.loadConfig(config.default ?? config);
      meSpeak.loadVoice(voice.default ?? voice);
      return meSpeak;
    } catch (err) {
      console.warn("Speech engine unavailable; announcements stay wordless.", err);
      return null;
    }
  })();
  return engine.then((m) => m !== null);
}

/**
 * Load the crowd's extra voices (once), after the engine. Resolves false
 * if the engine or any voice can't load: the crowd then keeps to its
 * wordless murmur.
 */
export function loadCrowdVoices(): Promise<boolean> {
  crowdVoices ??= (async () => {
    if (!(await loadSpeech())) return false;
    const meSpeak = (await engine)!;
    try {
      const files = await Promise.all(Object.values(CROWD_VOICE_FILES).map((load) => load()));
      for (const file of files) {
        const voice = (file as { default?: unknown }).default ?? file;
        meSpeak.loadVoice(voice);
      }
      return true;
    } catch (err) {
      console.warn("Crowd voices unavailable; the terminal stays a murmur.", err);
      return false;
    }
  })();
  return crowdVoices;
}

/**
 * Render `text` as the announcer's speech (`voice` indexes
 * `ANNOUNCER_VOICES`), or null if the engine isn't loaded or fails. Call
 * `loadSpeech` first; this never loads it itself.
 */
export function speak(ctx: BaseAudioContext, text: string, voice = 0): Promise<AudioBuffer | null> {
  const { variant, pitch } = ANNOUNCER_VOICES[voice % ANNOUNCER_VOICES.length]!;
  return speakAs(ctx, text, {
    voice: ANNOUNCER_VOICE,
    variant,
    pitch,
    speed: ANNOUNCER_SPEED,
    wordgap: ANNOUNCER_WORDGAP,
  });
}

/**
 * Render `text` in `style`, or null if the engine (or, for the crowd's
 * voices, `loadCrowdVoices`) isn't loaded, or rendering fails. The voice
 * is always named: meSpeak makes the last voice loaded its default, so
 * leaving it out would speak in whichever language arrived last.
 */
export async function speakAs(
  ctx: BaseAudioContext,
  text: string,
  style: SpeechStyle,
): Promise<AudioBuffer | null> {
  const meSpeak = engine ? await engine : null;
  if (!meSpeak) return null;
  const wav = meSpeak.speak(text, {
    rawdata: "array",
    voice: style.voice,
    variant: style.variant,
    pitch: style.pitch,
    speed: style.speed,
    wordgap: style.wordgap ?? 0,
  });
  if (!wav) return null;
  try {
    return await ctx.decodeAudioData(new Uint8Array(wav).buffer);
  } catch {
    return null;
  }
}
