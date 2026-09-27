/**
 * The terminal crowd: people chatting around the tower, the "chatter"
 * layer of the airport ambience (audio/ambience.ts).
 *
 * Real crowd noise ("walla" in film sound) is many people really talking,
 * too far off and too overlapped to follow. So the crowd is made of real
 * speech: short, everyday lines (`CROWD_LINES`), in English and the
 * languages you'd overhear at a European airport, each spoken once by the
 * speech engine (audio/speech.ts) in a random voice, accent and timbre.
 * Those clips are then replayed as little conversations: a few spots in
 * the hall (a distance and a place left or right), each trading lines
 * back and forth in one language, then falling quiet and moving on.
 *
 * What hides the synthesiser's robotic edge, and sells "crowd":
 * - distance: each spot is muffled (low-passed) and quietened the further
 *   away it is, and all of it sits in the hall's echo (set up by the
 *   ambience);
 * - overlap: several conversations run at once over a murmur bed (a band
 *   of noise swelling at syllable rate, the sound of many people too far
 *   away to pick out), so no single voice is exposed for long;
 * - variety: every replay runs a touch faster or slower (which shifts the
 *   pitch too), so the same clip never sounds quite the same twice.
 *
 * Until the voices have loaded, or if they can't, only the murmur plays.
 */
import { loadCrowdVoices, speakAs, type CrowdVoice, type SpeechStyle } from "./speech";

/** The languages the crowd speaks, each with the voices that speak it. */
const LANGUAGE_VOICES = {
  en: ["en/en-rp", "en/en-us", "en/en-sc"],
  fr: ["fr"],
  de: ["de"],
  es: ["es"],
  it: ["it"],
} as const satisfies Record<string, readonly CrowdVoice[]>;
type Language = keyof typeof LANGUAGE_VOICES;

/**
 * What the crowd says. Nobody hears a whole line clearly (that's the
 * point), but the rhythm and melody of real sentences, questions and
 * answers, is what makes it sound like people rather than noise.
 *
 * TODO(you): give the terminal its conversations. These defaults are
 * travellers' small talk. Things to weigh:
 *   - short lines (a few words to one sentence) trade back and forth like
 *     a conversation; long ones turn into speeches;
 *   - questions ("…?") rise at the end, which reads as chat; a mix of
 *     questions and answers sounds most natural;
 *   - each line is one clip in memory, rendered once when the crowd
 *     starts; a few dozen in total is plenty.
 */
export const CROWD_LINES: Record<Language, readonly string[]> = {
  en: [
    "Which gate did it say? Twelve?",
    "I'm just going to grab a coffee. Do you want anything?",
    "Have you got the passports?",
    "It says it's delayed again.",
    "Honestly, the queue at security was ridiculous.",
    "We land at about half past four, local time.",
    "Can you ring me when you get there?",
    "Did you pack the chargers?",
    "No, no, I think it's this way.",
    "Let's sit over there, by the window.",
    "Yeah, I'll call you back in a minute.",
    "Is that our plane out there?",
    "Right. Boarding pass, passport, phone.",
    "How long have we got?",
    "Oh look, they've changed the gate.",
    "Mum, can I get some sweets?",
  ],
  fr: [
    "Tu as les passeports?",
    "On a encore vingt minutes.",
    "Je vais chercher un café.",
    "C'est quelle porte, déjà?",
    "Je t'appelle quand on arrive.",
  ],
  de: [
    "Wo ist denn unser Gate?",
    "Wir haben noch zwanzig Minuten.",
    "Hast du die Pässe?",
    "Ich hole schnell einen Kaffee.",
    "Der Flug hat schon wieder Verspätung.",
  ],
  es: [
    "¿Dónde está la puerta de embarque?",
    "Todavía tenemos veinte minutos.",
    "¿Tienes los pasaportes?",
    "Voy a por un café. ¿Quieres algo?",
    "Te llamo cuando lleguemos.",
  ],
  it: [
    "Dov'è il nostro gate?",
    "Abbiamo ancora venti minuti.",
    "Hai preso i passaporti?",
    "Vado a prendere un caffè.",
    "Ti chiamo appena arriviamo.",
  ],
};

/**
 * How busy the crowd is. More conversations thicken it towards a roar,
 * but each clip playing is a few audio nodes, and above ~8 the words
 * start to mask the game's own cues.
 */
export const CROWD = {
  /** Conversations going on at once. */
  conversations: 5,
  /** Chance a new conversation is in English (else one of the others). */
  english: 0.65,
  /** Lines traded in one conversation. */
  turns: [2, 6] as const,
  /** Seconds between turns (a reply), and between conversations. */
  replyGap: [0.15, 0.9] as const,
  quietGap: [1.5, 6] as const,
  /** Replay speed (and pitch) range: ±~6 %. */
  rate: [0.94, 1.07] as const,
};

/** Levels: starting points under the PA (ambience.ts `SPEECH_LEVEL`); tune by ear. */
const VOICE_LEVEL = 0.075;
const MURMUR_LEVEL = 0.05;
/** Low-pass cutoff (Hz) of the nearest and the furthest spot. */
const NEAR_CUTOFF = 3200;
const FAR_CUTOFF = 900;
/** Timbres the voices are spoken in (meSpeak variants, m = male, f = female). */
const VARIANTS = ["m1", "m2", "m3", "m4", "m6", "f1", "f2", "f3", "f4", "f5"];
/** Milliseconds between clip renders (each takes ~10-60 ms of main thread). */
const RENDER_SPACING = 120;

/** A rendered line, ready to replay. */
interface Clip {
  buffer: AudioBuffer;
  language: Language;
}

/** A conversation at one spot in the hall. */
interface Conversation {
  /** Audio-clock time of its next line. */
  next: number;
  /** Lines left to trade (then a quiet gap and a new spot). */
  left: number;
  language: Language;
  /** 0 = near, 1 = far across the hall. */
  distance: number;
  /** Stereo position, -1 left to 1 right. */
  pan: number;
}

export class Crowd {
  private readonly clips: Clip[] = [];
  /** Clips played recently, not to be picked again straight away. */
  private readonly recent: Clip[] = [];
  private readonly conversations: Conversation[] = [];
  private readonly murmur: AudioBufferSourceNode[] = [];
  private disposed = false;

  /**
   * @param ctx    the mixer's audio context
   * @param out    where the crowd plays (the ambience's chatter chain)
   * @param noise  a looping white-noise buffer (see audio/sfx.ts)
   * @param rng    the ambience's random source
   */
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    noise: AudioBuffer,
    private readonly rng: () => number,
  ) {
    this.startMurmur(noise);
    for (let i = 0; i < CROWD.conversations; i++) this.conversations.push(this.newSpot(0));
    // Fetch the voices in the background, then render the lines one by one.
    void loadCrowdVoices().then((ok) => {
      if (ok) this.renderLines();
    });
  }

  /** Start afresh just ahead of `now` (first call, or back after a gap). */
  restart(now: number): void {
    for (let i = 0; i < this.conversations.length; i++) {
      this.conversations[i] = this.newSpot(now + this.rng() * 3);
    }
  }

  /** Book every line due before `horizon` (see `Ambience.update`). */
  update(horizon: number): void {
    for (const talk of this.conversations) {
      while (talk.next < horizon) this.turn(talk);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const src of this.murmur) src.stop();
  }

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------

  /** A fresh conversation starting at `at`: a language, a spot in the hall. */
  private newSpot(at: number): Conversation {
    const others = Object.keys(LANGUAGE_VOICES).filter((l) => l !== "en") as Language[];
    const language =
      this.rng() < CROWD.english ? "en" : others[Math.floor(this.rng() * others.length)]!;
    return {
      next: at,
      left: Math.round(this.between(CROWD.turns)),
      language,
      // Squared: most people are some way off, a few close by.
      distance: 1 - this.rng() ** 2,
      pan: this.rng() * 1.8 - 0.9,
    };
  }

  /** The conversation's next line, or its quiet gap before moving on. */
  private turn(talk: Conversation): void {
    if (talk.left <= 0) {
      Object.assign(talk, this.newSpot(talk.next + this.between(CROWD.quietGap)));
      return;
    }
    talk.left--;
    const clip = this.pick(talk.language);
    if (!clip) {
      // Nothing rendered yet (or not in this language): check back soon.
      talk.next += 1;
      return;
    }
    const rate = this.between(CROWD.rate);
    this.play(clip, talk, rate);
    talk.next += clip.buffer.duration / rate + this.between(CROWD.replyGap);
  }

  /** A clip in `language`, avoiding the last few played; null if none. */
  private pick(language: Language): Clip | null {
    const all = this.clips.filter((c) => c.language === language);
    const fresh = all.filter((c) => !this.recent.includes(c));
    const pool = fresh.length > 0 ? fresh : all;
    if (pool.length === 0) return null;
    const clip = pool[Math.floor(this.rng() * pool.length)]!;
    this.recent.push(clip);
    if (this.recent.length > 8) this.recent.shift();
    return clip;
  }

  /** Play `clip` from the conversation's spot at `talk.next`. */
  private play(clip: Clip, talk: Conversation, rate: number): void {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = rate;
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = NEAR_CUTOFF + (FAR_CUTOFF - NEAR_CUTOFF) * talk.distance;
    const gain = ctx.createGain();
    // Speech engines speak evenly; a little swing per line sounds more human.
    gain.gain.value = VOICE_LEVEL * (1 - 0.75 * talk.distance) * (0.7 + 0.3 * this.rng());
    const pan = ctx.createStereoPanner();
    pan.pan.value = talk.pan;
    src.connect(muffle).connect(gain).connect(pan).connect(this.out);
    src.start(Math.max(talk.next, ctx.currentTime));
  }

  // -------------------------------------------------------------------------
  // Clips and murmur
  // -------------------------------------------------------------------------

  /**
   * Render every line once, in a random voice, spaced out (`RENDER_SPACING`)
   * so the main thread never stalls for long. Lines are shuffled, so every
   * language gets its first clips early.
   */
  private renderLines(): void {
    const queue = (Object.entries(CROWD_LINES) as [Language, readonly string[]][])
      .flatMap(([language, lines]) => lines.map((text) => ({ language, text })))
      .map((line) => ({ line, key: this.rng() }))
      .sort((a, b) => a.key - b.key)
      .map(({ line }) => line);
    const next = () => {
      const line = queue.shift();
      if (!line || this.disposed) return;
      void speakAs(this.ctx, line.text, this.style(line.language)).then((buffer) => {
        if (buffer) this.clips.push({ buffer, language: line.language });
        setTimeout(next, RENDER_SPACING);
      });
    };
    next();
  }

  /** A random speaker of `language`: accent, timbre, pitch and pace. */
  private style(language: Language): SpeechStyle {
    const voices = LANGUAGE_VOICES[language];
    return {
      voice: voices[Math.floor(this.rng() * voices.length)]!,
      variant: VARIANTS[Math.floor(this.rng() * VARIANTS.length)]!,
      pitch: Math.round(this.between([30, 70])),
      // Conversation pace: quicker than the PA announcer.
      speed: Math.round(this.between([165, 205])),
    };
  }

  /**
   * The murmur bed: two bands of noise where voices sit (the chest of the
   * voice and the vowels), each swelling at syllable rate on its own
   * random envelope, so it breathes like a far-off crowd, not a hiss.
   */
  private startMurmur(noise: AudioBuffer): void {
    const { ctx } = this;
    for (const [freq, q, level, seed] of [
      [420, 1.1, 1, 0.1],
      [1100, 1.6, 0.45, 0.6],
    ] as const) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = freq;
      band.Q.value = q;
      const swell = ctx.createGain();
      swell.gain.value = 0; // driven entirely by the envelope below
      const env = ctx.createBufferSource();
      env.buffer = syllableEnvelope(ctx, 9 + seed * 4, this.rng);
      env.loop = true;
      env.connect(swell.gain);
      const gain = ctx.createGain();
      gain.gain.value = MURMUR_LEVEL * level;
      src.connect(band).connect(swell).connect(gain).connect(this.out);
      src.start(0, seed);
      env.start(0);
      this.murmur.push(src, env);
    }
  }

  /** A random pick in `[min, max)`. */
  private between([min, max]: readonly [number, number]): number {
    return min + (max - min) * this.rng();
  }
}

/**
 * A `seconds`-long loop of gain values (0.25-1) swelling and dipping at
 * syllable rate: the sum of a few voices' worth of smooth random
 * envelopes, so it never falls silent or pulses in step. Loops cleanly
 * (each voice's bumps are laid out on a circle of `seconds`).
 */
function syllableEnvelope(ctx: BaseAudioContext, seconds: number, rng: () => number): AudioBuffer {
  // Envelopes only need a low rate, but buffers must be ≥ 3 kHz everywhere.
  const rate = 3000;
  const length = Math.floor(seconds * rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  const VOICES = 6;
  for (let v = 0; v < VOICES; v++) {
    // A voice: syllables 0.12-0.3 s long, in phrases with short pauses.
    // One lap of the loop, from a random point on it.
    let t = rng() * seconds;
    const end = t + seconds;
    while (t < end) {
      const phrase = 3 + Math.floor(rng() * 6);
      for (let s = 0; s < phrase && t < end; s++) {
        const dur = 0.12 + rng() * 0.18;
        const peak = 0.4 + rng() * 0.6;
        const from = Math.floor(t * rate);
        const span = Math.floor(dur * rate);
        for (let i = 0; i < span; i++) {
          // A raised-cosine bump per syllable, wrapped round the loop.
          data[(from + i) % length]! += peak * 0.5 * (1 - Math.cos((2 * Math.PI * i) / span));
        }
        t += dur;
      }
      t += 0.3 + rng() * 1.2;
    }
  }
  // Normalise into 0.25-1: always some murmur, never clipping.
  let max = 0;
  for (const x of data) max = Math.max(max, x);
  for (let i = 0; i < length; i++) data[i] = 0.25 + (0.75 * data[i]!) / (max || 1);
  return buffer;
}
