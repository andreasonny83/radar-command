/**
 * Airport ambience: the terminal and field around the tower, synthesised
 * with the Web Audio API (no audio files, no real words).
 *
 * Four layers, each with its own level (`AMBIENCE_LEVELS`; switch them one
 * by one in the "Audio/Effects" story):
 *
 * - room:    the terminal's low, steady hum (low-passed noise);
 * - chatter: a few distant people talking. Each "talker" is a buzzy tone
 *            (the voice) through two band-pass filters set to the formants
 *            of a vowel; hopping between vowels at syllable rate, with
 *            pitch contours and pauses between phrases, reads as speech,
 *            though no words are ever said;
 * - pa:      public-address announcements: a soft three-note rising chime
 *            (unlike the departure cue's two falling notes, see
 *            audio/sfx.ts), then an announcer speaking through a tinny
 *            ceiling speaker (a narrow band) in a big, echoing hall. The
 *            words (audio/announcements.ts) are spoken by a speech engine
 *            (audio/speech.ts): boarding calls and reminders, and lines
 *            about the game itself, like a departure the game just rolled
 *            out (`onGameEvent`). Until the engine has loaded, or if it
 *            can't, the announcer talks in the chatter's wordless voice;
 * - outside: now and then a jet passing far overhead, and faint radio
 *            squelch.
 *
 * Timing uses a look-ahead scheduler like the music (audio/music.ts):
 * `update()` books everything due in the next `LOOKAHEAD` seconds on the
 * audio clock, and picks up afresh after a gap.
 */
import { mulberry32 } from "../core/math";
import type { SimEvent } from "../core/types";
import { departureLine, runwayOpenLine, terminalLine } from "./announcements";
import { noiseBuffer } from "./sfx";
import { ANNOUNCER_VOICES, loadSpeech, speak } from "./speech";

// ---------------------------------------------------------------------------
// How busy the terminal is
// ---------------------------------------------------------------------------

/**
 * How often announcements come, and how many people chat in the terminal.
 *
 * TODO(you): set how busy the airport feels. The default is a calm
 * regional field: an announcement every 1-2 minutes (the first one soon
 * after the sound starts), four quiet talkers. Things to weigh:
 *   - more frequent announcements feel busier and more "real", but every
 *     one competes with the game's own cues (the departure chime, alerts);
 *     `PA_CLEAR_OF_CHIME` keeps them apart, however often they come;
 *   - more talkers thicken the chatter into a crowd murmur, but each one
 *     costs a few audio nodes, running all the time (keep it under ~8).
 */
export const PA_SCHEDULE = {
  /** Seconds between announcements (a random pick in the range each time). */
  interval: [30, 120] as const,
  /** Seconds from the start of the sound to the first announcement. */
  first: 20,
  /** Distant talkers chatting in the terminal. */
  talkers: 0,
};

/** Layer levels (linear gain) at full ambience volume. */
export const AMBIENCE_LEVELS = { room: 1, chatter: 1, pa: 1, outside: 1 };
export type AmbienceLayer = keyof typeof AMBIENCE_LEVELS;

/** An announcement never starts within this many seconds of a departure chime. */
const PA_CLEAR_OF_CHIME = 7;

/**
 * Announcements start at least this many seconds apart, even when game
 * lines (a departure, a runway opening) bring the next one forward.
 */
const PA_MIN_GAP = 20;

/** Game lines waiting for the PA; older ones give way if more pile up. */
const MAX_QUEUED_LINES = 2;

/** Seconds from the start of the PA chime to the first word. */
const CHIME_TO_VOICE = 1.4;

/** Seconds of sound booked ahead of the audio clock. */
const LOOKAHEAD = 1.5;

/** Seconds between distant jet flyovers, and between radio squelches. */
const JET_INTERVAL = [40, 90] as const;
const SQUELCH_INTERVAL = [25, 60] as const;

/**
 * Vowel formants (Hz): the two resonances of the mouth that tell vowels
 * apart. Hopping between them at syllable rate is the "speech".
 */
const VOWELS: readonly (readonly [number, number])[] = [
  [800, 1200], // a
  [400, 2000], // e
  [300, 2300], // i
  [450, 800], // o
  [325, 700], // u
  [600, 1700], // æ
];

/** Levels inside the layers, balanced by measurement (offline render, RMS). */
const ROOM_LEVEL = 0.09;
const TALKER_LEVEL = 0.05;
const ANNOUNCER_LEVEL = 0.16;
/**
 * The spoken announcer (rendered speech peaks near full scale): measured
 * through the PA chain at ~-36 dBFS RMS, clear but under the game's own
 * cues (~-34) and well under the engines (-20).
 */
const SPEECH_LEVEL = 0.22;
const PA_CHIME_LEVEL = 0.07;
const JET_LEVEL = 0.07;
const SQUELCH_LEVEL = 0.018;

/** One synthetic voice: a buzz through two formant filters, shaped per syllable. */
interface Voice {
  osc: OscillatorNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  env: GainNode;
  /** Speaking pitch (Hz), the centre of its intonation. */
  pitch: number;
}

/** A chatting talker: its voice and where it is in its current phrase. */
interface Talker {
  voice: Voice;
  /** Audio-clock time of its next syllable. */
  next: number;
  /** Syllables left in the phrase (then a pause). */
  left: number;
  level: number;
}

export class Ambience {
  private readonly layers: Record<AmbienceLayer, GainNode>;
  private readonly noise: AudioBuffer;
  private readonly rng: () => number;
  private readonly roomTone: AudioBufferSourceNode;
  private readonly talkers: Talker[] = [];
  private readonly announcer: Voice;
  /** Into the PA: the tinny speaker and hall that the chime and voice go through. */
  private readonly speaker: AudioNode;
  /** True once the speech engine has loaded (see audio/speech.ts). */
  private speechReady = false;
  /** Game lines waiting for the next announcement (see `onGameEvent`). */
  private readonly gameLines: string[] = [];
  /** Audio-clock time the latest announcement started. */
  private lastPa = -Infinity;
  /** Everything that runs continuously, stopped by `dispose`. */
  private readonly sources: AudioScheduledSourceNode[] = [];

  /** Audio-clock time the scheduler has booked up to (-1 before the first update). */
  private booked = -1;
  private nextPa = 0;
  private nextJet = 0;
  private nextSquelch = 0;
  /** Latest departure chime (audio-clock time), to keep announcements clear of it. */
  private lastChime = -Infinity;

  /**
   * @param ctx   the mixer's audio context
   * @param out   where the ambience plays (the mixer's ambience bus)
   * @param seed  seeds the chatter, announcements and timing
   */
  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    seed = 1,
  ) {
    this.rng = mulberry32(seed);
    this.noise = noiseBuffer(ctx);
    this.layers = {
      room: ctx.createGain(),
      chatter: ctx.createGain(),
      pa: ctx.createGain(),
      outside: ctx.createGain(),
    };
    for (const [name, gain] of Object.entries(this.layers) as [AmbienceLayer, GainNode][]) {
      gain.gain.value = AMBIENCE_LEVELS[name];
      gain.connect(out);
    }

    this.roomTone = this.startRoomTone();

    // Chatter: distant, so muffled (low-passed) and in a short room echo.
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 1600;
    const room = ctx.createConvolver();
    room.buffer = hallImpulse(ctx, 1.4, 0xc4a7);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    muffle.connect(this.layers.chatter);
    muffle.connect(room).connect(wet).connect(this.layers.chatter);
    for (let i = 0; i < PA_SCHEDULE.talkers; i++) {
      // Alternate lower and higher voices.
      const pitch = i % 2 === 0 ? this.between([100, 135]) : this.between([180, 235]);
      this.talkers.push({
        voice: this.createVoice(pitch, muffle),
        next: 0,
        left: 0,
        level: TALKER_LEVEL * (0.6 + 0.4 * this.rng()),
      });
    }

    // PA: a tinny ceiling speaker (a narrow band) in a big hall.
    const speakerLow = ctx.createBiquadFilter();
    speakerLow.type = "highpass";
    speakerLow.frequency.value = 350;
    const speakerHigh = ctx.createBiquadFilter();
    speakerHigh.type = "lowpass";
    speakerHigh.frequency.value = 3200;
    const hall = ctx.createConvolver();
    hall.buffer = hallImpulse(ctx, 3.2, 0x9a11);
    const hallWet = ctx.createGain();
    hallWet.gain.value = 0.8;
    speakerLow.connect(speakerHigh);
    speakerHigh.connect(this.layers.pa);
    speakerHigh.connect(hall).connect(hallWet).connect(this.layers.pa);
    this.announcer = this.createVoice(150, speakerLow);
    this.speaker = speakerLow;

    // The speech engine is ~1 MB: fetch it now, in the background (the
    // ambience only exists once the player has clicked, see audio/mixer.ts).
    void loadSpeech().then((ok) => (this.speechReady = ok));
  }

  /** Fade a layer in or out (e.g. the story's toggles). */
  setLayer(layer: AmbienceLayer, on: boolean): void {
    const level = on ? AMBIENCE_LEVELS[layer] : 0;
    this.layers[layer].gain.setTargetAtTime(level, this.ctx.currentTime, 0.3);
  }

  /**
   * A departure chime just played (audio/sfx.ts): push the next
   * announcement clear of it, so the game's cue is never talked over.
   */
  noteChime(): void {
    this.lastChime = this.ctx.currentTime;
    const earliest = this.lastChime + PA_CLEAR_OF_CHIME;
    if (this.nextPa > this.booked && this.nextPa < earliest) this.nextPa = earliest;
  }

  /**
   * Something happened on the field worth announcing: queue its line for
   * the PA and bring the next announcement forward (clear of the departure
   * chime, and `PA_MIN_GAP` after the last one).
   */
  onGameEvent(event: SimEvent): void {
    let line: string;
    if (event.type === "departureAnnounced") line = departureLine(event.color, this.rng);
    else if (event.type === "unlocked") line = runwayOpenLine(event.color, this.rng);
    else return;
    this.gameLines.push(line);
    if (this.gameLines.length > MAX_QUEUED_LINES) this.gameLines.shift();
    const soon = Math.max(
      this.booked,
      this.ctx.currentTime + 1,
      this.lastChime + PA_CLEAR_OF_CHIME,
      this.lastPa + PA_MIN_GAP,
    );
    this.nextPa = Math.min(this.nextPa, soon);
  }

  /**
   * Make an announcement now (the "Audio/Effects" story): `text` if given,
   * else the next queued game line or a terminal line.
   */
  announce(text?: string): void {
    this.announcement(this.ctx.currentTime + 0.05, text);
  }

  /** Book everything due in the next `LOOKAHEAD` seconds. Call once per frame. */
  update(): void {
    const now = this.ctx.currentTime;
    if (this.booked < now - 0.5) {
      // First call, or back after a gap: start afresh just ahead of now.
      this.booked = now;
      for (const talker of this.talkers) {
        talker.next = now + this.rng() * 2;
        talker.left = 0;
      }
      if (this.nextPa < now) this.nextPa = now + PA_SCHEDULE.first;
      this.nextJet = now + this.between(JET_INTERVAL) / 3;
      this.nextSquelch = now + this.between(SQUELCH_INTERVAL) / 2;
    }
    const horizon = now + LOOKAHEAD;
    for (const talker of this.talkers) {
      while (talker.next < horizon) this.talk(talker);
    }
    while (this.nextPa < horizon) {
      // Never over the departure chime (see `noteChime`).
      if (this.nextPa - this.lastChime < PA_CLEAR_OF_CHIME) {
        this.nextPa = this.lastChime + PA_CLEAR_OF_CHIME;
        continue;
      }
      this.announcement(this.nextPa);
      this.nextPa += this.between(PA_SCHEDULE.interval);
    }
    while (this.nextJet < horizon) {
      this.jetFlyover(this.nextJet);
      this.nextJet += this.between(JET_INTERVAL);
    }
    while (this.nextSquelch < horizon) {
      this.squelch(this.nextSquelch);
      this.nextSquelch += this.between(SQUELCH_INTERVAL);
    }
    this.booked = horizon;
  }

  /** Stop everything that runs continuously (scheduled sounds end by themselves). */
  dispose(): void {
    for (const src of this.sources) src.stop();
    this.roomTone.stop();
  }

  // -------------------------------------------------------------------------
  // Voices
  // -------------------------------------------------------------------------

  /** A voice at `pitch` Hz into `out`, silent until syllables are booked. */
  private createVoice(pitch: number, out: AudioNode): Voice {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = pitch;
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(out);
    const [f1, f2] = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    for (const [filter, q] of [
      [f1, 7],
      [f2, 9],
    ] as const) {
      filter.type = "bandpass";
      filter.Q.value = q;
      osc.connect(filter).connect(env);
    }
    osc.start();
    this.sources.push(osc);
    return { osc, f1, f2, env, pitch };
  }

  /**
   * One syllable of `voice` at `t`, `dur` long: glide to a vowel's
   * formants, the pitch a little up or down (`inflect`), and swell the
   * level in and out.
   */
  private syllable(voice: Voice, t: number, dur: number, level: number, inflect: number): void {
    const [a, b] = VOWELS[Math.floor(this.rng() * VOWELS.length)]!;
    voice.f1.frequency.setTargetAtTime(a, t, 0.025);
    voice.f2.frequency.setTargetAtTime(b, t, 0.025);
    voice.osc.frequency.setTargetAtTime(voice.pitch * inflect, t, 0.04);
    voice.env.gain.setTargetAtTime(level, t, 0.02);
    voice.env.gain.setTargetAtTime(0, t + dur * 0.7, 0.035);
  }

  /** The talker's next syllable, or the pause after a phrase. */
  private talk(talker: Talker): void {
    if (talker.left <= 0) {
      talker.left = 3 + Math.floor(this.rng() * 7);
      talker.next += this.between([0.6, 2.6]); // pause between phrases
      return;
    }
    const dur = this.between([0.13, 0.26]);
    // Pitch drifts around the voice's centre, falling at the phrase's end.
    const inflect = talker.left === 1 ? 0.88 : 0.92 + 0.2 * this.rng();
    this.syllable(talker.voice, talker.next, dur, talker.level, inflect);
    talker.next += dur;
    talker.left--;
  }

  /**
   * A public-address announcement at `t`: the rising three-note chime, then
   * the announcer speaking `text` (or the next queued game line, or a
   * terminal line). The speech renders in the background (~0.1 s) while
   * the chime plays; without the speech engine the announcer babbles
   * instead (see `babble`).
   */
  private announcement(t: number, text?: string): void {
    this.lastPa = t;
    // C5, E5, G5: a gentle rising arpeggio (the departure cue falls).
    [523.25, 659.25, 783.99].forEach((freq, i) => this.bell(freq, t + i * 0.3, 1.4));
    const words = t + CHIME_TO_VOICE;
    if (!this.speechReady) {
      this.babble(words);
      return;
    }
    const line = text ?? this.gameLines.shift() ?? terminalLine(this.rng);
    const voice = Math.floor(this.rng() * ANNOUNCER_VOICES.length);
    void speak(this.ctx, line, voice).then((buffer) => {
      const start = Math.max(words, this.ctx.currentTime + 0.02);
      if (!buffer) {
        this.babble(start);
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = SPEECH_LEVEL;
      src.connect(gain).connect(this.speaker);
      src.start(start);
    });
  }

  /**
   * The announcer without words, from `at`: two or three phrases of the
   * chatter's synthetic voice, measured and clear, each ending on a
   * falling note.
   */
  private babble(at: number): void {
    const phrases = 2 + Math.floor(this.rng() * 2);
    for (let p = 0; p < phrases; p++) {
      const syllables = 6 + Math.floor(this.rng() * 5);
      for (let s = 0; s < syllables; s++) {
        const dur = this.between([0.16, 0.24]);
        const last = s === syllables - 1;
        const inflect = last ? 0.85 : 0.95 + 0.15 * this.rng();
        this.syllable(this.announcer, at, dur, ANNOUNCER_LEVEL, inflect);
        at += dur;
      }
      at += this.between([0.35, 0.6]);
    }
  }

  /** A soft PA chime note: a struck sine with a faint octave, through the speaker. */
  private bell(freq: number, t: number, ring: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(PA_CHIME_LEVEL, t + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    env.connect(this.speaker);
    for (const [mult, level] of [
      [1, 1],
      [2, 0.2],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + ring + 0.05);
    }
  }

  // -------------------------------------------------------------------------
  // Room and outside
  // -------------------------------------------------------------------------

  /** The terminal's low, steady hum: noise, well low-passed. */
  private startRoomTone(): AudioBufferSourceNode {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 280;
    const gain = ctx.createGain();
    gain.gain.value = ROOM_LEVEL;
    src.connect(low).connect(gain).connect(this.layers.room);
    src.start();
    return src;
  }

  /**
   * A jet passing far overhead: a band of noise swelling up and fading
   * over ~14 s, its pitch rising then falling (a gentle Doppler), panned
   * across the stereo field.
   */
  private jetFlyover(t: number): void {
    const { ctx } = this;
    const dur = 14;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(280, t);
    band.frequency.linearRampToValueAtTime(800, t + dur * 0.45);
    band.frequency.linearRampToValueAtTime(350, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(JET_LEVEL, t + dur * 0.45);
    env.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner();
    const side = this.rng() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.8 * side, t);
    pan.pan.linearRampToValueAtTime(0.8 * side, t + dur);
    src.connect(band).connect(env).connect(pan).connect(this.layers.outside);
    src.start(t, this.rng() * 1.5);
    src.stop(t + dur + 0.1);
  }

  /** Faint tower-radio squelch: one or two short bursts of band-limited hiss. */
  private squelch(t: number): void {
    const { ctx } = this;
    const bursts = this.rng() < 0.5 ? 1 : 2;
    for (let i = 0; i < bursts; i++) {
      const at = t + i * 0.35;
      const len = 0.1 + this.rng() * 0.08;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1700;
      band.Q.value = 2.5;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(SQUELCH_LEVEL, at + 0.01);
      env.gain.setValueAtTime(SQUELCH_LEVEL, at + len);
      env.gain.linearRampToValueAtTime(0, at + len + 0.03);
      src.connect(band).connect(env).connect(this.layers.outside);
      src.start(at, this.rng());
      src.stop(at + len + 0.05);
    }
  }

  /** A random pick in `[min, max)`. */
  private between([min, max]: readonly [number, number]): number {
    return min + (max - min) * this.rng();
  }
}

/**
 * Impulse response for a room of `seconds` reverb: stereo noise decaying
 * quicker at first (a power curve), so the tail is smooth, not metallic.
 */
export function hallImpulse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const rng = mulberry32(seed);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (rng() * 2 - 1) * (1 - i / length) ** 2.5;
  }
  return buffer;
}
