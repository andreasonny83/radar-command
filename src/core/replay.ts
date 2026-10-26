/**
 * Crash replay footage: the last few seconds of the shift, kept so they can
 * be played back once the shift ends in a crash.
 *
 * The sim can't simply be re-run (it draws on `Math.random` and the
 * player's drags), so each frame's planes and wind streams are copied as
 * they were, and the renderer plays those copies back (see
 * `replayView`). Pure data, no DOM or Babylon.
 */
import { REPLAY_SECONDS } from "../config";
import type { GameState, Plane, WindStream } from "./types";

/** One recorded moment of the shift. */
export interface ReplayFrame {
  /** `GameState.elapsed` at this moment. */
  elapsed: number;
  planes: Plane[];
  streams: WindStream[];
}

export class ReplayBuffer {
  private frames: ReplayFrame[] = [];

  /** Copy the current moment in, dropping footage older than `REPLAY_SECONDS`. */
  record(state: GameState): void {
    this.frames.push({
      elapsed: state.elapsed,
      planes: structuredClone(state.planes),
      streams: structuredClone(state.streams),
    });
    const oldest = state.elapsed - REPLAY_SECONDS;
    // Keep one frame at or before the cut so playback starts on a full window.
    let drop = 0;
    while (drop + 1 < this.frames.length && this.frames[drop + 1]!.elapsed <= oldest) drop++;
    if (drop > 0) this.frames.splice(0, drop);
  }

  clear(): void {
    this.frames = [];
  }

  /** Seconds of footage held (0 when empty). */
  get length(): number {
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    return first && last ? last.elapsed - first.elapsed : 0;
  }

  /** `GameState.elapsed` at the start of the footage. */
  get start(): number {
    return this.frames[0]?.elapsed ?? 0;
  }

  /** The latest frame recorded at or before `elapsed`, or null if there is none. */
  at(elapsed: number): ReplayFrame | null {
    // Playback runs forward, so a linear scan from the back is short in practice.
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]!.elapsed <= elapsed) return this.frames[i]!;
    }
    return this.frames[0] ?? null;
  }
}

/**
 * The state the scene should draw for a replay frame: the live state with
 * the frame's planes and streams, and the shift running again (so the
 * survivors get their path lines and rings back).
 */
export function replayView(state: GameState, frame: ReplayFrame): GameState {
  return {
    ...state,
    phase: "playing",
    elapsed: frame.elapsed,
    planes: frame.planes,
    streams: frame.streams,
  };
}
