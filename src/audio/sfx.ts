/**
 * Sound effects, synthesised with the Web Audio API: no audio files.
 *
 * Like the renderer, this layer only reads game state; it never changes it.
 * Effects come three ways:
 *
 * - State, every frame (`update`): the continuous sounds.
 *   - Take-off engines: every departure from lining up to the top of its
 *     climb has a voice of its own: spooling up on the line-up, a roar
 *     rising in pitch and brightness with speed down the take-off roll,
 *     then fading away as it climbs out. A voice is a band of filtered
 *     noise (the roar), two detuned saws through a low-pass (the rumble)
 *     and a thin sine (the turbine whine).
 *   - Rollout: tyre and runway rumble under a landing plane, from the
 *     moment its wheels touch (the end of the flare) until it turns off,
 *     falling with its speed.
 * - Cues from the renderer (`cue`, see audio/cues.ts), timed to the
 *   animation: gear whine and clunk, the touchdown chirp (with a burst of
 *   reverse thrust), the bank whoosh and the near-miss alert.
 * - Game moments (called by the mixer): the departure chime, a go-around's
 *   engines spooling to full power, and the radio readback when the player
 *   finishes a path.
 *
 * Everything tied to a plane is panned to where it is on screen. The audio
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
import type { GameState, Plane } from "../core/types";
import type { AudioCue, PanLookup } from "./cues";

/** Loudest an engine voice gets (at full power, close by). */
const ENGINE_VOLUME = 0.32;

/** Share of full power while lined up, spooling up before the roll. */
const SPOOL_THROTTLE = 0.35;

/**
 * An engine fades out over this distance flown after lift-off (the plane
 * climbing away from the airfield's microphones).
 */
const ENGINE_FADE_DISTANCE = CLIMB_DISTANCE * 1.6;

/** Time constant (seconds) for engine parameter changes: smooth, never stepped. */
const ENGINE_SMOOTHING = 0.12;

/** Loudest the rollout rumble gets (just after touchdown). */
const ROLLOUT_VOLUME = 0.22;

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
 * under a departure's full-power roar (-20).
 */
const LEVELS = {
  gearWhine: 0.11,
  gearClunk: 0.2,
  chirp: 0.09,
  thump: 0.22,
  reverse: 0.2,
  goAround: 0.2,
  whoosh: 0.16,
  readback: 0.07,
  squelch: 0.03,
};

/** The audio nodes of one departure's engines. */
interface EngineVoice {
  sources: AudioScheduledSourceNode[];
  roar: BiquadFilterNode;
  rumble: [OscillatorNode, OscillatorNode];
  whine: OscillatorNode;
  out: GainNode;
  pan: StereoPannerNode;
}

/** The audio nodes of one landing plane's rollout rumble. */
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

  /**
   * @param ctx  the mixer's audio context
   * @param out  where the effects play (the mixer's effects bus)
   */
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {
    this.noise = noiseBuffer(ctx);
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
   * A go-around: the engines spool up to full power over ~2 s, hold, and
   * fade as the plane climbs away.
   */
  goAround(pan: number): void {
    const t = this.ctx.currentTime;
    const out = this.oneShot(pan);
    const env = out.gain;
    env.setValueAtTime(0, t);
    env.linearRampToValueAtTime(LEVELS.goAround * 0.4, t + 0.3);
    env.linearRampToValueAtTime(LEVELS.goAround, t + 2);
    env.setValueAtTime(LEVELS.goAround, t + 3);
    env.linearRampToValueAtTime(0, t + 4.8);
    this.jetRoar(out, t, 5, [300, 2600, 1400], [45, 85, 80]);
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

  // -------------------------------------------------------------------------
  // Cues from the renderer
  // -------------------------------------------------------------------------

  /** Play a render cue (see audio/cues.ts) now. */
  cue(cue: AudioCue): void {
    const t = this.ctx.currentTime;
    switch (cue.type) {
      case "gearMove":
        this.gearWhine(cue.pan, t, cue.seconds, cue.down);
        break;
      case "gearLocked":
        this.gearClunk(cue.pan, t, cue.down);
        break;
      case "touchdown":
        this.touchdown(cue.pan, t);
        break;
      case "bankWhoosh":
        this.whoosh(cue.pan, t, cue.strength);
        break;
      case "warning":
        this.alert(cue.planeId, cue.pan, t);
        break;
    }
  }

  /**
   * Gear travelling: a hydraulic whine (a buzzy tone through a narrow band,
   * rising in pitch as the pump works) with a little hiss, for exactly as
   * long as the legs swing.
   */
  private gearWhine(pan: number, t: number, seconds: number, down: boolean): void {
    const { ctx } = this;
    const dur = Math.max(0.2, seconds);
    const out = this.oneShot(pan);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(LEVELS.gearWhine, t + 0.12);
    out.gain.setValueAtTime(LEVELS.gearWhine, t + dur - 0.12);
    out.gain.linearRampToValueAtTime(0, t + dur);
    const pump = ctx.createOscillator();
    pump.type = "sawtooth";
    const base = down ? 170 : 190;
    pump.frequency.setValueAtTime(base, t);
    pump.frequency.linearRampToValueAtTime(base * 1.25, t + dur);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 3;
    pump.connect(band).connect(out);
    pump.start(t);
    pump.stop(t + dur + 0.05);
    const hiss = this.noiseSource(t, dur);
    const hissBand = ctx.createBiquadFilter();
    hissBand.type = "highpass";
    hissBand.frequency.value = 2500;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.3;
    hiss.connect(hissBand).connect(hissGain).connect(out);
  }

  /** Gear locked: a short low thump with a metallic click (deeper going down). */
  private gearClunk(pan: number, t: number, down: boolean): void {
    const out = this.oneShot(pan);
    out.gain.value = 1;
    this.thump(out, t, down ? 85 : 110, 0.14, LEVELS.gearClunk);
    this.click(out, t, 1800, 0.03, LEVELS.gearClunk * 0.35);
  }

  /**
   * Wheels on the runway: two quick tyre chirps (a squeal gliding down)
   * over a thump, then a burst of reverse thrust swelling and dying away.
   */
  private touchdown(pan: number, t: number): void {
    const { ctx } = this;
    const out = this.oneShot(pan);
    out.gain.value = 1;
    this.thump(out, t, 60, 0.25, LEVELS.thump);
    for (const [at, level] of [
      [0, 1],
      [0.09, 0.6],
    ] as const) {
      const squeal = ctx.createOscillator();
      squeal.type = "triangle";
      squeal.frequency.setValueAtTime(1300, t + at);
      squeal.frequency.exponentialRampToValueAtTime(650, t + at + 0.09);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t + at);
      env.gain.exponentialRampToValueAtTime(LEVELS.chirp * level, t + at + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.1);
      squeal.connect(env).connect(out);
      squeal.start(t + at);
      squeal.stop(t + at + 0.12);
    }
    // Reverse thrust: the engines roar back up to slow the plane.
    const rev = this.oneShot(pan);
    rev.gain.setValueAtTime(0, t + 0.3);
    rev.gain.linearRampToValueAtTime(LEVELS.reverse, t + 1.1);
    rev.gain.linearRampToValueAtTime(0, t + 3.2);
    this.jetRoar(rev, t + 0.3, 3, [500, 1800, 700], [60, 70, 55]);
  }

  /** Airflow over the wings in a hard turn: a band of noise swept up and back. */
  private whoosh(pan: number, t: number, strength: number): void {
    const { ctx } = this;
    const dur = 0.9;
    const out = this.oneShot(pan);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(LEVELS.whoosh * Math.min(1.3, strength), t + dur * 0.4);
    out.gain.linearRampToValueAtTime(0, t + dur);
    const src = this.noiseSource(t, dur);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(400, t);
    band.frequency.linearRampToValueAtTime(1300, t + dur * 0.45);
    band.frequency.linearRampToValueAtTime(500, t + dur);
    src.connect(band).connect(out);
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
   * rumble, each set to its current power / speed and panned by `pan`;
   * fade out and drop the rest. Call once per frame.
   */
  update(state: GameState, pan: PanLookup = () => 0): void {
    const { ctx } = this;
    const now = ctx.currentTime;
    const engines = new Set<number>();
    const rollouts = new Set<number>();
    // Nothing runs on after the shift ends (the crash has its own drama).
    const live = state.phase === "playing" || state.phase === "paused";
    for (const plane of live ? state.planes : []) {
      const sound = engineSound(plane);
      if (sound) {
        engines.add(plane.id);
        let voice = this.engines.get(plane.id);
        if (!voice) {
          voice = this.createEngine();
          this.engines.set(plane.id, voice);
        }
        const { level, speed } = sound;
        const t = ENGINE_SMOOTHING;
        voice.out.gain.setTargetAtTime(ENGINE_VOLUME * level, now, t);
        voice.roar.frequency.setTargetAtTime(350 + 2600 * level * (0.4 + 0.6 * speed), now, t);
        const base = 42 + 38 * speed + 10 * level;
        voice.rumble[0].frequency.setTargetAtTime(base, now, t);
        voice.rumble[1].frequency.setTargetAtTime(base * 1.013, now, t);
        voice.whine.frequency.setTargetAtTime(900 + 1700 * speed + 400 * level, now, t);
        voice.pan.pan.setTargetAtTime(pan(plane.id), now, t);
      }
      const roll = rolloutLevel(plane);
      if (roll > 0) {
        rollouts.add(plane.id);
        let voice = this.rollouts.get(plane.id);
        if (!voice) {
          voice = this.createRollout();
          this.rollouts.set(plane.id, voice);
        }
        voice.out.gain.setTargetAtTime(ROLLOUT_VOLUME * roll, now, 0.15);
        voice.tone.frequency.setTargetAtTime(120 + 380 * roll, now, 0.15);
        voice.pan.pan.setTargetAtTime(pan(plane.id), now, 0.15);
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

  /** Build one engine voice (silent until `update` turns it up). */
  private createEngine(): EngineVoice {
    const { ctx } = this;
    const pan = ctx.createStereoPanner();
    pan.connect(this.out);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(pan);

    // Roar: looping white noise through a low-pass that opens with power.
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const roar = ctx.createBiquadFilter();
    roar.type = "lowpass";
    roar.frequency.value = 350;
    roar.Q.value = 0.8;
    hiss.connect(roar).connect(out);

    // Rumble: two slightly detuned saws, their beating gives a throb.
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 420;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.35;
    rumbleFilter.connect(rumbleGain).connect(out);
    const rumble = [ctx.createOscillator(), ctx.createOscillator()] as [
      OscillatorNode,
      OscillatorNode,
    ];
    for (const osc of rumble) {
      osc.type = "sawtooth";
      osc.frequency.value = 45;
      osc.connect(rumbleFilter);
    }

    // Whine: a faint high sine, rising with the engine speed.
    const whine = ctx.createOscillator();
    whine.frequency.value = 900;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.035;
    whine.connect(whineGain).connect(out);

    const sources: AudioScheduledSourceNode[] = [hiss, ...rumble, whine];
    for (const src of sources) src.start();
    return { sources, roar, rumble, whine, out, pan };
  }

  /** Build one rollout rumble: looping noise, low-passed (silent until `update`). */
  private createRollout(): RolloutVoice {
    const { ctx } = this;
    const pan = ctx.createStereoPanner();
    pan.connect(this.out);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(pan);
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 300;
    tone.Q.value = 0.7;
    source.connect(tone).connect(out);
    source.start();
    return { source, tone, out, pan };
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  /** A gain (envelope) → panner → effects bus chain for a one-shot sound. */
  private oneShot(pan: number): GainNode {
    const { ctx } = this;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.out);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(panner);
    return gain;
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

  /**
   * Jet engines for `dur` seconds from `t` into `out` (whose gain is the
   * envelope): filtered noise whose cut-off follows `cutoff` (start, peak,
   * end, Hz) and a detuned saw rumble following `pitch` (start, peak, end).
   * The peak falls 40 % of the way through.
   */
  private jetRoar(
    out: AudioNode,
    t: number,
    dur: number,
    cutoff: readonly [number, number, number],
    pitch: readonly [number, number, number],
  ): void {
    const { ctx } = this;
    const peak = t + dur * 0.4;
    const roar = ctx.createBiquadFilter();
    roar.type = "lowpass";
    roar.frequency.setValueAtTime(cutoff[0], t);
    roar.frequency.linearRampToValueAtTime(cutoff[1], peak);
    roar.frequency.linearRampToValueAtTime(cutoff[2], t + dur);
    this.noiseSource(t, dur).connect(roar).connect(out);
    const rumble = ctx.createBiquadFilter();
    rumble.type = "lowpass";
    rumble.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    rumble.connect(g).connect(out);
    for (const detune of [1, 1.013]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(pitch[0] * detune, t);
      osc.frequency.linearRampToValueAtTime(pitch[1] * detune, peak);
      osc.frequency.linearRampToValueAtTime(pitch[2] * detune, t + dur);
      osc.connect(rumble);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  /** A low sine thump: pitch dropping, fast decay. */
  private thump(out: AudioNode, t: number, freq: number, dur: number, level: number): void {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A short click: a sliver of noise through a band around `freq`. */
  private click(out: AudioNode, t: number, freq: number, dur: number, level: number): void {
    const { ctx } = this;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = 2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.noiseSource(t, dur).connect(band).connect(env).connect(out);
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
