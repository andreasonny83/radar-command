/**
 * Day/night lighting: moves the scene's lights through the time of day.
 *
 * Each frame `update` reads the clock (core/daytime.ts, from
 * `state.elapsed`), blends the palette (dayTuning.ts) at that hour and
 * applies it to the lights scene.ts built: fill colour and strength, key
 * colour, strength and direction, shadow darkness and the clear colour.
 *
 * The key light is the sun from 05:00 to 21:00 and the moon otherwise. The
 * palette takes the key's intensity to 0 at both hand-overs (the "predawn"
 * and "blueHour" keyframes), so the jump in shadow direction never shows.
 *
 * Night lights (runway glow, windows, headlights…) are not here: SceneSync
 * fans `night` out to them (see `SceneSync.setNight`).
 */
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import {
  clockHours,
  moonArc,
  nightFactor,
  SHIFT_START_HOUR,
  sunArc,
  type SkyArc,
} from "../core/daytime";
import { dayPalette, type DayKeyframe } from "./dayTuning";
import { SUN_DIRECTION, SUN_DISTANCE } from "./scene";

/**
 * The noon sun's bearing and height, from scene.ts's `SUN_DIRECTION`, so
 * the sun at 13:00 shines exactly as it always has.
 */
const NOON_AZIMUTH = Math.atan2(-SUN_DIRECTION.z, -SUN_DIRECTION.x);
const NOON_ELEVATION = Math.asin(-SUN_DIRECTION.y);

/** How far the sun swings either side of its noon bearing, rise to set (radians). */
const AZIMUTH_SWING = 1.25;

/**
 * Lowest key-light elevation (radians, ≈ 25°). Lower, and shadows stretch
 * into long streaks that break the fixed shadow frustum (fitShadowsToWorld).
 */
const MIN_ELEVATION = 0.44;

/** Hours between which the key light is the sun; the moon otherwise. */
const SUN_FROM = 5;
const SUN_UNTIL = 21;

/**
 * How long the catch-up takes when the clock jumps (a new shift started
 * after dark goes back to `SHIFT_START_HOUR`): real seconds, however far
 * it has to go. It always runs forwards, so the night ends in a quick
 * dawn, whatever the start hour.
 */
const CATCH_UP_SECONDS = 1.2;

/** Clock jumps smaller than this (hours) are ordinary frame ticks: no catch-up. */
const JUMP_HOURS = 0.25;

/** The lights a DayCycle drives (all from scene.ts's `createScene`). */
export interface DayCycleLights {
  scene: Scene;
  fill: HemisphericLight;
  key: DirectionalLight;
  shadows: ShadowGenerator;
}

/** A keyframe with its colours parsed once, not every frame. */
interface ParsedKeyframe {
  hour: number;
  clear: Color3;
  fillColor: Color3;
  fillGround: Color3;
  fillIntensity: number;
  keyColor: Color3;
  keyIntensity: number;
  shadowDarkness: number;
}

function parse(k: DayKeyframe): ParsedKeyframe {
  return {
    hour: k.hour,
    clear: Color3.FromHexString(k.clear),
    fillColor: Color3.FromHexString(k.fillColor),
    fillGround: Color3.FromHexString(k.fillGround),
    fillIntensity: k.fillIntensity,
    keyColor: Color3.FromHexString(k.keyColor),
    keyIntensity: k.keyIntensity,
    shadowDarkness: k.shadowDarkness,
  };
}

export class DayCycle {
  /** Time of day shown now (hours, 0 ≤ h < 24), after any catch-up. */
  hours = SHIFT_START_HOUR;
  /** How dark it is: 0 day … 1 night (core/daytime.ts `nightFactor`). */
  night = 0;
  /** Clear colour as "#rrggbb" (main.ts mirrors it onto the page body). */
  clearColor = "";

  /** Parsed copy of the palette, rebuilt when the palette object changes. */
  private source: readonly DayKeyframe[] | null = null;
  private frames: ParsedKeyframe[] = [];
  private readonly clear = new Color3();
  /** Game hours per real second while catching up (0 = not catching up). */
  private catchUpRate = 0;

  constructor(private readonly lights: DayCycleLights) {
    this.apply();
  }

  /**
   * Follow the shift clock. `dt` is real frame time: a jump in the clock
   * (new shift after dark) is caught up forwards over `CATCH_UP_SECONDS`,
   * so e.g. 23:00 → 12:00 plays a quick night and dawn instead of snapping
   * (or running the evening backwards).
   */
  update(elapsed: number, dt: number): void {
    const target = clockHours(elapsed);
    // How far ahead the target is, going forwards round the clock.
    const ahead = (((target - this.hours) % 24) + 24) % 24;
    if (ahead <= JUMP_HOURS || 24 - ahead <= JUMP_HOURS) {
      // Ordinary tick (or a hair behind): just follow.
      this.hours = target;
      this.catchUpRate = 0;
    } else {
      // A jump: fix the speed from the distance when it starts, so the
      // catch-up always takes the same time.
      if (this.catchUpRate === 0) this.catchUpRate = ahead / CATCH_UP_SECONDS;
      const step = Math.min(ahead, this.catchUpRate * dt);
      this.hours = (this.hours + step) % 24;
    }
    this.apply();
  }

  /** Jump straight to `hours` (tuning story). */
  setHours(hours: number): void {
    this.hours = ((hours % 24) + 24) % 24;
    this.apply();
  }

  /** Light the scene for `this.hours`. */
  private apply(): void {
    const { scene, fill, key, shadows } = this.lights;
    const h = this.hours;
    this.night = nightFactor(h);

    // Neighbouring keyframes and how far between them we are.
    const frames = this.parsed();
    let prev = frames[frames.length - 1]!;
    let next = frames[0]!;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i]!.hour <= h) {
        prev = frames[i]!;
        next = frames[(i + 1) % frames.length]!;
      }
    }
    const span = (next.hour - prev.hour + 24) % 24 || 24;
    const t = ((h - prev.hour + 24) % 24) / span;
    const mix = (a: number, b: number) => a + (b - a) * t;

    Color3.LerpToRef(prev.clear, next.clear, t, this.clear);
    scene.clearColor.set(this.clear.r, this.clear.g, this.clear.b, 1);
    this.clearColor = this.clear.toHexString();
    Color3.LerpToRef(prev.fillColor, next.fillColor, t, fill.diffuse);
    Color3.LerpToRef(prev.fillGround, next.fillGround, t, fill.groundColor);
    fill.intensity = mix(prev.fillIntensity, next.fillIntensity);
    Color3.LerpToRef(prev.keyColor, next.keyColor, t, key.diffuse);
    key.intensity = mix(prev.keyIntensity, next.keyIntensity);
    shadows.darkness = mix(prev.shadowDarkness, next.shadowDarkness);

    // Key direction: along the sun's (or moon's) arc, never lower than
    // MIN_ELEVATION. The light sits back along its ray, like scene.ts.
    const arc: SkyArc = h >= SUN_FROM && h < SUN_UNTIL ? sunArc(h) : moonArc(h);
    const elevation = Math.max(MIN_ELEVATION, NOON_ELEVATION * arc.height);
    const azimuth = NOON_AZIMUTH + arc.sweep * AZIMUTH_SWING;
    const c = Math.cos(elevation);
    key.direction.set(-c * Math.cos(azimuth), -Math.sin(elevation), -c * Math.sin(azimuth));
    key.direction.scaleToRef(-SUN_DISTANCE, key.position);
  }

  private parsed(): ParsedKeyframe[] {
    const palette = dayPalette();
    if (palette !== this.source) {
      this.source = palette;
      this.frames = [...palette].sort((a, b) => a.hour - b.hour).map(parse);
    }
    return this.frames;
  }
}
