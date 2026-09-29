/**
 * Rolling score: one digit reel (ui/reel.ts) per digit, like a car's
 * odometer. A new score rolls every reel whose digit changed, each settling
 * with a small bounce; a new leading digit rolls up from 0 like the rest.
 *
 * The reels are decoration (`aria-hidden`); a visually hidden copy of the
 * number is what screen readers get.
 */
import { DIGITS, createReel, mountReel, type Reel } from "./reel";

export interface ScoreRoll {
  /**
   * Show `value` (a whole, non-negative number), rolling the reels whose
   * digit changed. Cheap to call every frame: nothing happens unless the
   * value did.
   */
  set(value: number): void;
}

/**
 * Replace `el`'s contents with rolling digits (reels grown or dropped at
 * the front as the number's length changes), showing 0.
 */
export function createScoreRoll(el: HTMLElement): ScoreRoll {
  const label = document.createElement("span");
  label.className = "sr-only";
  const reelBox = document.createElement("span");
  reelBox.className = "inline-flex";
  el.replaceChildren(label, reelBox);

  /** Most significant digit first, like the text. */
  const reels: Reel[] = [];
  let shown: number | null = null;

  const roll: ScoreRoll = {
    set(value) {
      const v = Math.max(0, Math.floor(value));
      if (v === shown) return;
      shown = v;
      label.textContent = String(v);
      const digits = String(v).split("").map(Number);
      while (reels.length < digits.length) {
        const reel = createReel({ faces: DIGITS });
        mountReel(reel, reelBox, reelBox.firstChild);
        reels.unshift(reel);
      }
      while (reels.length > digits.length) reels.shift()!.root.remove();
      digits.forEach((d, i) => reels[i]!.turnTo(d));
    },
  };
  roll.set(0);
  return roll;
}
