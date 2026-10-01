/**
 * Airport ambience: the terminal and field around the tower.
 *
 * Three layers, each with its own level (`AMBIENCE_LEVELS`; switch them one
 * by one in the "Audio/Effects" story):
 *
 * - terminal: a real recording of a busy terminal (Stuttgart, CC0: see
 *            audio/samples.ts and CREDITS.md), people, footsteps and hum,
 *            a little muffled as heard from the tower. It's 60 s long and
 *            loops by crossfading two copies (`BED_CROSSFADE`), so the
 *            restart is never heard. Silent until the file has loaded;
 * - pa:      public-address announcements: a soft three-note rising chime
 *            (unlike the departure cue's two falling notes, see
 *            audio/sfx.ts), then an announcer speaking through a tinny
 *            ceiling speaker (a narrow band) in a big, echoing hall. The
 *            words (audio/announcements.ts) are spoken by a speech engine
 *            (audio/speech.ts): boarding calls and reminders, and lines
 *            about the game itself, like a departure just cleared onto its
 *            runway (`onGameEvent`). Until the engine has loaded, or if it
 *            can't, there are no announcements at all. They only play
 *            during a shift (see `setPaused`): never on the title screen,
 *            paused or after a crash;
 * - outside: now and then a jet passing far overhead, and faint radio
 *            squelch (synthesised).
 *
 * Timing uses a look-ahead scheduler like the music (audio/music.ts):
 * `update()` books everything due in the next `LOOKAHEAD` seconds on the
 * audio clock, and picks up afresh after a gap.
 */
import { mulberry32 } from "../core/math";
import type { SimEvent } from "../core/types";
import { departureLine, runwayOpenLine, terminalLine } from "./announcements";
import type { Samples } from "./samples";
import { noiseBuffer } from "./sfx";
import { ANNOUNCER_VOICES, loadSpeech, speak } from "./speech";

// ---------------------------------------------------------------------------
// How busy the terminal is
// ---------------------------------------------------------------------------

/**
 * How often announcements come.
 *
 * TODO(you): set how busy the airport feels. The default is a calm
 * regional field: an announcement every 30 s to 2 minutes (the first one
 * soon after the sound starts). More frequent announcements feel busier
 * and more "real", but every one competes with the game's own cues (the
 * departure chime, alerts); `PA_CLEAR_OF_CHIME` keeps them apart, however
 * often they come.
 */
/** At full night the terminal is this much quieter (share of its level). */
const TERMINAL_NIGHT_DIP = 0.55;

export const PA_SCHEDULE = {
  /** Seconds between announcements (a random pick in the range each time). */
  interval: [30, 120] as const,
  /** Seconds from the start of the sound to the first announcement. */
  first: 20,
};

/** Layer levels (linear gain) at full ambience volume. */
export const AMBIENCE_LEVELS = { terminal: 1, pa: 1, outside: 1 };
export type AmbienceLayer = keyof typeof AMBIENCE_LEVELS;

/** An announcement never starts within this many seconds of a departure chime. */
const PA_CLEAR_OF_CHIME = 7;

/**
 * Game lines (a departure, a runway opening) bring the next announcement
 * forward, but never over the one being spoken: they start this many
 * seconds after its last word.
 */
const PA_GAP_AFTER_SPEECH = 1.5;

/**
 * Longest a line takes to say (the longest, measured with the engine, is
 * ~12.5 s): assumed for an announcement until its speech has rendered and
 * the real length is known.
 */
const PA_MAX_SPEECH = 14;

/** Game lines waiting for the PA; older ones give way if more pile up. */
const MAX_QUEUED_LINES = 2;

/**
 * A game line that has waited this many seconds for the PA is dropped
 * unspoken: by then the runway it describes has moved on (a departure
 * lifts off ~30 s after its runway closes), and a stale line is worse
 * than none.
 */
const MAX_LINE_AGE = 12;

/** Seconds from the start of the PA chime to the first word. */
const CHIME_TO_VOICE = 1.4;

/** Seconds of sound booked ahead of the audio clock. */
const LOOKAHEAD = 1.5;

/**
 * The terminal recording loops as overlapping copies: each fades in over
 * `BED_CROSSFADE` seconds while the one before fades out, so the join is
 * a blend of two moments, never a cut.
 */
const BED_CROSSFADE = 3;
/** Low-pass (Hz) on the terminal: the hall heard through the tower's glass. */
const BED_CUTOFF = 5000;

/** Seconds between distant jet flyovers, and between radio squelches. */
const JET_INTERVAL = [40, 90] as const;
const SQUELCH_INTERVAL = [25, 60] as const;

/**
 * Levels inside the layers, balanced by measurement (offline render, RMS).
 * The terminal sits about where the old synthesised hum and crowd did
 * (~-38 dBFS RMS), just under the announcer (~-36) so every word stays
 * clear, and under the game's own cues.
 */
const TERMINAL_LEVEL = 0.19;
/**
 * The spoken announcer (rendered speech peaks near full scale): measured
 * through the PA chain at ~-36 dBFS RMS, clear but under the game's own
 * cues (~-34) and well under the engines (-20).
 */
const SPEECH_LEVEL = 0.22;
const PA_CHIME_LEVEL = 0.07;
const JET_LEVEL = 0.07;
const SQUELCH_LEVEL = 0.018;

export class Ambience {
  private readonly layers: Record<AmbienceLayer, GainNode>;
  private readonly noise: AudioBuffer;
  private readonly rng: () => number;
  /** Into the terminal layer, through its low-pass. */
  private readonly bed: AudioNode;
  /** Terminal level for the time of day (between the glass and the layer). */
  private readonly nightDim: GainNode;
  /** 0 day … 1 night, and the terminal level last scheduled. */
  private night = 0;
  private dim = 1;
  /** Into the PA: the tinny speaker and hall that the chime and voice go through. */
  private readonly speaker: AudioNode;
  /** Between the PA layer and the output: closed while paused (see `setPaused`). */
  private readonly paGate: GainNode;
  /** Is the PA off (game paused, or no shift running)? No announcements are booked or heard. */
  private paused = false;
  /** Audio-clock time the pause began. */
  private pausedAt = 0;
  /** The game line being announced, so a pause mid-sentence can queue it again. */
  private spoken: { line: string; end: number } | null = null;
  /** True once the speech engine has loaded (see audio/speech.ts). */
  private speechReady = false;
  /** Game lines waiting for the next announcement, with when they were queued (see `onGameEvent`). */
  private gameLines: { line: string; at: number }[] = [];
  /** Audio-clock time the latest announcement's last word ends (an estimate until it has rendered). */
  private paBusyUntil = -Infinity;
  /** Everything that runs continuously, stopped by `dispose`. */
  private readonly sources: AudioScheduledSourceNode[] = [];

  /** Audio-clock time the scheduler has booked up to (-1 before the first update). */
  private booked = -1;
  private nextPa = 0;
  /** Audio-clock time the next copy of the terminal recording starts. */
  private nextBed = 0;
  private nextJet = 0;
  private nextSquelch = 0;
  /** Latest departure chime (audio-clock time), to keep announcements clear of it. */
  private lastChime = -Infinity;

  /**
   * @param ctx   the mixer's audio context
   * @param out   where the ambience plays (the mixer's ambience bus)
   * @param samples  the recorded sounds (audio/samples.ts): the terminal
   * @param seed  seeds the announcements and timing
   */
  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly samples: Samples,
    seed = 1,
  ) {
    this.rng = mulberry32(seed);
    this.noise = noiseBuffer(ctx);
    this.layers = {
      terminal: ctx.createGain(),
      pa: ctx.createGain(),
      outside: ctx.createGain(),
    };
    this.paGate = ctx.createGain();
    this.paGate.connect(out);
    for (const [name, gain] of Object.entries(this.layers) as [AmbienceLayer, GainNode][]) {
      gain.gain.value = AMBIENCE_LEVELS[name];
      gain.connect(name === "pa" ? this.paGate : out);
    }

    // Terminal: the recording (already full of the hall's own echo),
    // softened a little on its way through the tower's glass.
    const glass = ctx.createBiquadFilter();
    glass.type = "lowpass";
    glass.frequency.value = BED_CUTOFF;
    this.nightDim = ctx.createGain();
    glass.connect(this.nightDim).connect(this.layers.terminal);
    this.bed = glass;

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
    this.speaker = speakerLow;

    // The speech engine is ~2 MB: fetch it now, in the background (the
    // ambience only exists once the player has clicked, see audio/mixer.ts).
    void loadSpeech().then((ok) => (this.speechReady = ok));
  }

  /**
   * How dark it is, 0 day … 1 night: the terminal empties out (quieter) and
   * the PA speaks less often. Cheap every frame: the gain is only
   * rescheduled when it moves.
   */
  setNight(n: number): void {
    this.night = n;
    const dim = 1 - TERMINAL_NIGHT_DIP * n;
    if (Math.abs(dim - this.dim) < 0.01) return;
    this.dim = dim;
    this.nightDim.gain.setTargetAtTime(dim, this.ctx.currentTime, 2);
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
   * chime, and `PA_GAP_AFTER_SPEECH` after the last one is done talking).
   * A departure is announced when its runway closes, not when it rolls out
   * of the hangar: it can wait on its stand a while for the runway.
   */
  onGameEvent(event: SimEvent): void {
    let line: string;
    if (event.type === "runwayClosed") line = departureLine(event.color, this.rng);
    else if (event.type === "unlocked") line = runwayOpenLine(event.color, this.rng);
    else return;
    this.gameLines.push({ line, at: this.ctx.currentTime });
    if (this.gameLines.length > MAX_QUEUED_LINES) this.gameLines.shift();
    this.bringForward();
  }

  /** Forget the queued game lines (a new shift must not announce the last one's runways). */
  clearGameLines(): void {
    this.gameLines = [];
  }

  /** Bring the next announcement forward (clear of the chime, and of the one being spoken). */
  private bringForward(): void {
    const soon = Math.max(
      this.booked,
      this.ctx.currentTime + 1,
      this.lastChime + PA_CLEAR_OF_CHIME,
      this.paBusyUntil + PA_GAP_AFTER_SPEECH,
    );
    this.nextPa = Math.min(this.nextPa, soon);
  }

  /**
   * The PA goes off (the game is paused, or no shift is running: title
   * screen, game over) or back on: it falls silent, mid-sentence too, and
   * books nothing until a shift is playing again. A game line cut off is
   * queued to be announced again; the rest of the schedule is pushed back
   * by the time spent paused, so the wait picks up where it stopped.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const now = this.ctx.currentTime;
    this.paGate.gain.setTargetAtTime(paused ? 0 : 1, now, 0.04);
    if (paused) {
      this.pausedAt = now;
      if (this.spoken && this.spoken.end > now)
        this.gameLines.unshift({ line: this.spoken.line, at: now });
      this.spoken = null;
      return;
    }
    const offFor = now - this.pausedAt;
    this.nextPa += offFor;
    // Queued lines don't age while the PA is off.
    for (const queued of this.gameLines) queued.at += offFor;
    if (this.gameLines.length > 0) this.bringForward();
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
      // The copy of the terminal booked before the gap may still be
      // playing: carry on from where it hands over (else start now).
      this.nextBed = Math.max(this.nextBed, now);
      if (this.nextPa < now) this.nextPa = now + PA_SCHEDULE.first;
      this.nextJet = now + this.between(JET_INTERVAL) / 3;
      this.nextSquelch = now + this.between(SQUELCH_INTERVAL) / 2;
    }
    const horizon = now + LOOKAHEAD;
    this.bookBed(horizon);
    while (!this.paused && this.nextPa < horizon) {
      // Never over the departure chime (see `noteChime`).
      // Compared with the sum itself, not `nextPa - lastChime`: that
      // difference can round to just under the gap after the push, so the
      // check would fire again forever and hang the page.
      const earliest = this.lastChime + PA_CLEAR_OF_CHIME;
      if (this.nextPa < earliest) {
        this.nextPa = earliest;
        continue;
      }
      this.announcement(this.nextPa);
      // Quieter nights: gaps up to twice as long at full night.
      this.nextPa += this.between(PA_SCHEDULE.interval) * (1 + this.night);
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
  }

  // -------------------------------------------------------------------------
  // Public address
  // -------------------------------------------------------------------------

  /**
   * A public-address announcement at `t`: the rising three-note chime, then
   * the announcer speaking `text` (or the next queued game line, or a
   * terminal line). The speech renders in the background (~0.1 s) while
   * the chime plays. Without the speech engine there is no announcement
   * at all (no chime either, and queued game lines wait for the engine);
   * a line that fails to render is left unspoken after its chime.
   */
  private announcement(t: number, text?: string): void {
    if (!this.speechReady) return;
    // C5, E5, G5: a gentle rising arpeggio (the departure cue falls).
    [523.25, 659.25, 783.99].forEach((freq, i) => this.bell(freq, t + i * 0.3, 1.4));
    const words = t + CHIME_TO_VOICE;
    // Drop game lines that waited too long (see `MAX_LINE_AGE`).
    while (this.gameLines.length > 0 && t - this.gameLines[0]!.at > MAX_LINE_AGE)
      this.gameLines.shift();
    const queued = text === undefined ? this.gameLines.shift()?.line : undefined;
    const line = text ?? queued ?? terminalLine(this.rng);
    this.paBusyUntil = words + PA_MAX_SPEECH;
    const voice = Math.floor(this.rng() * ANNOUNCER_VOICES.length);
    void speak(this.ctx, line, voice).then((buffer) => {
      const start = Math.max(words, this.ctx.currentTime + 0.02);
      if (!buffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = SPEECH_LEVEL;
      src.connect(gain).connect(this.speaker);
      src.start(start);
      this.paBusyUntil = start + buffer.duration;
      if (queued !== undefined) this.spoken = { line: queued, end: start + buffer.duration };
    });
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

  /**
   * Book the copies of the terminal recording that start before `horizon`:
   * each fades in over `BED_CROSSFADE` as the previous one fades out, and
   * the next starts `BED_CROSSFADE` before this one ends. Nothing until
   * the recording has loaded (then it fades in from the next booking).
   */
  private bookBed(horizon: number): void {
    const buffer = this.samples.get("terminal");
    if (!buffer) {
      this.nextBed = horizon;
      return;
    }
    const { ctx } = this;
    const length = buffer.duration;
    while (this.nextBed < horizon) {
      const t = this.nextBed;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(TERMINAL_LEVEL, t + BED_CROSSFADE);
      env.gain.setValueAtTime(TERMINAL_LEVEL, t + length - BED_CROSSFADE);
      env.gain.linearRampToValueAtTime(0, t + length);
      src.connect(env).connect(this.bed);
      src.start(t);
      src.stop(t + length);
      // Stopped by `dispose` if still playing; forgotten once it ends.
      this.sources.push(src);
      src.addEventListener("ended", () => {
        const i = this.sources.indexOf(src);
        if (i >= 0) this.sources.splice(i, 1);
      });
      this.nextBed = t + length - BED_CROSSFADE;
    }
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
