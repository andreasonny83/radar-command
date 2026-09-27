/**
 * Keyboard shortcuts: one table that both drives the key handler and fills
 * the in-game help panel (ui/hudMarkup.ts `helpPanelMarkup`), so a key can
 * never work without being documented, or be documented without working.
 *
 * Map panning is the exception: held keys are polled every frame for smooth
 * movement (see input/keyboard.ts), so the table only *describes* them.
 *
 * This module is DOM-only (no Babylon), so Storybook's HUD stories can
 * import the table without pulling in the renderer.
 */

/** Everything a shortcut can trigger. main.ts supplies one handler each. */
export type ShortcutAction =
  | "start"
  | "togglePause"
  | "toggleHelp"
  | "toggleSound"
  | "rotateLeft"
  | "rotateRight"
  | "zoomIn"
  | "zoomOut"
  | "followNext"
  | "followPrevious"
  | "stopFollow";

export interface Shortcut {
  /** What it does; `null` for describe-only rows (panning). */
  action: ShortcutAction | null;
  /**
   * `KeyboardEvent.key` values that trigger it. Letters are listed lower
   * case and matched case-insensitively (Shift or Caps Lock don't matter,
   * unless `shift` says otherwise).
   */
  keys: readonly string[];
  /**
   * Must Shift be held (true) or not held (false)? Omitted = either. Lets
   * F and Shift+F be two different shortcuts, while "?" (Shift+/ on most
   * layouts) still works.
   */
  shift?: boolean;
  /** Fire again on OS key-repeat while held (zoom, rotate). */
  repeat?: boolean;
  /** Key caps shown in the help panel; each entry is one alternative. */
  caps: readonly string[];
  /** One-line explanation for the help panel. */
  description: string;
}

/** Help panel sections, in display order. */
export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Game",
    shortcuts: [
      {
        action: "start",
        keys: ["Enter", " "],
        caps: ["Enter", "Space"],
        description: "Start a shift / try again",
      },
      {
        action: "togglePause",
        keys: ["p", "Escape", " "],
        caps: ["P", "Esc", "Space"],
        description: "Pause / continue",
      },
      {
        action: "toggleHelp",
        keys: ["h", "?"],
        caps: ["H", "?"],
        description: "Show / hide this help (Esc closes it)",
      },
      {
        action: "toggleSound",
        keys: ["m"],
        caps: ["M"],
        description: "Sound on / off",
      },
    ],
  },
  {
    title: "Camera",
    shortcuts: [
      {
        action: null,
        keys: [],
        caps: ["↑ ↓ ← →", "W A S D"],
        description: "Pan the map (hold)",
      },
      {
        action: "rotateLeft",
        keys: ["q"],
        repeat: true,
        caps: ["Q"],
        description: "Rotate view left",
      },
      {
        action: "rotateRight",
        keys: ["e"],
        repeat: true,
        caps: ["E"],
        description: "Rotate view right",
      },
      {
        action: "zoomIn",
        keys: ["+", "="],
        repeat: true,
        caps: ["+"],
        description: "Zoom in",
      },
      {
        action: "zoomOut",
        keys: ["-", "_"],
        repeat: true,
        caps: ["−"],
        description: "Zoom out",
      },
    ],
  },
  {
    title: "Track plane",
    shortcuts: [
      {
        action: "followNext",
        keys: ["f"],
        shift: false,
        caps: ["F"],
        description: "Follow the next plane (press again to cycle)",
      },
      {
        action: "followPrevious",
        keys: ["f"],
        shift: true,
        caps: ["Shift + F"],
        description: "Follow the previous plane",
      },
      {
        action: "stopFollow",
        keys: ["x"],
        caps: ["X"],
        description: "Stop following, back to the map",
      },
    ],
  },
];

/**
 * Mouse and touch controls, for the help panel only (pointer input lives in
 * input/pointer.ts and render/camera.ts).
 */
export const POINTER_CONTROLS: ReadonlyArray<{ input: string; description: string }> = [
  { input: "Drag from a plane", description: "Draw its flight path" },
  { input: "Drag empty ground", description: "Pan the map" },
  { input: "Mouse wheel", description: "Zoom in / out" },
  { input: "Right-click a plane", description: "Follow it with the camera" },
  { input: "Right-click again", description: "Back to the view from before" },
];

const ALL_SHORTCUTS: readonly Shortcut[] = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts);

/**
 * Short key hint for a button tooltip, e.g. "P / Esc / Space", taken from
 * the table so tooltips stay in sync with the real keys.
 */
export function shortcutHint(action: ShortcutAction): string {
  const shortcut = ALL_SHORTCUTS.find((s) => s.action === action);
  return shortcut ? shortcut.caps.join(" / ") : "";
}

/** Does `e` press `shortcut`? */
function matches(shortcut: Shortcut, e: KeyboardEvent): boolean {
  if (shortcut.shift !== undefined && shortcut.shift !== e.shiftKey) return false;
  // Single characters compare case-insensitively ("F" with Shift held);
  // named keys ("Enter", "Escape") are matched exactly.
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return shortcut.keys.includes(key);
}

export interface ShortcutOptions {
  /**
   * True while the help panel is open: then only closing it (help keys or
   * Esc) does anything, so a stray key can't change the game behind it.
   */
  helpOpen: () => boolean;
}

/**
 * Runs a shortcut. Return `false` when the press doesn't apply right now
 * (e.g. "start" mid-shift), to let the next shortcut on the same key try.
 */
export type ShortcutHandler = () => boolean | void;

/**
 * Listen for shortcut keys on `target` and call the matching handler.
 *
 * A key may belong to several shortcuts (Space: start on the title screen,
 * pause mid-shift). They're tried in table order and the first handler that
 * doesn't return `false` wins, so one press never does two things (start
 * a shift *and* pause it straight away).
 */
export function attachShortcuts(
  handlers: Record<ShortcutAction, ShortcutHandler>,
  options: ShortcutOptions,
  target: Window = window,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // Leave browser/OS shortcuts (Cmd+R, Ctrl+−, Alt+Tab…) alone.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Enter on a focused link (GitHub / feedback) follows it rather than
    // starting a shift.
    if (e.key === "Enter" && e.target instanceof HTMLAnchorElement) return;

    if (options.helpOpen()) {
      const help = ALL_SHORTCUTS.find((s) => s.action === "toggleHelp");
      if (e.key === "Escape" || (help && matches(help, e))) {
        if (!e.repeat) handlers.toggleHelp();
        e.preventDefault();
      }
      return;
    }

    let handled = false;
    for (const shortcut of ALL_SHORTCUTS) {
      if (!shortcut.action || !matches(shortcut, e)) continue;
      handled = true;
      if (e.repeat && !shortcut.repeat) continue;
      if (handlers[shortcut.action]() !== false) break;
    }
    // Stop the default action too: Space/Enter would otherwise also "click"
    // a focused HUD button (a second start or pause), and +/− could zoom
    // the page on some browsers.
    if (handled) e.preventDefault();
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
