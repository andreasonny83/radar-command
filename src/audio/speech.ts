/**
 * Spoken words for the PA announcements (audio/ambience.ts), rendered by
 * eSpeak NG, the open-source speech synthesiser, compiled to JavaScript
 * (@echogarden/espeak-ng-emscripten).
 *
 * eSpeak NG is GPL-3.0 licensed. It's bundled into the game as served, so
 * the game as a whole is conveyed under GPL-3.0 (the project's own source
 * stays ISC): see the Licenses panel (ui/licenses.ts).
 *
 * The engine (~0.8 MB) and its voice data (English only, trimmed at
 * build time by vite-plugins/espeakNgData.ts) aren't in the main bundle:
 * `loadSpeech` fetches both the first time the ambience starts. `speak`
 * renders a line of text to an AudioBuffer, so the words play through the
 * same tinny PA speaker, hall echo and mixer bus as everything else (mute,
 * pause and volume just work).
 */
import type { eSpeakNGWorker } from "@echogarden/espeak-ng-emscripten";
import ESPEAK_DATA_URL from "virtual:espeak-ng-data";

/**
 * How the announcer sounds (eSpeak NG settings). The voice is British
 * English, "received pronunciation" (`ANNOUNCER_VOICE`); `variant` picks a
 * timbre (m1-m8 male, f1-f5 female); `speed` is words per minute (a
 * measured PA pace: slower than conversation); `pitch` is 0-100 (50 =
 * default).
 */
export const ANNOUNCER_VOICES: readonly { variant: string; pitch: number }[] = [
  { variant: "f2", pitch: 55 },
  { variant: "m3", pitch: 42 },
];
const ANNOUNCER_SPEED = 145;
/**
 * eSpeak NG voice name. Only English voice data is bundled: another
 * language needs adding to `espeakNgData` in vite.config.ts too.
 */
const ANNOUNCER_VOICE = "en-US";

let engine: Promise<eSpeakNGWorker | null> | null = null;

/**
 * Load the speech engine and its voices (once; later calls share the same
 * promise). Resolves false if it can't load (offline, blocked):
 * announcements then fall back to the wordless babble voice.
 */
export function loadSpeech(): Promise<boolean> {
  engine ??= (async () => {
    try {
      // Fetch the engine and its voice data side by side.
      const [{ default: create }, data] = await Promise.all([
        import("@echogarden/espeak-ng-emscripten"),
        fetch(ESPEAK_DATA_URL).then((response) => {
          if (!response.ok) throw new Error(`${ESPEAK_DATA_URL}: HTTP ${response.status}`);
          return response.arrayBuffer();
        }),
      ]);
      const espeak = await create({ getPreloadedPackage: () => data });
      return new espeak.eSpeakNGWorker();
    } catch (err) {
      console.warn("Speech engine unavailable; announcements stay wordless.", err);
      return null;
    }
  })();
  return engine.then((worker) => worker !== null);
}

/**
 * Render `text` as the announcer's speech (`voice` indexes
 * `ANNOUNCER_VOICES`), or null if the engine isn't loaded or rendering
 * fails. Call `loadSpeech` first; this never loads it itself.
 */
export async function speak(
  ctx: BaseAudioContext,
  text: string,
  voice = 0,
): Promise<AudioBuffer | null> {
  const worker = engine ? await engine : null;
  if (!worker) return null;
  const { variant, pitch } = ANNOUNCER_VOICES[voice % ANNOUNCER_VOICES.length]!;
  try {
    // The engine keeps its settings between lines, so every line sets them
    // all: voice first, then the rate and pitch to speak it at.
    if (worker.set_voice(`${ANNOUNCER_VOICE}+${variant}`) !== 0) return null;
    worker.set_rate(ANNOUNCER_SPEED);
    // worker.set_pitch(pitch);
    // Rendering is synchronous; the samples arrive in chunks.
    const chunks: Int16Array[] = [];
    let length = 0;
    worker.synthesize(text, (samples) => {
      chunks.push(samples);
      length += samples.length;
      return false;
    });
    if (length === 0) return null;
    const buffer = ctx.createBuffer(1, length, worker.get_samplerate());
    const out = buffer.getChannelData(0);
    let at = 0;
    for (const chunk of chunks) {
      for (const sample of chunk) out[at++] = sample / 32768;
    }
    return buffer;
  } catch {
    return null;
  }
}
