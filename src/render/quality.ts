/**
 * Render quality for phones and tablets.
 *
 * A phone's screen is small but dense: at 3x pixel density the canvas has nine
 * times as many pixels as CSS pixels, and the GPU has to shade every one of
 * them (plus 4x anti-aliasing and a 4096 px shadow map). That is far more
 * than the game needs to look sharp, and more than a mobile GPU can hold at
 * 60 fps. Two tools, both keeping the picture crisp enough to read planes
 * and paths:
 *
 * - `qualityProfile`: sensible starting settings for the device class, a
 *   cap on the pixel density, no MSAA at high density, and a smaller
 *   shadow map on touch devices.
 * - `RenderScaler`: watches the frame time while playing and trades
 *   resolution for speed as needed. It steps down when frames are slow, and
 *   cautiously back up when there is headroom, remembering what it learned
 *   so it doesn't oscillate.
 *
 * Input is unaffected by the render scale: Babylon's picking ray divides by
 * the hardware scaling level, and the pointer code works in CSS pixels.
 */

/** Starting render settings for a device. */
export interface QualityProfile {
  /** Most render pixels per CSS pixel (the cap on devicePixelRatio). */
  maxScale: number;
  /** Anti-aliasing: worth its cost at low pixel density only. */
  antialias: boolean;
  /** Shadow map size (px, power of two). */
  shadowMapSize: number;
  /** Is this a touch-first device (phone or tablet)? */
  touch: boolean;
}

/**
 * Is the primary input a finger? (`pointer: coarse`.) A touch laptop with a
 * mouse or trackpad still reports `fine`, which is what we want: it keeps
 * full quality.
 */
export function isTouchDevice(
  matchMedia: (query: string) => { matches: boolean } = window.matchMedia.bind(window),
): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

/** Highest pixel density we render at on touch devices. */
export const TOUCH_MAX_SCALE = 2;
/** Shadow map size on touch devices: half the width and height of the desktop one, a quarter the fill cost. */
export const TOUCH_SHADOW_MAP = 2048;
export const DESKTOP_SHADOW_MAP = 4096;

/**
 * Settings for a screen of `pixelRatio` (devicePixelRatio). Desktops keep
 * what the game always did: render at the native density, with 4x MSAA and
 * the big shadow map. Touch devices cap the density at `TOUCH_MAX_SCALE`
 * and halve the shadow map; at density 2 or more the pixels are small
 * enough that anti-aliasing no longer earns its cost.
 */
export function qualityProfile(pixelRatio: number, touch: boolean): QualityProfile {
  const ratio = Math.max(1, pixelRatio || 1);
  if (!touch) {
    return { maxScale: ratio, antialias: true, shadowMapSize: DESKTOP_SHADOW_MAP, touch };
  }
  const maxScale = Math.min(ratio, TOUCH_MAX_SCALE);
  return { maxScale, antialias: maxScale < 2, shadowMapSize: TOUCH_SHADOW_MAP, touch };
}

/** The slice of Babylon's `Engine` the scaler needs (so it can be tested without WebGL). */
export interface ScalableEngine {
  getHardwareScalingLevel(): number;
  setHardwareScalingLevel(level: number): void;
}

/** Tuning for `RenderScaler`. */
export interface ScalerOptions {
  /** Highest render scale (pixels per CSS pixel) it may use: the profile's `maxScale`. */
  max: number;
  /** Lowest it may drop to. Below 1 the picture goes soft, so it stops here by default. */
  min?: number;
  /** Change by this much per step. */
  step?: number;
  /** Frames averaged per decision. */
  window?: number;
  /** Above this average frame time (ms) the scale steps down (slower than ~45 fps). */
  slowMs?: number;
  /** At or below this (ms) the frame rate is holding (about 60 fps with a little slack). */
  fastMs?: number;
  /** Fast windows in a row needed before trying a higher scale. */
  patience?: number;
}

/**
 * Adaptive resolution. Feed it every frame's duration (`update`); it changes
 * the engine's hardware scaling level when the average over `window` frames
 * says the GPU is struggling, or comfortably keeping up.
 *
 * - Slow window: one step down (fewer pixels), at once.
 * - `patience` fast windows in a row: one step up, to test whether the
 *   headroom is real. If that step makes frames slow again, it goes back
 *   down and the failed scale becomes a ceiling, so it doesn't bounce
 *   between the two forever.
 * Frames longer than `ignoreMs` (a tab switch, a GC pause, the shift
 * loading) are discarded rather than counted as the GPU being slow.
 */
export class RenderScaler {
  private readonly min: number;
  private readonly max: number;
  private readonly step: number;
  private readonly size: number;
  private readonly slowMs: number;
  private readonly fastMs: number;
  private readonly patience: number;
  /** Highest scale it will try: lowered when a step up turned out too much. */
  private ceiling: number;
  /** Did the last change step up (so a slow window right after it is its fault)? */
  private justSteppedUp = false;
  private fastWindows = 0;
  private sum = 0;
  private count = 0;
  /** Frame times beyond this are not the GPU's doing. */
  static readonly ignoreMs = 100;

  constructor(
    private readonly engine: ScalableEngine,
    options: ScalerOptions,
  ) {
    this.max = options.max;
    this.min = Math.min(options.min ?? 1, this.max);
    this.step = options.step ?? 0.25;
    this.size = options.window ?? 90;
    this.slowMs = options.slowMs ?? 22;
    this.fastMs = options.fastMs ?? 17.5;
    this.patience = options.patience ?? 3;
    this.ceiling = this.max;
  }

  /** The render scale now: render pixels per CSS pixel. */
  get scale(): number {
    return 1 / this.engine.getHardwareScalingLevel();
  }

  /**
   * One frame took `frameMs`. Pass `active = false` while nothing is moving
   * (title screen, paused): those frames say nothing about the real load and
   * are skipped.
   */
  update(frameMs: number, active = true): void {
    if (!active || !(frameMs > 0) || frameMs > RenderScaler.ignoreMs) return;
    this.sum += frameMs;
    if (++this.count < this.size) return;
    const average = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    this.decide(average);
  }

  private decide(average: number): void {
    const now = this.scale;
    if (average > this.slowMs) {
      this.fastWindows = 0;
      if (this.justSteppedUp) {
        // The step up we just tried is more than this GPU can do: back off
        // and don't try that scale again.
        this.ceiling = Math.max(this.min, now - this.step);
      }
      this.justSteppedUp = false;
      this.set(now - this.step);
      return;
    }
    this.justSteppedUp = false;
    if (average <= this.fastMs && now < this.ceiling) {
      if (++this.fastWindows >= this.patience) {
        this.fastWindows = 0;
        this.justSteppedUp = true;
        this.set(Math.min(this.ceiling, now + this.step));
      }
    } else {
      this.fastWindows = 0;
    }
  }

  private set(scale: number): void {
    const next = Math.min(this.max, Math.max(this.min, scale));
    if (Math.abs(next - this.scale) < 1e-6) return;
    this.engine.setHardwareScalingLevel(1 / next);
  }
}
