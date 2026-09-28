/**
 * Sound effects: the planes' own sounds are real recordings (engines,
 * runway, gear, whooshes: audio/samples.ts, credited in CREDITS.md), the
 * game's signals (chime, alert, readback) are synthesised with the Web
 * Audio API.
 *
 * Like the renderer, this layer only reads game state; it never changes it.
 * Effects come three ways:
 *
 * - State, every frame (`update`): the continuous sounds.
 *   - Take-off engines: every departure from lining up to the top of its
 *     climb has a voice of its own, in its type's recordings (jet,
 *     turboprop or piston: `ENGINE_FAMILY`): an idle and a full-power loop,
 *     blended as the throttle opens, played faster (higher) with speed and
 *     brighter with power, then fading away as it climbs out.
 *   - Rollout: tyre and runway rumble under a landing plane, from the
 *     moment its wheels touch (the end of the flare) until it turns off,
 *     slowing and dulling with its speed.
 * - Cues from the renderer (`cue`, see audio/cues.ts), timed to the
 *   animation: the gear's hydraulic whine (for exactly as long as the legs
 *   swing) and clunk, the touchdown chirp (with reverse thrust for jets),
 *   the bank whoosh and the near-miss alert.
 * - Game moments (called by the mixer): the departure chime, a go-around's
 *   engines spooling to full power, and the radio readback when the player
 *   finishes a path.
 *
 * A recording that hasn't loaded (or failed to) is simply skipped.
 *
 * Everything tied to a plane is panned to where it is on screen. While the
 * camera follows a plane (`setFocus`), its sounds step forward and every
 * other plane's drop back, so what's heard matches the close-up; the
 * near-miss alert is the exception (it's a warning, not scenery). The audio
 * context, mute settings and pausing belong to the mixer (audio/mixer.ts),
 * which plays these effects into its effects bus.
 */
import {
  CLIMB_DISTANCE,
  FLARE_DISTANCE,
  LANDING_SPEED_START,
  PLANE_SPEED,
  ROTATE_SPEED,
} from "../config";
import { aircraftKindFor, type AircraftKind } from "../core/fleet";
import type { GameState, Plane } from "../core/types";
import type { AudioCue, PanLookup } from "./cues";
import type { SampleId, Samples } from "./samples";

/**
 * Loudest an engine voice gets (at full power, close by). The recordings
 * are levelled to -20 dBFS RMS by the audio pipeline; this puts a
 * departure's take-off roll at the same loudness as the old synthesised
 * roar (measured: offline render, RMS), the loudest thing in the game.
 */
const ENGINE_VOLUME = 1.27;

/** Share of full power while lined up, spooling up before the roll. */
const SPOOL_THROTTLE = 0.35;

/**
 * An engine fades out over this distance flown after lift-off (the plane
 * climbing away from the airfield's microphones).
 */
const ENGINE_FADE_DISTANCE = CLIMB_DISTANCE * 1.6;

/** Time constant (seconds) for engine parameter changes: smooth, never stepped. */
const ENGINE_SMOOTHING = 0.12;

/**
 * Engine playback speed (and pitch): `ENGINE_RATE[0]` standing still,
 * rising with speed, never outside the range (beyond ~±25 % a recording
 * starts to sound sped up rather than revved up).
 */
const ENGINE_RATE = [0.85, 1.25] as const;
const ENGINE_RATE_PER_SPEED = 0.4;

/** Engine low-pass cut-off (Hz): duller at low power and far away, open at full power. */
const ENGINE_CUTOFF = [900, 7900] as const;

/** Which engine recordings each aircraft type plays (audio/samples.ts). */
const ENGINE_FAMILY: Record<AircraftKind, "jet" | "turboprop" | "piston"> = {
  airliner: "jet",
  turboprop: "turboprop",
  light: "piston",
};

/** Loudness of each type's engines and runway sounds: the trainer is the quietest. */
const KIND_SCALE: Record<AircraftKind, number> = { airliner: 1, turboprop: 0.8, light: 0.55 };

/** Tyre-chirp playback speed per type: a small plane's tyres squeal higher. */
const CHIRP_RATE: Record<AircraftKind, number> = { airliner: 0.9, turboprop: 1, light: 1.1 };

/** The fly-by recordings the bank whoosh picks from (a different one each time). */
const WHOOSHES: readonly SampleId[] = ["whoosh-1", "whoosh-2", "whoosh-3"];

/** Loudest the rollout rumble gets (just after touchdown). */
const ROLLOUT_VOLUME = 0.33;

/**
 * Follow mode (see `setFocus`): the followed plane's sounds are scaled by
 * `FOCUS_LEVEL` (it's right under the zoomed-in camera), every other
 * plane's by `BACKGROUND_LEVEL`, so they recede without vanishing.
 */
const FOCUS_LEVEL = 1.3;
const BACKGROUND_LEVEL = 0.2;

/** Chime notes (Hz) and their spacing / ring time (seconds). */
const CHIME_NOTES = [880, 698.46];
const CHIME_GAP = 0.32;
const CHIME_RING = 1.3;
const CHIME_VOLUME = 0.22;

/**
 * Near-miss alert: a soft two-tone (Hz), each tone `ALERT_TONE` seconds,
 * played twice. At most once per plane every `ALERT_GAP_PLANE` seconds and
 * once overall every `ALERT_GAP`, so a crowded sky doesn't turn into a
 * siren.
 */
const ALERT_TONES = [659.26, 880];
const ALERT_TONE = 0.11;
const ALERT_GAP = 1.2;
const ALERT_GAP_PLANE = 4;
const ALERT_VOLUME = 0.09;

/**
 * Levels of the one-shot effects, balanced by measurement (offline render,
 * RMS through the master): cues that matter for play (readback, alert,
 * touchdown) around -34 dBFS, the gear and whoosh around -40 (texture,
 * just above the music's -35 bed), a go-around's engines up to -31, all
 * under a departure's full-power roar (-20). The recorded sounds were
 * matched to those levels (offline renders of old and new, RMS).
 */
const LEVELS = {
  gearWhine: 0.23,
  gearClunk: 0.25,
  chirp: 0.18,
  reverse: 0.4,
  goAround: 0.78,
  whoosh: 0.18,
  readback: 0.07,
  squelch: 0.03,
  // Square waves carry more energy than the readback's sines at the same
  // peak, so a lower level lands the "denied" buzz beside it (~-34 dBFS).
  reject: 0.045,
};

/**
 * The "landing rejected" buzz (see `Sfx.reject`): two falling notes, a
 * fourth apart (E♭4 → B♭3), low and square like a game's "denied", clearly
 * apart from the readback's rising two-tone.
 */
const REJECT_NOTES = [311.1, 233.1];
/** Seconds each note of the reject buzz lasts, back to back. */
const REJECT_NOTE = 0.13;
/** Low-pass over the buzz (Hz): keeps the square's edge without the fizz. */
const REJECT_TONE = 1800;

/**
 * The audio nodes of one departure's engines: its type's idle and
 * full-power recordings, both looping, blended by power.
 */
interface EngineVoice {
  sources: [idle: AudioBufferSourceNode, full: AudioBufferSourceNode];
  idle: GainNode;
  full: GainNode;
  tone: BiquadFilterNode;
  out: GainNode;
  pan: StereoPannerNode;
}

/** The audio nodes of one landing plane's rollout rumble (a looping recording). */
interface RolloutVoice {
  source: AudioBufferSourceNode;
  tone: BiquadFilterNode;
  out: GainNode;
  pan: StereoPannerNode;
}

export class Sfx {
  private readonly engines = new Map<number, EngineVoice>();
  private readonly rollouts = new Map<number, RolloutVoice>();
  private readonly noise: AudioBuffer;
  /** Audio-clock time of the last near-miss alert, overall and per plane. */
  private lastAlert = -Infinity;
  private readonly lastAlertFor = new Map<number, number>();
  /** The plane the camera follows, whose sounds lead the mix; null for none. */
  private focus: number | null = null;

  /**
   * @param ctx  the mixer's audio context
   * @param out  where the effects play (the mixer's effects bus)
   * @param samples  the recorded sounds (audio/samples.ts)
   */
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly samples: Samples,
  ) {
    this.noise = noiseBuffer(ctx);
  }

  /**
   * Focus the mix on one plane (the one the camera follows), or null to
   * hear every plane alike. Continuous sounds ease over; one-shots already
   * playing keep their level.
   */
  setFocus(planeId: number | null): void {
    this.focus = planeId;
  }

  /**
   * Level scale for a sound from plane `planeId` under the current focus:
   * 1 with nothing followed, else `FOCUS_LEVEL` for the followed plane and
   * `BACKGROUND_LEVEL` for the rest (and for sounds of unknown origin).
   */
  private focusLevel(planeId: number | undefined): number {
    if (this.focus === null) return 1;
    return planeId === this.focus ? FOCUS_LEVEL : BACKGROUND_LEVEL;
  }

  // -------------------------------------------------------------------------
  // Game moments
  // -------------------------------------------------------------------------

  /** The tower's two-tone chime: a departure has been announced. */
  chime(): void {
    const { ctx, out } = this;
    if (ctx.state !== "running") return;
    CHIME_NOTES.forEach((freq, i) => {
      const start = ctx.currentTime + i * CHIME_GAP;
      this.bell(out, freq, start, CHIME_RING, CHIME_VOLUME);
    });
  }

  /**
   * A go-around: the plane's own engines (its type's full-power
   * recording) spool up to full power over ~2 s, hold, and fade as it
   * climbs away. `planeId` is the plane going around (its type, and the
   * follow-mode focus).
   */
  goAround(pan: number, planeId?: number): void {
    const t = this.ctx.currentTime;
    const kind = planeId === undefined ? "airliner" : aircraftKindFor(planeId);
    const sound = this.play(
      `engine-${ENGINE_FAMILY[kind]}-full`,
      pan,
      this.focusLevel(planeId),
      t,
      {
        loop: true,
      },
    );
    if (!sound) return;
    const env = sound.env.gain;
    const level = LEVELS.goAround * KIND_SCALE[kind];
    env.setValueAtTime(0, t);
    env.linearRampToValueAtTime(level * 0.4, t + 0.3);
    env.linearRampToValueAtTime(level, t + 2);
    env.setValueAtTime(level, t + 3);
    env.linearRampToValueAtTime(0, t + 4.8);
    // The spool-up: the pitch rises with the power.
    sound.src.playbackRate.setValueAtTime(ENGINE_RATE[0], t);
    sound.src.playbackRate.linearRampToValueAtTime(1.15, t + 2);
    sound.src.stop(t + 5);
  }

  /**
   * The tower acknowledging a new path: a squelch and a double "roger"
   * beep, or, when the path is locked onto a runway (cleared to land), a
   * rising two-tone. Not panned: it's the radio in the tower.
   */
  readback(anchored: boolean): void {
    const t = this.ctx.currentTime;
    this.squelchBurst(this.out, t, 0.06);
    const tones = anchored ? [880, 1318.5] : [1046.5, 1046.5];
    tones.forEach((freq, i) =>
      this.beep(this.out, freq, t + 0.08 + i * 0.12, 0.08, LEVELS.readback),
    );
    this.squelchBurst(this.out, t + 0.08 + tones.length * 0.12, 0.05);
  }

  /**
   * A landing that won't happen: the path was let go of on a runway
   * without locking on, or a plane on approach had to go around (see
   * render/rejectMarks.ts, the red X it goes with). A short, low, falling
   * two-note buzz. Not panned: like the readback, it's the tower's signal.
   */
  reject(): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = REJECT_TONE;
    tone.connect(this.out);
    REJECT_NOTES.forEach((freq, i) =>
      this.beep(tone, freq, t + i * REJECT_NOTE, REJECT_NOTE, LEVELS.reject, "square"),
    );
  }

  // -------------------------------------------------------------------------
  // Cues from the renderer
  // -------------------------------------------------------------------------

  /** Play a render cue (see audio/cues.ts) now. */
  cue(cue: AudioCue): void {
    const t = this.ctx.currentTime;
    // Stepped forward or back by the follow-mode focus (not the alert).
    const level = this.focusLevel(cue.planeId);
    switch (cue.type) {
      case "gearMove":
        this.gearWhine(cue.pan, level, t, cue.seconds, cue.down);
        break;
      case "gearLocked":
        this.gearClunk(cue.pan, level, t, cue.down);
        break;
      case "touchdown":
        this.touchdown(cue.pan, level, t, aircraftKindFor(cue.planeId));
        break;
      case "bankWhoosh":
        this.whoosh(cue.pan, level, t, cue.strength);
        break;
      case "warning":
        this.alert(cue.planeId, cue.pan, t);
        break;
    }
  }

  /**
   * Gear travelling: the hydraulic pump (a looping recording), for exactly
   * as long as the legs swing, its pitch rising a little as it works;
   * retracting (lifting the legs) runs a touch higher than extending.
   */
  private gearWhine(pan: number, level: number, t: number, seconds: number, down: boolean): void {
    const dur = Math.max(0.2, seconds);
    const sound = this.play("gear-hydraulic", pan, level, t, { loop: true });
    if (!sound) return;
    const env = sound.env.gain;
    env.setValueAtTime(0, t);
    env.linearRampToValueAtTime(LEVELS.gearWhine, t + 0.05);
    env.setValueAtTime(LEVELS.gearWhine, t + dur - 0.05);
    env.linearRampToValueAtTime(0, t + dur);
    const base = down ? 1 : 1.05;
    sound.src.playbackRate.setValueAtTime(base, t);
    sound.src.playbackRate.linearRampToValueAtTime(base * 1.08, t + dur);
    sound.src.stop(t + dur + 0.05);
  }

  /** Gear locked: a heavy steel clunk (lower and louder going down). */
  private gearClunk(pan: number, level: number, t: number, down: boolean): void {
    this.play("gear-clunk", pan, level, t, {
      gain: LEVELS.gearClunk * (down ? 1.2 : 1),
      rate: down ? 0.9 : 1.05,
    });
  }

  /**
   * Wheels on the runway: a tyre chirp (higher for smaller planes), and
   * for jets the reverse thrust roaring up to slow the plane (the
   * recording opens on its own touchdown bump, so it starts right away).
   */
  private touchdown(pan: number, level: number, t: number, kind: AircraftKind): void {
    const scale = KIND_SCALE[kind];
    this.play("touchdown-chirp", pan, level, t, {
      gain: LEVELS.chirp * scale,
      rate: CHIRP_RATE[kind],
    });
    if (kind === "airliner") this.play("reverse-thrust", pan, level, t, { gain: LEVELS.reverse });
  }

  /**
   * Air over the wings in a hard turn: a fly-by recording (a different
   * one each time), louder and quicker the harder the bank.
   */
  private whoosh(pan: number, level: number, t: number, strength: number): void {
    const id = WHOOSHES[Math.floor(Math.random() * WHOOSHES.length)]!;
    this.play(id, pan, level, t, {
      gain: LEVELS.whoosh * Math.min(1.3, strength),
      rate: 0.9 + 0.3 * Math.min(1, strength),
    });
  }

  /** Near-miss: a soft two-tone, twice, rate-limited (see `ALERT_GAP`). */
  private alert(planeId: number, pan: number, t: number): void {
    const since = t - (this.lastAlertFor.get(planeId) ?? -Infinity);
    if (t - this.lastAlert < ALERT_GAP || since < ALERT_GAP_PLANE) return;
    this.lastAlert = t;
    this.lastAlertFor.set(planeId, t);
    const out = this.oneShot(pan * 0.5); // alerts stay near the middle
    out.gain.value = 1;
    for (let i = 0; i < 4; i++) {
      const freq = ALERT_TONES[i % 2]!;
      this.beep(out, freq, t + i * ALERT_TONE, ALERT_TONE * 0.9, ALERT_VOLUME, "triangle");
    }
  }

  // -------------------------------------------------------------------------
  // Continuous sounds, from state
  // -------------------------------------------------------------------------

  /**
   * Give every departure between line-up and the top of its climb an
   * engine voice, and every landing plane whose wheels are down a rollout
   * rumble, each set to its current power / speed (scaled by the follow
   * focus) and panned by `pan`; fade out and drop the rest. Call once per
   * frame.
   */
  update(state: GameState, pan: PanLookup = () => 0): void {
    const { ctx } = this;
    const now = ctx.currentTime;
    const engines = new Set<number>();
    const rollouts = new Set<number>();
    // Nothing runs on after the shift ends (the crash has its own drama).
    const live = state.phase === "playing" || state.phase === "paused";
    for (const plane of live ? state.planes : []) {
      const kind = aircraftKindFor(plane.id);
      const sound = engineSound(plane);
      // A voice needs its recordings: until they've loaded, the plane is
      // silent (and gets its voice on the first frame they're there).
      const engine = sound
        ? (this.engines.get(plane.id) ?? this.createEngine(plane.id, kind))
        : null;
      if (sound && engine) {
        engines.add(plane.id);
        const { level, speed } = sound;
        const t = ENGINE_SMOOTHING;
        // Idle blends into full power as the throttle opens (equal power:
        // the sum stays as loud mid-blend as at either end).
        const blend = (Math.min(1, level) * Math.PI) / 2;
        engine.idle.gain.setTargetAtTime(Math.cos(blend), now, t);
        engine.full.gain.setTargetAtTime(Math.sin(blend), now, t);
        const rate = Math.min(ENGINE_RATE[1], ENGINE_RATE[0] + ENGINE_RATE_PER_SPEED * speed);
        for (const src of engine.sources) src.playbackRate.setTargetAtTime(rate, now, t);
        const cutoff = ENGINE_CUTOFF[0] + (ENGINE_CUTOFF[1] - ENGINE_CUTOFF[0]) * level;
        engine.tone.frequency.setTargetAtTime(cutoff, now, t);
        const gain = ENGINE_VOLUME * KIND_SCALE[kind] * level * this.focusLevel(plane.id);
        engine.out.gain.setTargetAtTime(gain, now, t);
        engine.pan.pan.setTargetAtTime(pan(plane.id), now, t);
      }
      const roll = rolloutLevel(plane);
      const rollout =
        roll > 0 ? (this.rollouts.get(plane.id) ?? this.createRollout(plane.id)) : null;
      if (rollout) {
        rollouts.add(plane.id);
        const gain = ROLLOUT_VOLUME * KIND_SCALE[kind] * roll * this.focusLevel(plane.id);
        rollout.out.gain.setTargetAtTime(gain, now, 0.15);
        // Slower and duller as the plane brakes.
        rollout.source.playbackRate.setTargetAtTime(0.8 + 0.3 * roll, now, 0.15);
        rollout.tone.frequency.setTargetAtTime(500 + 1500 * roll, now, 0.15);
        rollout.pan.pan.setTargetAtTime(pan(plane.id), now, 0.15);
      }
    }
    for (const [id, voice] of this.engines) {
      if (engines.has(id)) continue;
      this.engines.delete(id);
      voice.out.gain.setTargetAtTime(0, now, 0.25);
      for (const src of voice.sources) src.stop(now + 1.5);
    }
    for (const [id, voice] of this.rollouts) {
      if (rollouts.has(id)) continue;
      this.rollouts.delete(id);
      voice.out.gain.setTargetAtTime(0, now, 0.3);
      voice.source.stop(now + 1.5);
    }
  }

  /**
   * Build plane `planeId`'s engine voice (silent until `update` turns it
   * up), or null while its type's recordings haven't loaded.
   */
  private createEngine(planeId: number, kind: AircraftKind): EngineVoice | null {
    const family = ENGINE_FAMILY[kind];
    const idleBuffer = this.samples.get(`engine-${family}-idle`);
    const fullBuffer = this.samples.get(`engine-${family}-full`);
    if (!idleBuffer || !fullBuffer) return null;
    const { ctx } = this;
    const pan = ctx.createStereoPanner();
    pan.connect(this.out);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(pan);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = ENGINE_CUTOFF[0];
    tone.connect(out);
    const idle = ctx.createGain();
    idle.gain.value = 1;
    idle.connect(tone);
    const full = ctx.createGain();
    full.gain.value = 0;
    full.connect(tone);
    const sources = [this.loop(idleBuffer, idle), this.loop(fullBuffer, full)] as [
      AudioBufferSourceNode,
      AudioBufferSourceNode,
    ];
    const voice = { sources, idle, full, tone, out, pan };
    this.engines.set(planeId, voice);
    return voice;
  }

  /**
   * Build plane `planeId`'s rollout rumble (silent until `update` turns it
   * up), or null while the recording hasn't loaded.
   */
  private createRollout(planeId: number): RolloutVoice | null {
    const buffer = this.samples.get("rollout");
    if (!buffer) return null;
    const { ctx } = this;
    const pan = ctx.createStereoPanner();
    pan.connect(this.out);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(pan);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2000;
    tone.connect(out);
    const voice = { source: this.loop(buffer, tone), tone, out, pan };
    this.rollouts.set(planeId, voice);
    return voice;
  }

  /**
   * Start `buffer` looping into `out` from a random point, so planes
   * sharing a recording never play it in step (which would phase).
   */
  private loop(buffer: AudioBuffer, out: AudioNode): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(out);
    src.start(0, Math.random() * buffer.duration);
    return src;
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  /**
   * A gain (envelope) → level → panner → effects bus chain for a one-shot
   * sound. `level` scales the whole sound (the follow focus), so the
   * envelopes keep their own `LEVELS`.
   */
  private oneShot(pan: number, level = 1): GainNode {
    const { ctx } = this;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.out);
    const trim = ctx.createGain();
    trim.gain.value = level;
    trim.connect(panner);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(trim);
    return gain;
  }

  /**
   * Play recording `id` at `t` through a one-shot chain (see `oneShot`):
   * `gain` sets its level (or shape `env` yourself), `rate` its speed and
   * pitch, `loop` keeps it going until stopped. Null (and silence) if the
   * recording hasn't loaded.
   */
  private play(
    id: SampleId,
    pan: number,
    level: number,
    t: number,
    { gain = 0, rate = 1, loop = false }: { gain?: number; rate?: number; loop?: boolean } = {},
  ): { src: AudioBufferSourceNode; env: GainNode } | null {
    const buffer = this.samples.get(id);
    if (!buffer) return null;
    const env = this.oneShot(pan, level);
    env.gain.value = gain;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    src.connect(env);
    src.start(t);
    return { src, env };
  }

  /** The shared noise buffer, played from a random point for `dur` seconds. */
  private noiseSource(t: number, dur: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  /** A clean beep of `freq` Hz, with soft edges so it doesn't click. */
  private beep(
    out: AudioNode,
    freq: number,
    t: number,
    dur: number,
    level: number,
    type: OscillatorType = "sine",
  ): void {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.008);
    env.gain.setValueAtTime(level, t + dur - 0.015);
    env.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Radio squelch: a burst of band-limited hiss. */
  private squelchBurst(out: AudioNode, t: number, dur: number): void {
    const { ctx } = this;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 1.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(LEVELS.squelch, t + 0.005);
    env.gain.setValueAtTime(LEVELS.squelch, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    this.noiseSource(t, dur + 0.03)
      .connect(band)
      .connect(env)
      .connect(out);
  }

  /** A bell-like note: a sine and its octave (quieter), struck and ringing out. */
  private bell(out: AudioNode, freq: number, t: number, ring: number, level: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    env.connect(out);
    for (const [mult, partial] of [
      [1, 1],
      [2, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = partial;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + ring + 0.05);
    }
  }
}

/**
 * How a plane's engines should sound right now, or null for silence (not
 * a departure, not lined up yet, or climbed out of earshot).
 *
 * @returns `level`: loudness and power, 0-1; `speed`: how fast it's going
 *          as a share of cruise speed, 0-1 (drives the pitch).
 */
export function engineSound(plane: Plane): { level: number; speed: number } | null {
  const dep = plane.departure;
  if (!dep) return null;
  switch (plane.phase) {
    case "outbound":
      // Lined up and spooling up: `lineupTime` only counts up there.
      return dep.lineupTime > 0 ? { level: SPOOL_THROTTLE, speed: 0 } : null;
    case "takeoff": {
      const v = plane.ground?.speed ?? 0;
      // Full power from the brakes' release, spinning up over the first second.
      return { level: 0.6 + 0.4 * Math.min(1, v / (ROTATE_SPEED * 0.3)), speed: v / PLANE_SPEED };
    }
    case "climbout": {
      const fade = 1 - Math.min(1, dep.climbed / ENGINE_FADE_DISTANCE);
      if (fade <= 0) return null;
      return { level: fade * fade, speed: dep.speed / PLANE_SPEED };
    }
    default:
      return null;
  }
}

/**
 * Loudness of a landing plane's rollout rumble, 0-1: from the moment its
 * wheels are on the runway (the end of the flare, `FLARE_DISTANCE` rolled:
 * the same moment the renderer raises the `touchdown` cue) until it turns
 * off, following its speed down. 0 for anything else.
 */
export function rolloutLevel(plane: Plane): number {
  const g = plane.ground;
  if (!g || plane.phase !== "landing" || g.travelled < FLARE_DISTANCE) return 0;
  return Math.min(1, g.speed / (PLANE_SPEED * LANDING_SPEED_START));
}

/** Two seconds of white noise, looped by the engine voices and the ambience. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
