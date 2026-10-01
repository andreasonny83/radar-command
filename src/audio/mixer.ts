/**
 * The game's audio: one Web Audio context, and a small mixer that routes
 * the sound effects (audio/sfx.ts), the airport ambience
 * (audio/ambience.ts) and the background music (audio/music.ts) on
 * separate buses:
 *
 *   effects ──► sfx bus ──────┐
 *   ambience ─► ambience bus ─┼─► master ─► speakers
 *   music ────► music bus ────┘
 *
 * - master: the fixed output level (no setting touches it);
 * - music bus: the music on / off setting (music button, N), and the scene's
 *   music level: full on the title screen and during a shift, dipped while
 *   paused, faded out after a crash;
 * - ambience bus: the sound on / off setting (speaker button, M); the airport
 *   carries on quietly while paused and after a crash; the music button
 *   doesn't touch it (it's the world, not the soundtrack);
 * - sfx bus: the sound on / off setting too; silenced while paused, so held
 *   engines don't drone on.
 *
 * So the two buttons are independent: sound off leaves the music playing,
 * music off leaves the effects and the airport.
 *
 * main.ts feeds it three ways: game state every frame (`update`), the
 * renderer's animation-timed cues (`cue`, see audio/cues.ts), and moments
 * from the sim and input (`onSimEvent`, `readback`). While the camera
 * follows a plane, `setFocus` puts that plane's effects up front.
 *
 * Both settings are remembered in localStorage. Browsers only let a page
 * make sound after a user gesture, so nothing is created until the first
 * `unlock()` (main.ts calls it on every pointer / key press; it's cheap
 * once running).
 */
import type { GameState, SimEvent } from "../core/types";
import { Ambience, type AmbienceLayer } from "./ambience";
import type { AudioCue, PanLookup } from "./cues";
import { Music, type MusicLayer } from "./music";
import { Samples } from "./samples";
import { Sfx } from "./sfx";

/** What the game is showing, for the mix (see `SCENE_LEVELS`). */
export type AudioScene = "title" | "playing" | "paused" | "crash";

/** Overall volume, 0-1. */
const MASTER_VOLUME = 0.7;

/** Music loudness under the effects, 0-1. */
const MUSIC_VOLUME = 0.5;

/** Airport ambience loudness, 0-1. */
const AMBIENCE_VOLUME = 0.8;

/**
 * Per scene: music level (share of `MUSIC_VOLUME`), ambience level (share
 * of `AMBIENCE_VOLUME`) and effects level. Paused, the music and the
 * airport carry on softly while the effects stop; after a crash the music
 * fades out and the airport hushes, until the next shift.
 */
export const SCENE_LEVELS: Record<AudioScene, { music: number; ambience: number; sfx: number }> = {
  title: { music: 1, ambience: 1, sfx: 1 },
  playing: { music: 1, ambience: 1, sfx: 1 },
  paused: { music: 0.4, ambience: 0.4, sfx: 0 },
  crash: { music: 0, ambience: 0.3, sfx: 1 },
};

/** Seconds (time constant) of the fades between scenes and settings. */
const FADE = 0.6;
/** Slower fade for the music dying away after a crash. */
const CRASH_FADE = 1.5;

/** localStorage keys for the two settings. */
const MUTE_KEY = "radar-command.muted";
const MUSIC_KEY = "radar-command.music";

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  sfxBus: GainNode;
  ambienceBus: GainNode;
  musicBus: GainNode;
  /** The recorded sounds (audio/samples.ts), loading from the first unlock. */
  samples: Samples;
  sfx: Sfx;
  ambience: Ambience;
  music: Music;
}

export class GameAudio {
  private graph: Graph | null = null;
  private isMuted: boolean;
  private isMusicOn: boolean;
  private scene: AudioScene = "title";
  /** Page in a background tab: everything suspended (see `setHidden`). */
  private hidden = false;
  /** The followed plane whose effects lead the mix (see `setFocus`). */
  private focus: number | null = null;
  /** 0 day … 1 night, replayed into the graph when it's created. */
  private night = 0;

  constructor(private readonly storage: Storage | null = safeStorage()) {
    this.isMuted = this.storage?.getItem(MUTE_KEY) === "1";
    this.isMusicOn = this.storage?.getItem(MUSIC_KEY) !== "0";
  }

  /** Is all sound off (speaker button / M)? */
  get muted(): boolean {
    return this.isMuted;
  }

  /** Is the background music on (music button / N)? */
  get musicOn(): boolean {
    return this.isMusicOn;
  }

  /** The music engine, once audio has started (for the Storybook story). */
  get music(): Music | null {
    return this.graph?.music ?? null;
  }

  /** The effects, once audio has started (for the Storybook soundboard). */
  get sfx(): Sfx | null {
    return this.graph?.sfx ?? null;
  }

  /** The airport ambience, once audio has started (for the Storybook soundboard). */
  get ambience(): Ambience | null {
    return this.graph?.ambience ?? null;
  }

  /** The recorded sounds, once audio has started (for the Storybook stories). */
  get samples(): Samples | null {
    return this.graph?.samples ?? null;
  }

  /**
   * Effects and airport ambience on or off (remembered across visits). The
   * music has its own setting (`setMusicOn`) and plays on either way.
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.storage?.setItem(MUTE_KEY, muted ? "1" : "0");
    this.applyLevels(FADE);
  }

  /** Background music on or off (remembered across visits). */
  setMusicOn(on: boolean): void {
    this.isMusicOn = on;
    this.storage?.setItem(MUSIC_KEY, on ? "1" : "0");
    this.applyLevels(FADE);
  }

  /** Set the mix for what the game is showing. Cheap to call every frame. */
  setScene(scene: AudioScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    // The PA only speaks during a shift: not on the title screen, paused or after a crash.
    this.graph?.ambience.setPaused(scene !== "playing");
    // A shift that ended (crash, or back to the title) leaves no lines to announce in the next.
    if (scene === "crash" || scene === "title") this.graph?.ambience.clearGameLines();
    this.applyLevels(scene === "crash" ? CRASH_FADE : FADE);
  }

  /**
   * Focus the effects on the plane the camera follows (its sounds up, the
   * other planes' down), or null for none. Cheap to call every frame.
   */
  setFocus(planeId: number | null): void {
    this.focus = planeId;
    this.graph?.sfx.setFocus(planeId);
  }

  /**
   * How dark it is, 0 day … 1 night (render/dayCycle.ts): the music moves
   * to its night loop, the terminal quiets down. Safe before audio starts.
   */
  setNight(n: number): void {
    this.night = n;
    this.graph?.music.setNight(n);
    this.graph?.ambience.setNight(n);
  }

  /**
   * Suspend all sound while the page is hidden (another tab), and resume
   * when it's back. The render loop stops in a hidden tab, so the music's
   * scheduler would run dry anyway; this silences the rest with it.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.graph?.ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend();
    else void ctx.resume();
  }

  /**
   * Create the audio context (or resume it). Call from a user gesture
   * handler: browsers refuse to start audio any other way.
   */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (!this.graph) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      const sfxBus = ctx.createGain();
      sfxBus.connect(master);
      const ambienceBus = ctx.createGain();
      ambienceBus.connect(master);
      const musicBus = ctx.createGain();
      musicBus.connect(master);
      const seed = Date.now() >>> 0;
      // The recordings (~1.5 MB) load in the background; each sound plays
      // from the moment its file has decoded.
      const samples = new Samples(ctx);
      this.graph = {
        ctx,
        master,
        sfxBus,
        ambienceBus,
        musicBus,
        samples,
        sfx: new Sfx(ctx, sfxBus, samples),
        ambience: new Ambience(ctx, ambienceBus, samples, seed ^ 0x5eed),
        music: new Music(ctx, musicBus, seed),
      };
      this.graph.sfx.setFocus(this.focus);
      // It may already be night by the first click.
      this.graph.music.setNight(this.night);
      this.graph.ambience.setNight(this.night);
      this.graph.ambience.setPaused(this.scene !== "playing");
      this.applyLevels(0);
    }
    if (!this.hidden && this.graph.ctx.state === "suspended") void this.graph.ctx.resume();
  }

  /** The tower's chime: a departure has been announced. */
  chime(): void {
    const g = this.graph;
    if (!g) return;
    g.sfx.chime();
    g.ambience.noteChime(); // keep announcements clear of it
  }

  /**
   * React to a sim event with the sound it calls for: the chime when a
   * departure is announced, engines spooling up and the reject buzz for a
   * go-around, and a PA announcement for the ones the terminal would tell
   * passengers about. `pan` places the plane it's about (see
   * `SceneSync.panFor`).
   */
  onSimEvent(event: SimEvent, pan: PanLookup): void {
    switch (event.type) {
      case "departureAnnounced":
        this.chime();
        break;
      case "goAround":
        this.graph?.sfx.goAround(pan(event.planeId), event.planeId);
        this.reject(); // with the red X at the threshold (main.ts)
        break;
      case "windForecast":
        this.graph?.sfx.weatherWarning(event.level);
        break;
      case "windForming":
        this.graph?.sfx.windGust(0.5);
        break;
      case "pathLost":
        this.graph?.sfx.windGust(1);
        break;
      case "blackWindPeak":
        this.graph?.sfx.blackWindRumble();
        break;
      default:
        break;
    }
    // The terminal PA may announce it (a departure, a runway opening).
    // After the chime, so the announcement is timed clear of it.
    this.graph?.ambience.onGameEvent(event);
  }

  /**
   * The "landing rejected" buzz, with the red X: a path let go of on a
   * runway without locking on, or a go-around (see `onSimEvent`).
   */
  reject(): void {
    this.graph?.sfx.reject();
  }

  /** Play a render cue (gear, touchdown, whoosh, warning; see audio/cues.ts). */
  cue(cue: AudioCue): void {
    this.graph?.sfx.cue(cue);
  }

  /**
   * The tower reads back a path the player just drew: a double beep, or a
   * rising two-tone when the path locked onto a runway (`anchored`).
   */
  readback(anchored: boolean): void {
    this.graph?.sfx.readback(anchored);
  }

  /**
   * Once per frame: engines and rollouts follow the planes in `state`
   * (panned by `pan`), and the ambience and music book their next sounds
   * (only while they can be heard).
   */
  update(state: GameState, pan?: PanLookup): void {
    const g = this.graph;
    if (!g) return;
    g.sfx.update(state, pan);
    const levels = SCENE_LEVELS[this.scene];
    // Each scheduler follows only its own setting: sound off stops the
    // ambience booking, but the music keeps going if it's on.
    if (!this.isMuted && levels.ambience > 0) g.ambience.update();
    if (this.isMusicOn && levels.music > 0) g.music.update();
  }

  /** Switch one ambience layer on or off (the "Audio/Effects" story). */
  setAmbienceLayer(layer: AmbienceLayer, on: boolean): void {
    this.graph?.ambience.setLayer(layer, on);
  }

  /** Switch one music layer on or off (the "Audio/Music" story). */
  setMusicLayer(layer: MusicLayer, on: boolean): void {
    this.graph?.music.setLayer(layer, on);
  }

  /** Stop every sound for good (e.g. a Storybook story being torn down). */
  close(): void {
    if (!this.graph) return;
    this.graph.music.dispose();
    this.graph.ambience.dispose();
    void this.graph.ctx.close();
    this.graph = null;
  }

  /** Fade the buses to the levels the settings and scene call for. */
  private applyLevels(fade: number): void {
    const g = this.graph;
    if (!g) return;
    const levels = SCENE_LEVELS[this.scene];
    const now = g.ctx.currentTime;
    const set = (node: GainNode, value: number) =>
      fade > 0
        ? node.gain.setTargetAtTime(value, now, fade / 3)
        : node.gain.setValueAtTime(value, now);
    // Master stays put; each setting silences only its own buses.
    set(g.master, MASTER_VOLUME);
    set(g.musicBus, this.isMusicOn ? MUSIC_VOLUME * levels.music : 0);
    set(g.ambienceBus, this.isMuted ? 0 : AMBIENCE_VOLUME * levels.ambience);
    set(g.sfxBus, this.isMuted ? 0 : levels.sfx);
  }
}

/** localStorage, or null where it's unavailable (private mode, tests). */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
