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

let engine: Promise<MeSpeak | null> | null = null;

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
 * Render `text` as the announcer's speech (`voice` indexes
 * `ANNOUNCER_VOICES`), or null if the engine isn't loaded or fails. Call
 * `loadSpeech` first; this never loads it itself.
 */
export async function speak(
  ctx: BaseAudioContext,
  text: string,
  voice = 0,
): Promise<AudioBuffer | null> {
  const meSpeak = engine ? await engine : null;
  if (!meSpeak) return null;
  const { variant, pitch } = ANNOUNCER_VOICES[voice % ANNOUNCER_VOICES.length]!;
  const wav = meSpeak.speak(text, {
    rawdata: "array",
    variant,
    pitch,
    speed: ANNOUNCER_SPEED,
    wordgap: ANNOUNCER_WORDGAP,
  });
  if (!wav) return null;
  try {
    return await ctx.decodeAudioData(new Uint8Array(wav).buffer);
  } catch {
    return null;
  }
}
