/**
 * HUD screens: the real `createHud` driven into each game phase.
 *
 * These stories mount the same module the game uses, so what you see here is
 * what ships. Buttons log their callbacks to the Actions panel instead of
 * driving a game. Tweak classes in hudMarkup.ts, the glow/button/arrow/key
 * cap/link styles in style.css, the shortcut table in input/shortcuts.ts,
 * `TOAST_MS` in hud.ts, `AVOID_RADIUS` in arrivalArrows.ts or the GitHub /
 * feedback URLs in links.ts, and the story hot-reloads. The leaderboard
 * panel and game-over form have their own stories (HUD/Leaderboard).
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { COLOR_HEX, GAME_SPEEDS } from "../config";
import { nightFactor } from "../core/daytime";
import type { GamePhase, PlaneColor, RunwayColor, WarningLevel } from "../core/types";
import { createHud, type Hud, type HudCallbacks } from "./hud";
import { windAlert } from "./weatherAlerts";

interface HudArgs extends HudCallbacks {
  phase: GamePhase;
  /** Planes landed (the score is built from these three; see core/scoring.ts). */
  landed: number;
  /** Departures flown out. */
  departed: number;
  /** Seconds flown since the second runway opened (1 point per SECONDS_PER_TIME_POINT). */
  seconds: number;
  /** Toast text; empty = no toast. */
  toast: string;
  /**
   * Colour to tint the toast with (a runway's, or violet for departure
   * notices), or "none" for the default white.
   */
  toastColor: PlaneColor | "none";
  /** Show the weather warning strip with a wind warning at this level (ui/weatherAlerts.ts), or none. */
  weather: WarningLevel | "none";
  /** Show the sound button muted (dimmed, struck through), as after pressing it or M. */
  muted: boolean;
  /** Show the music button on (lit) or off (dimmed), as after pressing it or N. */
  musicOn: boolean;
  /** Show the full screen button as "leave full screen", as while in full screen (Z). */
  fullscreen: boolean;
  /** Show sample arrival arrows round the screen edge. */
  arrivals: boolean;
  /** Show the "track plane active" badge, as while following a plane. */
  tracking: boolean;
  /** Game speed multiplier on the speed button (see `GAME_SPEEDS` in config.ts). */
  speed: (typeof GAME_SPEEDS)[number];
  /** Open the help panel (the "?" button, or H / ? in the game). */
  help: boolean;
  /** Hide the whole interface, as after pressing U (the overlay and dialogs stay). */
  uiHidden: boolean;
  /** Show the stats-for-nerds panel with a live, made-up sample (the G key). */
  stats: boolean;
  /** Open the licenses panel (the "Licenses" link on the overlay / in help). */
  licenses: boolean;
  /** Time of day on the HUD clock (hours; night from ~21:00). */
  hours: number;
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
  const breakdown = { landed: args.landed, departed: args.departed, seconds: args.seconds };
  hud.setScore(breakdown);
  hud.setClock(args.hours, nightFactor(args.hours));
  if (args.phase === "gameover") hud.showGameOver(breakdown);
  else if (args.phase !== "start") hud.hideOverlay();
  hud.setPhase(args.phase);
  hud.setTracking(args.tracking);
  hud.setSpeed(args.speed);
  hud.setMuted(args.muted);
  hud.setMusicOn(args.musicOn);
  hud.setFullscreenAvailable(true);
  hud.setFullscreen(args.fullscreen);
  hud.setHelpOpen(args.help);
  hud.setLicensesOpen(args.licenses);
  hud.setUiHidden(args.uiHidden);
  if (args.stats) {
    hud.setStatsInfo({ gpu: "Apple M2 · WebGL 2" });
    hud.setStatsOpen(true);
    hud.updateStats(0, () => ({
      fps: 59.6,
      frameMs: 16.8,
      low: 48,
      renderMs: 3.4,
      drawCalls: 184,
      activeMeshes: 1260,
      triangles: 412000,
      width: 1920,
      height: 1080,
      scaling: 1,
      planes: 7,
      speed: args.speed,
      steps: args.speed > 1 ? 2 : 1,
      elapsed: args.seconds,
      heapMb: 148,
    }));
  }
  if (args.weather !== "none") hud.setWeatherAlerts([windAlert(args.weather)]);
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
    speed: { control: "inline-radio", options: [...GAME_SPEEDS] },
    landed: { control: { type: "number", min: 0, step: 1 } },
    departed: { control: { type: "number", min: 0, step: 1 } },
    seconds: { control: { type: "number", min: 0, step: 1 } },
    hours: { control: { type: "range", min: 0, max: 23.99, step: 0.25 } },
    toastColor: {
      control: "inline-radio",
      options: ["none", "red", "blue", "yellow", "violet"],
    },
    weather: { control: "inline-radio", options: ["none", "yellow", "amber", "red"] },
    // Callbacks are wired to the Actions panel; no control needed.
    onStart: { table: { disable: true } },
    onTogglePause: { table: { disable: true } },
    onSpeedChange: { table: { disable: true } },
    onRotate: { table: { disable: true } },
    onZoom: { table: { disable: true } },
    onToggleSound: { table: { disable: true } },
    onToggleMusic: { table: { disable: true } },
    onHelp: { table: { disable: true } },
    onStats: { table: { disable: true } },
  },
  args: {
    phase: "start",
    landed: 0,
    departed: 0,
    seconds: 0,
    toast: "",
    toastColor: "none",
    weather: "none",
    arrivals: false,
    tracking: false,
    speed: 1,
    muted: false,
    musicOn: true,
    fullscreen: false,
    help: false,
    licenses: false,
    stats: false,
    uiHidden: false,
    hours: 8,
    onStart: fn(),
    onTogglePause: fn(),
    onSpeedChange: fn(),
    onRotate: fn(),
    onZoom: fn(),
    onToggleSound: fn(),
    onToggleMusic: fn(),
    onHelp: fn(),
    onStats: fn(),
  },
};
export default meta;

type Story = StoryObj<HudArgs>;

/** Title screen shown on load. */
export const StartScreen: Story = {};

/** Mid-shift: score (total, then landed · departed), pause button and camera controls. */
export const Playing: Story = {
  args: { phase: "playing", landed: 12, departed: 3, seconds: 262 },
};

/** A shift after dark: the clock shows the moon. */
export const Night: Story = { args: { phase: "playing", landed: 14, hours: 23.5 } };

/**
 * Arrival arrows on the screen edge, as planes are about to fly in. Arrows
 * that would sit under the score panel or camera buttons slide clear of them
 * (`data-arrow-avoid` in hudMarkup.ts).
 */
export const Arrivals: Story = { args: { phase: "playing", landed: 8, arrivals: true } };

/**
 * Following a plane (right-click one in the game): the "track plane active"
 * badge bottom-left, with its blinking dot. Arrival arrows slide clear of it.
 */
export const Tracking: Story = {
  args: { phase: "playing", landed: 5, arrivals: true, tracking: true },
};

/**
 * Game speed button (top-right, left of pause), set to 3×. Click it, or press
 * 1-4 in the game, to cycle 1×, 1.5×, 2×, 3×; a new shift starts back at 1×.
 */
export const FastForward: Story = { args: { phase: "playing", landed: 12, speed: 3 } };

/** Paused banner over the (frozen) game. */
export const Paused: Story = { args: { phase: "paused", landed: 12 } };

/**
 * A runway-unlock toast. It fades after `TOAST_MS` (hud.ts); change any arg
 * to replay it.
 */
export const Toast: Story = {
  args: { phase: "playing", landed: 3, toast: "BLUE runway open", toastColor: "blue" },
};

/**
 * A departure's notice (core/departures.ts, wording in ui/eventToasts.ts):
 * violet like the plane, naming the runway it takes off from.
 */
export const DepartureToast: Story = {
  args: { phase: "playing", landed: 6, toast: "Departure — RED runway", toastColor: "violet" },
};

/**
 * Weather warnings (wind stream forecast, ui/weatherAlerts.ts), styled
 * after the Met Office's yellow / amber / red warnings: a strip at the top
 * of the screen, above the toasts (one is showing here), with one line per
 * kind of weather and level on the way, no place or time. The game shows
 * yellow for an ordinary wind stream (from the second day) and red for the
 * extreme kind that destroys aircraft (from the third), possibly both at
 * once (`streamWarningLevel` in core/windStreams.ts). It stays up
 * until the weather arrives, unlike a toast. Canned here; the game fills
 * it from the sim every frame.
 */
export const WeatherAlerts: Story = {
  args: {
    phase: "playing",
    landed: 9,
    weather: "amber",
    toast: "BLUE runway open",
    toastColor: "blue",
  },
};

/**
 * Stats for nerds (G; no button, listed in the help panel): frame rate with
 * its 1% low, frame and CPU render time, draw calls, meshes, triangles,
 * buffer size, GPU, plane count, game speed, sim steps per frame, shift
 * time and JS heap (Chromium only). Canned numbers here; the game refreshes
 * them 4× a second (`STATS_REFRESH_MS` in ui/stats.ts) and the game keeps
 * running underneath. It sits above the track-plane badge, so turn that on
 * too to check they don't overlap.
 */
export const Stats: Story = {
  args: { phase: "playing", landed: 12, departed: 3, seconds: 262, stats: true, tracking: true },
};

/**
 * Interface hidden (U): everything in the game view (score, buttons,
 * toasts, arrows, the track-plane badge, stats, the paused banner) is
 * invisible and ignores clicks, via `.hud-chrome` in hudMarkup.ts and
 * `.hud-hidden` in style.css. Only the eye button (top-right corner,
 * dimmed, full opacity on hover) remains, to bring it back for players who
 * don't know the U key (or have no keyboard). Toggle `uiHidden`, or set phase to "start" or
 * "gameover" to see the overlay stay; it's the only way back to a shift.
 */
export const InterfaceHidden: Story = {
  args: {
    phase: "playing",
    landed: 12,
    toast: "BLUE runway open",
    toastColor: "blue",
    arrivals: true,
    tracking: true,
    stats: true,
    uiHidden: true,
  },
};

/** Sound off: the sound button (bottom-right, or M) is dimmed and struck through. */
export const Muted: Story = { args: { phase: "playing", landed: 5, muted: true } };

/**
 * In full screen (the last button in the bottom-right row, or Z): the
 * button turns into "leave full screen". It hides itself where the browser
 * has no full screen (`setFullscreenAvailable(false)`, iPhone Safari).
 */
export const Fullscreen: Story = { args: { phase: "playing", landed: 5, fullscreen: true } };

/** Music off: the music button (or N) is dimmed and struck through; effects play on. */
export const MusicOff: Story = { args: { phase: "playing", landed: 5, musicOn: false } };

/**
 * Crash overlay with the final score, its breakdown (landed, departed,
 * time: `showGameOver` in hud.ts) and the leaderboard form (its states
 * are in HUD/Leaderboard). See-through (CRASH_BACKDROP in hud.ts) so the
 * crash cinematic stays visible above it: see Scene/Gameplay/Crash.
 */
export const GameOver: Story = {
  args: { phase: "gameover", landed: 27, departed: 5, seconds: 614 },
};

/**
 * Help panel over a running shift: how to play, mouse/touch controls and
 * every keyboard shortcut, generated from input/shortcuts.ts. In the game
 * the "?" button (top-right, on every screen) or H / ? opens it and pauses
 * the shift; ✕, the backdrop, H, ? or Esc close it and continue.
 */
export const Help: Story = { args: { phase: "playing", landed: 9, help: true } };

/** Help opened from the title screen: the "?" button sits above the overlay. */
export const HelpFromStart: Story = { args: { phase: "start", help: true } };

/**
 * Licenses panel (ui/licenses.ts), opened from the "Licenses" link: the
 * project's ISC license, why the game as served is GPL-3.0 (the bundled
 * eSpeak NG voice), a notice per component, the credits of the sound
 * recordings (generated by `npm run audio:build`) and the full texts, fetched from
 * public/licenses/.
 */
export const Licenses: Story = { args: { phase: "start", licenses: true } };
