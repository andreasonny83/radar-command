/**
 * Sound effects, synthesised with the Web Audio API: no audio files.
 *
 * Like the renderer, this layer only reads game state (and reacts to
 * `SimEvent`s from main.ts); it never changes it.
 *
 * - `chime()`: the tower's two-tone "ding-dong", when a departure is
 *   announced (see core/departures.ts).
 * - Engines: every departure from lining up to the top of its climb has a
 *   voice of its own, driven each frame by `update` from the plane's state:
 *   spooling up on the line-up, a roar rising in pitch and brightness with
 *   speed down the take-off roll, then fading away as it climbs out. A
 *   voice is a band of filtered noise (the roar), two detuned saws through
 *   a low-pass (the rumble) and a thin sine (the turbine whine).
 *
 * Browsers only let a page make sound after a user gesture, so the audio
 * context is created on the first `unlock()` (main.ts calls it on every
 * pointer / key press; it's cheap once running). The mute setting is kept
 * in localStorage.
 */
import { CLIMB_DISTANCE, PLANE_SPEED, ROTATE_SPEED } from "../config";
import type { GameState, Plane } from "../core/types";

/** Overall volume, 0-1. */
const MASTER_VOLUME = 0.7;

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

/** Chime notes (Hz) and their spacing / ring time (seconds). */
const CHIME_NOTES = [880, 698.46];
const CHIME_GAP = 0.32;
const CHIME_RING = 1.3;
const CHIME_VOLUME = 0.22;

/** localStorage key for the mute setting. */
const MUTE_KEY = "radar-command.muted";

/** The audio nodes of one departure's engines. */
interface EngineVoice {
  sources: AudioScheduledSourceNode[];
  roar: BiquadFilterNode;
  rumble: [OscillatorNode, OscillatorNode];
  whine: OscillatorNode;
  out: GainNode;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Map<number, EngineVoice>();
  private isMuted: boolean;
  /** Should the sound run (game playing)? Applied once the context exists. */
  private running = true;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.isMuted = this.storage?.getItem(MUTE_KEY) === "1";
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Mute or unmute everything (remembered across visits). */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.storage?.setItem(MUTE_KEY, muted ? "1" : "0");
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Create (or resume) the audio context. Call from a user gesture handler:
   * browsers refuse to start audio any other way.
   */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.isMuted ? 0 : MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
      this.noise = noiseBuffer(this.ctx);
    }
    if (this.running && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /**
   * Run or freeze all sound, e.g. while the game is paused (engines hold
   * their note and carry on when it resumes). Cheap to call every frame.
   */
  setRunning(running: boolean): void {
    if (running === this.running) return;
    this.running = running;
    if (!this.ctx) return;
    if (running) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  /** The tower's two-tone chime: a departure has been announced. */
  chime(): void {
    const { ctx, master } = this;
    if (!ctx || !master || ctx.state !== "running") return;
    CHIME_NOTES.forEach((freq, i) => {
      const start = ctx.currentTime + i * CHIME_GAP;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(CHIME_VOLUME, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, start + CHIME_RING);
      env.connect(master);
      // A sine and its octave (quieter): a soft, bell-like tone.
      for (const [mult, level] of [
        [1, 1],
        [2, 0.25],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.frequency.value = freq * mult;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(env);
        osc.start(start);
        osc.stop(start + CHIME_RING + 0.05);
      }
    });
  }

  /**
   * Give every departure between line-up and the top of its climb an
   * engine voice, set to its current power and speed; fade out and drop
   * the rest. Call once per frame.
   */
  update(state: GameState): void {
    const { ctx } = this;
    if (!ctx || !this.master || !this.noise) return;
    const now = ctx.currentTime;
    const heard = new Set<number>();
    // Nothing runs on after the shift ends (the crash has its own drama).
    const live = state.phase === "playing" || state.phase === "paused";
    for (const plane of live ? state.planes : []) {
      const sound = engineSound(plane);
      if (!sound) continue;
      heard.add(plane.id);
      let voice = this.voices.get(plane.id);
      if (!voice) {
        voice = this.createVoice(ctx, this.master, this.noise);
        this.voices.set(plane.id, voice);
      }
      const { level, speed } = sound;
      const t = ENGINE_SMOOTHING;
      voice.out.gain.setTargetAtTime(ENGINE_VOLUME * level, now, t);
      voice.roar.frequency.setTargetAtTime(350 + 2600 * level * (0.4 + 0.6 * speed), now, t);
      const base = 42 + 38 * speed + 10 * level;
      voice.rumble[0].frequency.setTargetAtTime(base, now, t);
      voice.rumble[1].frequency.setTargetAtTime(base * 1.013, now, t);
      voice.whine.frequency.setTargetAtTime(900 + 1700 * speed + 400 * level, now, t);
    }
    for (const [id, voice] of this.voices) {
      if (heard.has(id)) continue;
      this.voices.delete(id);
      voice.out.gain.setTargetAtTime(0, now, 0.25);
      for (const src of voice.sources) src.stop(now + 1.5);
    }
  }

  /** Stop every sound for good (e.g. a Storybook story being torn down). */
  close(): void {
    this.voices.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  /** Build one engine voice (silent until `update` turns it up). */
  private createVoice(ctx: AudioContext, master: GainNode, noise: AudioBuffer): EngineVoice {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);

    // Roar: looping white noise through a low-pass that opens with power.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
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
    return { sources, roar, rumble, whine, out };
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

/** Two seconds of white noise, looped by the engine voices. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** localStorage, or null where it's unavailable (private mode, tests). */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
