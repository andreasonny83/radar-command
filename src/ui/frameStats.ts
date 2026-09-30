/**
 * Rolling frame-time statistics for the "stats for nerds" panel (ui/stats.ts).
 *
 * Pure (no DOM, no Babylon): feed it each frame's duration with `push`, read
 * the smoothed frame rate and the 1% low with `snapshot`. The panel calls
 * `snapshot` a few times a second, so the sort it does never runs per frame.
 */

/** Frames older than this (ms of frame time) fall out of the window. */
const WINDOW_MS = 5000;

/** The smoothed FPS and frame time average this much of the newest frames (ms). */
const SMOOTH_MS = 500;

/** The "low" figure is the average of this slowest fraction of the window. */
const LOW_FRACTION = 0.01;

/** Ring size: 5 s at 240 fps is 1200 frames; past that the oldest are overwritten. */
const CAPACITY = 1600;

export interface FrameSnapshot {
  /** Frames per second, averaged over the last `SMOOTH_MS`. */
  fps: number;
  /** Average frame time over the same span (ms). */
  frameMs: number;
  /** Frames per second of the slowest 1% of frames in the last `WINDOW_MS`. */
  low: number;
}

export class FrameStats {
  private readonly frames = new Float64Array(CAPACITY);
  /** Index of the next slot to write; the newest frame is at `head - 1`. */
  private head = 0;
  private count = 0;
  /** Sum of the frame times in the window (ms). */
  private total = 0;

  /** Record one frame's duration (ms). */
  push(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    if (this.count === CAPACITY) this.total -= this.frames[this.head] ?? 0;
    else this.count++;
    this.frames[this.head] = ms;
    this.head = (this.head + 1) % CAPACITY;
    this.total += ms;
    // Trim by time, always keeping the newest frame.
    while (this.count > 1 && this.total > WINDOW_MS) {
      this.total -= this.at(this.count - 1);
      this.count--;
    }
  }

  /** Forget everything (when the panel opens, so stale frames don't show). */
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.total = 0;
  }

  /** `null` until a frame has been recorded. */
  snapshot(): FrameSnapshot | null {
    if (this.count === 0) return null;

    // Newest frames first, until SMOOTH_MS of frame time is covered.
    let span = 0;
    let n = 0;
    while (n < this.count && span < SMOOTH_MS) span += this.at(n++);
    const frameMs = span / n;

    // Mean of the slowest 1% (at least one frame) of the window.
    const times = Array.from({ length: this.count }, (_, i) => this.at(i)).sort((a, b) => b - a);
    const worst = Math.max(1, Math.round(times.length * LOW_FRACTION));
    let sum = 0;
    for (let i = 0; i < worst; i++) sum += times[i] ?? 0;

    return { fps: 1000 / frameMs, frameMs, low: 1000 / (sum / worst) };
  }

  /** The `age`-th newest frame (0 = newest). */
  private at(age: number): number {
    return this.frames[(this.head - 1 - age + CAPACITY * 2) % CAPACITY] ?? 0;
  }
}
