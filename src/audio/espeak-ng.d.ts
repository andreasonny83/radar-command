/**
 * eSpeak NG (@echogarden/espeak-ng-emscripten) ships no type
 * declarations. These describe the parts audio/speech.ts uses.
 */
declare module "@echogarden/espeak-ng-emscripten" {
  /** One synthesiser: a voice, a speaking rate and a pitch. */
  export class eSpeakNGWorker {
    /**
     * Pick a voice by name: a language or accent ("en-gb-x-rp", "fr"),
     * optionally with a variant ("en-gb-x-rp+f2"). Returns 0 on success;
     * on failure the previous voice stays.
     */
    set_voice(name: string): number;
    /** Words per minute (80-450, default 175). */
    set_rate(wpm: number): void;
    /** 0-100, default 50. */
    set_pitch(pitch: number): void;
    get_samplerate(): number;
    /**
     * Speak `text`, synchronously: `onAudio` receives the samples (16-bit
     * mono, at `get_samplerate()`) in chunks as they're rendered. Return
     * true from it to stop early.
     */
    synthesize(text: string, onAudio: (samples: Int16Array, events: unknown[]) => boolean): void;
  }

  export interface ESpeakNgModule {
    eSpeakNGWorker: typeof eSpeakNGWorker;
  }

  /**
   * Start the engine. `getPreloadedPackage` hands it its voice data
   * (espeak-ng.data, see vite-plugins/espeakNgData.ts) instead of it
   * fetching the file itself.
   */
  export default function createESpeakNg(options?: {
    getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
  }): Promise<ESpeakNgModule>;
}

/** URL of eSpeak NG's trimmed voice data (vite-plugins/espeakNgData.ts). */
declare module "virtual:espeak-ng-data" {
  const url: string;
  export default url;
}
