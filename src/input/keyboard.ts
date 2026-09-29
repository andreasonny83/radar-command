/**
 * Keyboard pan input: tracks which arrow / WASD keys are held and exposes
 * them as a screen-space direction the camera turns into ground movement
 * each frame. (One-shot shortcuts live in input/shortcuts.ts.)
 *
 * Polling held keys (rather than moving on each `keydown`) gives smooth,
 * frame-rate independent panning: the OS key-repeat rate never matters.
 */
import type { Vec2 } from "../core/types";
import { isTyping } from "./shortcuts";

/**
 * Pan key → screen direction (+x right, +y up the screen). Letters are
 * lower case: `keyName` folds Shift / Caps Lock away.
 */
const PAN_DIRECTIONS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  w: { x: 0, y: 1 },
  s: { x: 0, y: -1 },
};

/** `e.key`, with single characters lower-cased ("W" and "w" are one key). */
const keyName = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

export interface PanKeys {
  /** Current pan direction: each axis in [-1, 1], normalised on diagonals. */
  direction(): Vec2;
}

export function attachPanKeys(target: Window = window): PanKeys {
  const held = new Set<string>();

  target.addEventListener("keydown", (e) => {
    const key = keyName(e);
    // Ctrl/Cmd+A, Ctrl+S… are browser shortcuts, not pans.
    // Letters typed into a text field (the leaderboard name) aren't pans either.
    if (!(key in PAN_DIRECTIONS) || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    // Arrows would otherwise scroll the page (or a focused HUD element).
    e.preventDefault();
    held.add(key);
  });
  target.addEventListener("keyup", (e) => held.delete(keyName(e)));
  // Keyups that happen while the window is unfocused never arrive, so drop
  // everything on blur or the camera would keep drifting on return.
  target.addEventListener("blur", () => held.clear());

  return {
    direction() {
      let x = 0;
      let y = 0;
      for (const key of held) {
        const d = PAN_DIRECTIONS[key];
        if (!d) continue;
        x += d.x;
        y += d.y;
      }
      // Diagonals would otherwise be √2 faster than a single arrow.
      const len = Math.hypot(x, y);
      return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
    },
  };
}
