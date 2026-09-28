/**
 * Background music: a calm, generative "airport lounge" ambience,
 * synthesised with the Web Audio API (no audio files).
 *
 * Three layers, each with its own level so they can be tuned (and switched
 * off one by one in the "Audio/Music" story):
 *
 * - pads:     slow, soft chords from `MUSIC_PROGRESSION`, one every
 *             `CHORD_SECONDS`: detuned saws through a low-pass, long attack
 *             and release so each chord melts into the next;
 * - piano:    a sparse electric-piano melody (sine FM, a "Rhodes" bell),
 *             picked at random from the current chord's notes, an octave
 *             up, with a soft echo. Seeded, so it varies from pass to pass
 *             but never repeats note for note;
 * - bass:     the chord roots, very soft.
 *
 * They share a synthetic hall reverb. The airport sounds around the music
 * (terminal hum, chatter, announcements, jets) are in audio/ambience.ts.
 *
 * Timing uses a look-ahead scheduler: `update()` (once per frame) books
 * every note due in the next `LOOKAHEAD` seconds on the audio clock, so
 * notes land exactly on time whatever the frame rate. If `update` stops
 * being called for a while (music switched off, tab hidden), the next call
 * picks up from the current time instead of rushing the missed notes.
 */
import { mulberry32 } from "../core/math";
import { hallImpulse } from "./ambience";

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** One chord of the progression, as MIDI note numbers (60 = middle C). */
export interface Chord {
  /** Chord symbol, for display (the "Audio/Music" story). */
  name: string;
  /** Bass note (played by the bass layer). */
  root: number;
  /** Pad voicing; the piano plays these an octave up. */
  notes: readonly number[];
}

/**
 * The day loop the music is built on: a gentle I–IV–ii–V in D major,
 * voiced with added 9ths and 7ths (Dmaj9 → Gmaj7 → Em9 → A7sus4), the soft,
 * unresolved colour of lounge and ambient music. After dusk the music
 * moves to `NIGHT_PROGRESSION`. Things to try:
 *   - stay on two chords (Dmaj9 ↔ Gmaj7): even calmer, more "drone";
 *   - more chords, or a longer `CHORD_SECONDS`: slower harmonic movement.
 * Keep the pad voicings within about C3–G4 (48–67) so they stay warm and
 * don't compete with the effects.
 */
export const MUSIC_PROGRESSION: readonly Chord[] = [
  { name: "Dmaj9", root: 38, notes: [50, 54, 57, 61, 64] },
  { name: "Gmaj7", root: 43, notes: [55, 59, 62, 66] },
  { name: "Em9", root: 40, notes: [52, 55, 59, 62, 66] },
  { name: "A7sus4", root: 45, notes: [57, 62, 64, 67] },
];

/**
 * The night loop, after dusk: B minor, the relative minor of the day's D
 * major (the same notes, a sadder home), so the change is a soft one:
 * Bm9 → Gmaj7 → Dmaj7 → A6. Voiced in the same C3–G4 range.
 */
export const NIGHT_PROGRESSION: readonly Chord[] = [
  { name: "Bm9", root: 35, notes: [50, 54, 57, 59, 61] },
  { name: "Gmaj7", root: 43, notes: [55, 59, 62, 66] },
  { name: "Dmaj7", root: 38, notes: [50, 54, 57, 61] },
  { name: "A6", root: 45, notes: [57, 61, 64, 66] },
];

/**
 * Switch to the night loop once `night` reaches `NIGHT_ON`, back to day
 * below `NIGHT_OFF`; the gap stops it flip-flopping. Changes land on the
 * next chord boundary.
 */
const NIGHT_ON = 0.6;
const NIGHT_OFF = 0.4;

/** At full night the piano plays this much less often. */
const NIGHT_PIANO_THIN = 0.3;

/** Seconds each chord lasts. Slow: ~2 minutes before the harmony repeats. */
export const CHORD_SECONDS = 8;

/** Melody slots per chord; each gets a piano note with `PIANO_DENSITY` odds. */
const BEATS_PER_CHORD = 8;
const PIANO_DENSITY = 0.3;

// ---------------------------------------------------------------------------
// Mix and timing
// ---------------------------------------------------------------------------

/** Layer levels (linear gain) at full music volume. */
export const LAYER_LEVELS = { pads: 0.55, piano: 0.5, bass: 0.45 };

/**
 * Note levels inside each layer, balanced by measurement (offline render,
 * RMS): pads, bass and piano melody within a few dB of each other, and the
 * whole mix ~13 dB under a departure's engines at full power.
 */
const PAD_LEVEL = 0.045;
const BASS_LEVEL = 0.09;
const PIANO_LEVEL = 0.25;

/** Share of the pads, piano and bass sent to the hall reverb. */
const REVERB_SEND = 0.45;
/** Reverb tail length (seconds). */
const REVERB_SECONDS = 3.5;

/** Pad chord envelope: fade-in and fade-out (seconds). */
const PAD_ATTACK = 2.5;
const PAD_RELEASE = 3;
/** Pad oscillator detune either side (cents), and low-pass cutoff (Hz). */
const PAD_DETUNE = 7;
const PAD_CUTOFF = 900;

/** Seconds of notes booked ahead of the audio clock. */
const LOOKAHEAD = 1.5;

export type MusicLayer = keyof typeof LAYER_LEVELS;

/** MIDI note number → frequency (Hz). */
function hz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export class Music {
  private readonly layers: Record<MusicLayer, GainNode>;
  /** Pads, piano and bass go through here: dry out, plus a reverb send. */
  private readonly tonal: GainNode;
  /** Echo on the piano. */
  private readonly echo: DelayNode;
  private readonly rng: () => number;

  /** Audio-clock time of the next chord, and its index in the progression. */
  private nextChord = -1;
  private chordIndex = 0;
  /** Recently booked chords (start time, progression index), oldest first. */
  private readonly booked: { t: number; index: number }[] = [];
  /** Seconds per chord: `CHORD_SECONDS` unless changed (see `setChordSeconds`). */
  private chordSeconds = CHORD_SECONDS;
  /** 0 day … 1 night (see `setNight`), and which loop is playing. */
  private night = 0;
  private nightMode = false;

  /**
   * @param ctx   the mixer's audio context
   * @param out   where the music plays (the mixer's music bus)
   * @param seed  seeds the melody
   */
  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    seed = 1,
  ) {
    this.rng = mulberry32(seed);

    this.layers = {
      pads: ctx.createGain(),
      piano: ctx.createGain(),
      bass: ctx.createGain(),
    };
    for (const [name, gain] of Object.entries(this.layers) as [MusicLayer, GainNode][]) {
      gain.gain.value = LAYER_LEVELS[name];
    }

    // Tonal layers → dry + hall reverb.
    this.tonal = ctx.createGain();
    this.tonal.connect(out);
    const send = ctx.createGain();
    send.gain.value = REVERB_SEND;
    const reverb = ctx.createConvolver();
    reverb.buffer = hallImpulse(ctx, REVERB_SECONDS, 0x7a11);
    this.tonal.connect(send).connect(reverb).connect(out);
    for (const name of ["pads", "piano", "bass"] as const) this.layers[name].connect(this.tonal);

    // Piano echo: a dotted-beat delay with gentle feedback, darkened a
    // little on every repeat.
    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = (this.chordSeconds / BEATS_PER_CHORD) * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    this.echo.connect(tone).connect(feedback).connect(this.echo);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    tone.connect(wet).connect(this.layers.piano);
  }

  /** Fade a layer in or out (e.g. the story's toggles). */
  setLayer(layer: MusicLayer, on: boolean): void {
    const level = on ? LAYER_LEVELS[layer] : 0;
    this.layers[layer].gain.setTargetAtTime(level, this.ctx.currentTime, 0.3);
  }

  /**
   * Change the tempo: seconds per chord, from the next chord on (the
   * "Audio/Music" story; the game plays `CHORD_SECONDS`).
   */
  setChordSeconds(seconds: number): void {
    this.chordSeconds = seconds;
    this.echo.delayTime.setTargetAtTime(
      (seconds / BEATS_PER_CHORD) * 0.75,
      this.ctx.currentTime,
      0.2,
    );
  }

  /** How dark it is, 0 day … 1 night (render/dayCycle.ts via the mixer). */
  setNight(n: number): void {
    this.night = n;
  }

  /** Is the night loop (`NIGHT_PROGRESSION`) the one playing? */
  isNight(): boolean {
    return this.nightMode;
  }

  /** The chord sounding now (its index in the loop playing, see `isNight`), or null before the first. */
  currentChord(): number | null {
    const now = this.ctx.currentTime;
    let index: number | null = null;
    for (const b of this.booked) if (b.t <= now) index = b.index;
    return index;
  }

  /** Book every note due in the next `LOOKAHEAD` seconds. Call once per frame. */
  update(): void {
    const now = this.ctx.currentTime;
    // First call, or back after a gap: start afresh just ahead of now.
    if (this.nextChord < now - 0.5) this.nextChord = now + 0.1;
    const horizon = now + LOOKAHEAD;
    while (this.nextChord < horizon) {
      // Day or night loop, decided chord by chord; a switch starts the new
      // loop from its first chord.
      const night = this.nightMode ? this.night > NIGHT_OFF : this.night >= NIGHT_ON;
      if (night !== this.nightMode) {
        this.nightMode = night;
        this.chordIndex = 0;
      }
      const progression = night ? NIGHT_PROGRESSION : MUSIC_PROGRESSION;
      const index = this.chordIndex % progression.length;
      this.scheduleChord(progression[index]!, this.nextChord);
      this.booked.push({ t: this.nextChord, index });
      if (this.booked.length > 3) this.booked.shift();
      this.chordIndex++;
      this.nextChord += this.chordSeconds;
    }
  }

  /** Nothing runs continuously: scheduled notes end by themselves. */
  dispose(): void {}

  // -------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------

  /** One chord at `t`: pads, bass and the melody slots over it. */
  private scheduleChord(chord: Chord, t: number): void {
    const end = t + this.chordSeconds;
    for (const note of chord.notes) this.padNote(note, t, end);
    this.bassNote(chord.root, t, end);
    const beat = this.chordSeconds / BEATS_PER_CHORD;
    for (let i = 0; i < BEATS_PER_CHORD; i++) {
      if (this.rng() >= PIANO_DENSITY * (1 - NIGHT_PIANO_THIN * this.night)) continue;
      const note = chord.notes[Math.floor(this.rng() * chord.notes.length)]! + 12;
      // A touch of human timing and dynamics.
      const at = t + i * beat + (this.rng() - 0.5) * 0.06;
      this.pianoNote(note, at, 0.5 + 0.5 * this.rng());
    }
  }

  /** A pad note held from `t` to `end`, fading in and out over the chord change. */
  private padNote(note: number, t: number, end: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(PAD_LEVEL, t + PAD_ATTACK);
    env.gain.setValueAtTime(PAD_LEVEL, end);
    env.gain.linearRampToValueAtTime(0, end + PAD_RELEASE);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = PAD_CUTOFF;
    filter.Q.value = 0.5;
    filter.connect(env).connect(this.layers.pads);
    for (const detune of [-PAD_DETUNE, PAD_DETUNE]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = hz(note);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(end + PAD_RELEASE + 0.05);
    }
  }

  /** A soft sine bass note under the chord. */
  private bassNote(note: number, t: number, end: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(BASS_LEVEL, t + 0.8);
    env.gain.setValueAtTime(BASS_LEVEL, end - 0.5);
    env.gain.linearRampToValueAtTime(0, end + 0.6);
    env.connect(this.layers.bass);
    const osc = ctx.createOscillator();
    osc.frequency.value = hz(note);
    osc.connect(env);
    osc.start(t);
    osc.stop(end + 0.7);
  }

  /**
   * An electric-piano note: a sine whose pitch is wobbled by a second sine
   * (FM). The wobble dies away faster than the note, so each note starts
   * with a soft bell "tine" and settles into a pure tone.
   */
  private pianoNote(note: number, t: number, velocity: number): void {
    const { ctx } = this;
    const f = hz(note);
    const ring = 2.8;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(PIANO_LEVEL * velocity, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    env.connect(this.layers.piano);
    env.connect(this.echo);

    const carrier = ctx.createOscillator();
    carrier.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 1.4 * velocity, t);
    depth.gain.exponentialRampToValueAtTime(f * 0.02, t + 0.6);
    mod.connect(depth).connect(carrier.frequency);
    carrier.connect(env);
    for (const osc of [carrier, mod]) {
      osc.start(t);
      osc.stop(t + ring + 0.05);
    }
  }
}
