/**
 * HUD screens: the real `createHud` driven into each game phase.
 *
 * These stories mount the same module the game uses, so what you see here is
 * what ships. Buttons log their callbacks to the Actions panel instead of
 * driving a game. Tweak classes in hudMarkup.ts, the glow/button/arrow/key
 * cap/link styles in style.css, the shortcut table in input/shortcuts.ts,
 * `TOAST_MS` in hud.ts, `AVOID_RADIUS` in arrivalArrows.ts or the GitHub /
 * feedback URLs in links.ts, and the story hot-reloads.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { COLOR_HEX } from "../config";
import type { GamePhase, PlaneColor, RunwayColor } from "../core/types";
import { createHud, type Hud, type HudCallbacks } from "./hud";

interface HudArgs extends HudCallbacks {
  phase: GamePhase;
  score: number;
  /** Toast text; empty = no toast. */
  toast: string;
  /**
   * Colour to tint the toast with (a runway's, or violet for departure
   * notices), or "none" for the default white.
   */
  toastColor: PlaneColor | "none";
  /** Show the sound button muted (🔇), as after pressing it or M. */
  muted: boolean;
  /** Show sample arrival arrows round the screen edge. */
  arrivals: boolean;
  /** Show the "track plane active" badge, as while following a plane. */
  tracking: boolean;
  /** Open the help panel (the "?" button, or H / ? in the game). */
  help: boolean;
}

/**
 * Sample arrival arrows, one per edge, as fractions of the screen. The
 * top-left and bottom-right ones land under the score panel and camera
 * buttons, so they show arrows sliding out from under the HUD.
 */
const SAMPLE_ARRIVALS: ReadonlyArray<{ color: RunwayColor; fx: number; fy: number; deg: number }> =
  [
    { color: "red", fx: 0.04, fy: 0, deg: 70 },
    { color: "blue", fx: 0.55, fy: 0, deg: 100 },
    { color: "yellow", fx: 1, fy: 0.45, deg: 170 },
    { color: "blue", fx: 0, fy: 0.6, deg: -10 },
    { color: "red", fx: 0.95, fy: 1, deg: -120 },
  ];

/** Arrow inset from the screen edge, matching render/arrivals.ts EDGE_INSET. */
const ARROW_INSET = 34;

/** Full-window stage matching the game's `<body>`. */
function stage(): HTMLElement {
  const el = document.createElement("div");
  el.className = "relative h-full w-full overflow-hidden text-slate-100";
  return el;
}

/** Put a freshly mounted HUD into the state described by `args`. */
function applyArgs(hud: Hud, args: HudArgs): void {
  hud.setScore(args.score);
  if (args.phase === "gameover") hud.showGameOver(args.score);
  else if (args.phase !== "start") hud.hideOverlay();
  hud.setPhase(args.phase);
  hud.setTracking(args.tracking);
  hud.setMuted(args.muted);
  hud.setHelpOpen(args.help);
  if (args.toast) {
    hud.showToast(args.toast, args.toastColor === "none" ? undefined : COLOR_HEX[args.toastColor]);
  }
}

/** Place the sample arrows once `root` is on the page and has a size. */
function showSampleArrivals(hud: Hud, root: HTMLElement): void {
  requestAnimationFrame(() => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const pin = (v: number, max: number) => Math.min(max - ARROW_INSET, Math.max(ARROW_INSET, v));
    hud.setArrivals(
      SAMPLE_ARRIVALS.map((a, i) => ({
        id: i,
        color: COLOR_HEX[a.color],
        x: pin(a.fx * w, w),
        y: pin(a.fy * h, h),
        angle: (a.deg * Math.PI) / 180,
      })),
    );
  });
}

const meta: Meta<HudArgs> = {
  title: "HUD/Screens",
  render: (args) => {
    const root = stage();
    const hud = createHud(root, args);
    applyArgs(hud, args);
    if (args.arrivals) showSampleArrivals(hud, root);
    return root;
  },
  argTypes: {
    phase: { control: "inline-radio", options: ["start", "playing", "paused", "gameover"] },
    score: { control: { type: "number", min: 0, step: 1 } },
    toastColor: {
      control: "inline-radio",
      options: ["none", "red", "blue", "yellow", "violet"],
    },
    // Callbacks are wired to the Actions panel; no control needed.
    onStart: { table: { disable: true } },
    onTogglePause: { table: { disable: true } },
    onRotate: { table: { disable: true } },
    onZoom: { table: { disable: true } },
    onToggleSound: { table: { disable: true } },
    onHelp: { table: { disable: true } },
  },
  args: {
    phase: "start",
    score: 0,
    toast: "",
    toastColor: "none",
    arrivals: false,
    tracking: false,
    muted: false,
    help: false,
    onStart: fn(),
    onTogglePause: fn(),
    onRotate: fn(),
    onZoom: fn(),
    onToggleSound: fn(),
    onHelp: fn(),
  },
};
export default meta;

type Story = StoryObj<HudArgs>;

/** Title screen shown on load. */
export const StartScreen: Story = {};

/** Mid-shift: score, pause button and camera controls. */
export const Playing: Story = { args: { phase: "playing", score: 12 } };

/**
 * Arrival arrows on the screen edge, as planes are about to fly in. Arrows
 * that would sit under the score panel or camera buttons slide clear of them
 * (`data-arrow-avoid` in hudMarkup.ts).
 */
export const Arrivals: Story = { args: { phase: "playing", score: 8, arrivals: true } };

/**
 * Following a plane (right-click one in the game): the "track plane active"
 * badge bottom-left, with its blinking dot. Arrival arrows slide clear of it.
 */
export const Tracking: Story = {
  args: { phase: "playing", score: 5, arrivals: true, tracking: true },
};

/** Paused banner over the (frozen) game. */
export const Paused: Story = { args: { phase: "paused", score: 12 } };

/**
 * A runway-unlock toast. It fades after `TOAST_MS` (hud.ts); change any arg
 * to replay it.
 */
export const Toast: Story = {
  args: { phase: "playing", score: 3, toast: "BLUE runway open", toastColor: "blue" },
};

/**
 * A departure's notice (core/departures.ts, wording in ui/eventToasts.ts):
 * violet like the plane, naming the runway it takes off from.
 */
export const DepartureToast: Story = {
  args: { phase: "playing", score: 6, toast: "Departure — RED runway", toastColor: "violet" },
};

/** Sound off: the sound button (bottom-right, or M) shows 🔇. */
export const Muted: Story = { args: { phase: "playing", score: 5, muted: true } };

/**
 * Crash overlay with the final score. See-through (CRASH_BACKDROP in hud.ts)
 * so the crash cinematic stays visible above it: see Scene/Gameplay/Crash.
 */
export const GameOver: Story = { args: { phase: "gameover", score: 27 } };

/**
 * Help panel over a running shift: how to play, mouse/touch controls and
 * every keyboard shortcut, generated from input/shortcuts.ts. In the game
 * the "?" button (top-right, on every screen) or H / ? opens it and pauses
 * the shift; ✕, the backdrop, H, ? or Esc close it and continue.
 */
export const Help: Story = { args: { phase: "playing", score: 9, help: true } };

/** Help opened from the title screen: the "?" button sits above the overlay. */
export const HelpFromStart: Story = { args: { phase: "start", help: true } };
