/**
 * The red "no landing" mark, a red ring with an X inside: the twin of the
 * green anchor ring (same size and stroke, see `createRejectMark` in
 * meshes.ts). It shows where a landing won't happen:
 * - a path let go of on a runway without locking on (wrong end, a turn too
 *   tight to fly, another colour's runway, or a runway a departure has
 *   closed; see core/path.ts `rejectedLanding`);
 * - a runway threshold where a plane on a locked approach had to go around.
 *
 * Each mark pops in with a small overshoot (`REJECT_POP`), holds for
 * `REJECT_HOLD` seconds, then fades out over `REJECT_FADE`. Several can
 * show at once (two planes refused in quick succession); meshes are pooled
 * and reused once faded.
 *
 * A held mark (`setHeld`) is the fixed X on a closed runway's landing
 * point: it pops in, then stays until released, when it fades out like any
 * other.
 */
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { lerp } from "../core/math";
import type { Vec2, WorldSize } from "../core/types";
import { toScene } from "./coords";
import type { MeshFactory } from "./meshes";

/** Seconds the X takes to pop in, overshooting to `REJECT_POP_SCALE`. */
export const REJECT_POP = 0.18;
/** Peak size of the pop-in, relative to the X's resting size. */
export const REJECT_POP_SCALE = 1.3;
/** Seconds the X stays fully visible after popping in. */
export const REJECT_HOLD = 0.9;
/** Seconds it takes to fade out after the hold. */
export const REJECT_FADE = 0.6;
/** Height of the mark: on the ground, just over the runway paint (like the anchor ring). */
const REJECT_ALTITUDE = 0.25;

interface Mark {
  mesh: Mesh;
  /** The ring and its child (the X), to fade together. */
  parts: Mesh[];
  /** Seconds since shown, or null while free in the pool. */
  age: number | null;
  /** Set while the mark is held in place (see `setHeld`): it doesn't fade. */
  key?: string;
}

export class RejectMarks {
  private readonly marks: Mark[] = [];

  constructor(private readonly factory: MeshFactory) {}

  /**
   * Show a mark at `at` (sim coordinates), from the start of its pop-in.
   * With a `key` it is held in place instead of fading (see `setHeld`).
   */
  show(at: Vec2, world: WorldSize, key?: string): void {
    let mark = this.marks.find((m) => m.age === null);
    if (!mark) {
      const mesh = this.factory.createRejectMark(`reject-${this.marks.length}`);
      mark = { mesh, parts: [mesh, ...mesh.getChildMeshes<Mesh>()], age: null };
      this.marks.push(mark);
    }
    mark.age = 0;
    mark.key = key;
    toScene(at, world, REJECT_ALTITUDE, mark.mesh.position);
    this.pose(mark);
    mark.mesh.setEnabled(true);
  }

  /**
   * Keep a fixed mark on each of `held` (key → sim position): new keys pop
   * in and stay, keys no longer listed fade out. Call every frame with the
   * full set.
   */
  setHeld(held: ReadonlyMap<string, Vec2>, world: WorldSize): void {
    for (const mark of this.marks) {
      if (mark.key !== undefined && !held.has(mark.key)) mark.key = undefined;
    }
    for (const [key, at] of held) {
      if (this.marks.some((m) => m.key === key)) continue;
      this.show(at, world, key);
    }
  }

  /** Advance every visible mark by `dt` seconds (0 while paused: they freeze). */
  update(dt: number): void {
    for (const mark of this.marks) {
      if (mark.age === null) continue;
      mark.age += dt;
      // Held: stays fully visible, however long it has been up.
      if (mark.key !== undefined) mark.age = Math.min(mark.age, REJECT_POP + REJECT_HOLD);
      if (mark.age >= REJECT_POP + REJECT_HOLD + REJECT_FADE) {
        mark.age = null;
        mark.mesh.setEnabled(false);
        continue;
      }
      this.pose(mark);
    }
  }

  /** Hide every mark at once (e.g. a new shift). */
  clear(): void {
    for (const mark of this.marks) {
      mark.age = null;
      mark.key = undefined;
      mark.mesh.setEnabled(false);
    }
  }

  dispose(): void {
    for (const mark of this.marks) mark.mesh.dispose(false, false);
    this.marks.length = 0;
  }

  /** Size and opacity for the mark's age: pop in, hold, fade out. */
  private pose(mark: Mark): void {
    const age = mark.age ?? 0;
    let scale: number;
    if (age < REJECT_POP) {
      // Up to the overshoot (ease out), then half the pop settling back.
      const t = age / REJECT_POP;
      scale =
        t < 0.6 ? REJECT_POP_SCALE * easeOut(t / 0.6) : lerp(REJECT_POP_SCALE, 1, (t - 0.6) / 0.4);
    } else {
      scale = 1;
    }
    const fadeT = Math.max(0, age - REJECT_POP - REJECT_HOLD) / REJECT_FADE;
    // Ease out (quadratic), like the anchor ring: dims quickly, then lingers.
    const alpha = (1 - Math.min(1, fadeT)) ** 2;
    mark.mesh.scaling.set(scale, 1, scale);
    for (const part of mark.parts) part.visibility = alpha;
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
