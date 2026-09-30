/**
 * HUD elements one at a time, straight from their hudMarkup.ts templates.
 *
 * Useful for styling a single piece without the rest of the HUD on top.
 * Elements that start hidden in the game (pause button, paused banner,
 * toast, tracking badge, help panel, leaderboard form and panel) are
 * forced visible here.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { DAY_SECONDS, nightFactor } from "../core/daytime";
import { DEPARTURE_POINTS, LANDING_POINTS, scoreOf } from "../core/scoring";
import type { WarningLevel } from "../core/types";
import { createArrivalArrows } from "./arrivalArrows";
import { createClockDisplay, createClockIcon } from "./clockDisplay";
import { createScoreRoll } from "./scoreRoll";
import { createStatsPanel } from "./stats";
import {
  arrivalLayerMarkup,
  cameraControlsMarkup,
  EYE_OFF_ICON,
  helpButtonMarkup,
  helpPanelMarkup,
  leaderboardPanelMarkup,
  musicButtonMarkup,
  overlayMarkup,
  pauseButtonMarkup,
  pausedBannerMarkup,
  projectLinksMarkup,
  scorePanelMarkup,
  soundButtonMarkup,
  speedButtonMarkup,
  statsPanelMarkup,
  submitFormMarkup,
  noticesMarkup,
  toastMarkup,
  trackingIndicatorMarkup,
  uiToggleButtonMarkup,
} from "./hudMarkup";
import { createWeatherStrip, windAlert } from "./weatherAlerts";

/** Full-window stage matching the game's `<body>`, holding one template. */
function stage(markup: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "relative h-full w-full overflow-hidden text-slate-100";
  el.innerHTML = markup;
  return el;
}

/** Fetch an element the template is known to contain. */
function part(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const meta: Meta = { title: "HUD/Elements" };
export default meta;

type Story = StoryObj;

/**
 * The score panel: the total from `scoreOf` (core/scoring.ts: LANDING_POINTS,
 * DEPARTURE_POINTS, SECONDS_PER_TIME_POINT), the "landed · departed" line
 * and the clock.
 */
export const ScorePanel: StoryObj<{
  landed: number;
  departed: number;
  seconds: number;
  hours: number;
}> = {
  args: { landed: 12, departed: 3, seconds: 262, hours: 8 },
  argTypes: {
    landed: { control: { type: "number", min: 0, step: 1 } },
    departed: { control: { type: "number", min: 0, step: 1 } },
    seconds: { control: { type: "number", min: 0, step: 1 } },
    hours: { control: { type: "range", min: 0, max: 23.99, step: 0.25 } },
  },
  render: ({ landed, departed, seconds, hours }) => {
    const root = stage(scorePanelMarkup());
    createScoreRoll(part(root, "scoreDisplay")).set(scoreOf({ landed, departed, seconds }));
    part(root, "scoreBreakdown").textContent = `${landed} landed · ${departed} departed`;
    const clock = createClockDisplay(part(root, "clockTime"));
    clock.set(hours);
    clock.setNight(nightFactor(hours));
    createClockIcon(part(root, "clockIcon")).set(nightFactor(hours) >= 0.5);
    return root;
  },
};

/**
 * The score panel animating as it does in a shift.
 *
 * Score (ui/scoreRoll.ts): a drum per digit turns forward to each new total
 * and bounces as it settles; every `interval` seconds it gains a time
 * point, a landing or a departure (LANDING_POINTS, DEPARTURE_POINTS), so
 * single digits, carries and a new leading digit all come round (it starts
 * over past 999). The drums are ui/reel.ts (FACE_EM), easing and window
 * `.reel` / `.reel-drum` in style.css.
 *
 * Clock (ui/clockDisplay.ts), running at `clockSpeed` × the game's (1 =
 * DAY_SECONDS per day): a neon seven-segment display (`createSegmentDigit`,
 * `.neon-clock` / `.seg` in style.css) with faint unlit segments, a glow
 * that grows with the dark
 * (GLOW_DAY / GLOW_NIGHT), digits switching instantly, the colon blinking while it runs (`.clock-colon-running`;
 * `paused` stops the clock), and the sun / moon spinning in at dusk and
 * dawn (`createClockIcon`). Starts just before 21:00 to show both.
 */
export const Animated: StoryObj<{
  start: number;
  interval: number;
  startHour: number;
  clockSpeed: number;
  /** Stop the clock, as a paused game does (it's still set every frame). */
  paused: boolean;
}> = {
  args: { start: 88, interval: 1.2, startHour: 20.75, clockSpeed: 1, paused: false },
  argTypes: {
    start: { control: { type: "number", min: 0, step: 1 } },
    interval: { control: { type: "range", min: 0.2, max: 3, step: 0.1 } },
    startHour: { control: { type: "range", min: 0, max: 23.99, step: 0.05 } },
    clockSpeed: { control: { type: "range", min: 0.05, max: 1, step: 0.05 } },
  },
  render: ({ start, interval, startHour, clockSpeed, paused }) => {
    const root = stage(scorePanelMarkup());
    const clock = createClockDisplay(part(root, "clockTime"));
    const icon = createClockIcon(part(root, "clockIcon"));
    let hours = startHour;
    let last = performance.now();
    let mounted = false;
    clock.set(hours);
    clock.setNight(nightFactor(hours));
    icon.set(nightFactor(hours) >= 0.5);
    const tickClock = (now: number) => {
      // Stop once Storybook has swapped the story out.
      if (root.isConnected) mounted = true;
      else if (mounted) return;
      if (!paused) hours = (hours + (((now - last) / 1000) * 24 * clockSpeed) / DAY_SECONDS) % 24;
      last = now;
      clock.set(hours);
      clock.setNight(nightFactor(hours));
      icon.set(nightFactor(hours) >= 0.5);
      requestAnimationFrame(tickClock);
    };
    requestAnimationFrame(tickClock);
    const roll = createScoreRoll(part(root, "scoreDisplay"));
    const gains = [1, 1, LANDING_POINTS, 1, DEPARTURE_POINTS, LANDING_POINTS];
    let value = start;
    let tick = 0;
    roll.set(value);
    const timer = setInterval(() => {
      // Stop once Storybook has swapped the story out.
      if (!root.isConnected) return clearInterval(timer);
      value += gains[tick++ % gains.length]!;
      if (value > 999) value = start;
      roll.set(value);
    }, interval * 1000);
    return root;
  },
};

export const PauseButton: StoryObj<{ paused: boolean }> = {
  args: { paused: false },
  render: ({ paused }) => {
    const root = stage(pauseButtonMarkup());
    const btn = part(root, "pauseBtn");
    btn.classList.remove("hidden");
    btn.textContent = paused ? "▶" : "⏸";
    return root;
  },
};

/** Game speed button (left of pause): the label shows the multiplier. */
export const SpeedButton: StoryObj<{ speed: string }> = {
  args: { speed: "1.5" },
  argTypes: { speed: { control: "inline-radio", options: ["1", "1.5", "2", "3"] } },
  render: ({ speed }) => {
    const root = stage(pauseButtonMarkup() + speedButtonMarkup());
    part(root, "pauseBtn").classList.remove("hidden");
    const btn = part(root, "speedBtn");
    btn.classList.remove("hidden");
    btn.textContent = `${speed}×`;
    return root;
  },
};

export const PausedBanner: Story = {
  render: () => {
    const root = stage(pausedBannerMarkup());
    part(root, "pausedBanner").classList.replace("hidden", "flex");
    return root;
  },
};

export const Toast: StoryObj<{ text: string; color: string }> = {
  args: { text: "YELLOW runway open", color: "#eab308" },
  argTypes: { color: { control: "color" } },
  render: ({ text, color }) => {
    const root = stage(toastMarkup());
    const toast = part(root, "toast");
    toast.textContent = text;
    toast.style.color = color;
    toast.classList.remove("opacity-0");
    return root;
  },
};

/**
 * Weather warning strip, top and centre (`noticesMarkup`), styled after the
 * Met Office's warnings: a line per kind of weather on the way, coloured
 * yellow, amber or red (`WARNING_HEX` in config.ts), with no place or time.
 * Filled by `createWeatherStrip` like the game does. Toasts show underneath
 * (`toast`), and `stacked` adds a second warning to show how future kinds
 * of weather will sit.
 */
export const WeatherAlerts: StoryObj<{ level: WarningLevel; stacked: boolean; toast: boolean }> = {
  args: { level: "amber", stacked: false, toast: true },
  argTypes: { level: { control: "inline-radio", options: ["yellow", "amber", "red"] } },
  render: ({ level, stacked, toast }) => {
    const root = stage(noticesMarkup());
    const alerts = [windAlert(level)];
    if (stacked) {
      alerts.push({
        id: "sample-rain",
        level: "yellow",
        headline: "Yellow warning of rain",
        advice: "Be aware: sample line, there is no rain in the game yet",
      });
    }
    createWeatherStrip(part(root, "weatherAlerts")).update(alerts);
    if (toast) {
      const el = part(root, "toast");
      el.textContent = "BLUE runway open";
      el.style.color = "#3b82f6";
      el.classList.remove("opacity-0");
    }
    return root;
  },
};

/**
 * "Track plane active" badge, bottom-left, shown while the camera follows a
 * plane (right-click one in the game). The dot blinks via `.tracking-dot` /
 * `tracking-blink` in style.css.
 */
export const TrackingIndicator: Story = {
  render: () => {
    const root = stage(trackingIndicatorMarkup());
    part(root, "trackingIndicator").classList.replace("hidden", "flex");
    return root;
  },
};

/**
 * Stats for nerds panel, bottom-left (shown with its `hud.setStatsOpen`
 * wiring, filled with canned numbers). Rows come from `STAT_SECTIONS` in
 * ui/stats.ts; the live values are HUD/Screens → Stats.
 */
export const StatsPanel: Story = {
  render: () => {
    const root = stage(statsPanelMarkup());
    const panel = createStatsPanel(root);
    panel.setVisible(true);
    panel.setInfo({ gpu: "Apple M2 · WebGL 2" });
    panel.update(0, () => ({
      fps: 60,
      frameMs: 16.7,
      low: 52,
      renderMs: 3.2,
      drawCalls: 184,
      activeMeshes: 1260,
      triangles: 412000,
      width: 1920,
      height: 1080,
      scaling: 1,
      planes: 7,
      speed: 1,
      steps: 1,
      elapsed: 262,
      heapMb: 148,
    }));
    return root;
  },
};

/** Bottom-right button row: sound and music on / off, then the camera buttons. */
export const CameraControls: Story = { render: () => stage(cameraControlsMarkup()) };

/**
 * Sound on / off button on its own (it sits first in the camera row).
 * `hud.setMuted` adds `.hud-button-off` (style.css) while it's off, like
 * the music button; `muted` previews that.
 */
export const SoundButton: StoryObj<{ muted: boolean }> = {
  args: { muted: false },
  render: ({ muted }) => {
    const root = stage(`<div class="absolute right-4 bottom-4">${soundButtonMarkup()}</div>`);
    part(root, "soundBtn").classList.toggle("hud-button-off", muted);
    return root;
  },
};

/**
 * Music on / off button on its own (second in the camera row).
 * `hud.setMusicOn` adds `.hud-button-off` (style.css) while it's off.
 */
export const MusicButton: StoryObj<{ on: boolean }> = {
  args: { on: true },
  render: ({ on }) => {
    const root = stage(`<div class="absolute right-4 bottom-4">${musicButtonMarkup()}</div>`);
    part(root, "musicBtn").classList.toggle("hud-button-off", !on);
    return root;
  },
};

/** Start overlay: START SHIFT and LEADERBOARD buttons (the form stays hidden until game over). */
export const Overlay: Story = { render: () => stage(overlayMarkup()) };

/**
 * Game-over leaderboard form on its own (name field, SUBMIT, status line).
 * Its states are in HUD/Leaderboard; here the plain template.
 */
export const SubmitForm: Story = {
  render: () => {
    const root = stage(
      `<div class="flex h-full items-center justify-center">${submitFormMarkup()}</div>`,
    );
    part(root, "submitForm").classList.replace("hidden", "flex");
    return root;
  },
};

/**
 * Leaderboard panel frame: tabs, empty list area, pager bar and footer.
 * The list is filled by ui/leaderboard.ts, which also shows the pager only
 * on boards of more than one page (shown here as page 1 of 5): see
 * HUD/Leaderboard for it with data.
 */
export const LeaderboardPanel: Story = {
  render: () => {
    const root = stage(leaderboardPanelMarkup());
    part(root, "leaderboardPanel").classList.replace("hidden", "flex");
    part(root, "leaderboardPager").classList.replace("hidden", "flex");
    part(root, "leaderboardPageLabel").textContent = "Page 1 of 5";
    (part(root, "leaderboardPrevBtn") as HTMLButtonElement).disabled = true;
    return root;
  },
};

/**
 * "GitHub · Send feedback" links, shown under the start / game-over button
 * and at the foot of the help panel. The repo URL is `GITHUB_REPO_URL` in
 * links.ts; in the game, hud.ts swaps the feedback href for a pre-filled
 * new-issue form (`feedbackIssueUrl`) on click. Here it's the plain form.
 */
export const ProjectLinks: Story = {
  render: () =>
    stage(`<div class="flex h-full items-center justify-center">${projectLinksMarkup()}</div>`),
};

/**
 * Interface toggle, in the top-right corner (the "?" sits beside it): an eye to hide the
 * interface, a slashed eye (dimmed, full opacity on hover) to bring it
 * back. `hidden` previews the second state; the game swaps them in
 * `hud.setUiHidden`.
 */
export const UiToggleButton: StoryObj<{ hidden: boolean }> = {
  args: { hidden: false },
  render: ({ hidden }) => {
    const root = stage(helpButtonMarkup() + uiToggleButtonMarkup());
    const btn = part(root, "uiToggleBtn");
    if (hidden) {
      btn.classList.add("opacity-35", "hover:opacity-100");
      btn.innerHTML = EYE_OFF_ICON;
    }
    return root;
  },
};

/** "?" button, top-right, left of the interface toggle: opens the help panel from any screen. */
export const HelpButton: Story = { render: () => stage(helpButtonMarkup()) };

/**
 * Help panel: how to play, mouse/touch controls and the keyboard shortcuts.
 * The shortcut rows come from `SHORTCUT_GROUPS` in input/shortcuts.ts and
 * the mouse rows from `POINTER_CONTROLS`; key caps use `.kbd` in style.css.
 */
export const HelpPanel: Story = {
  render: () => {
    const root = stage(helpPanelMarkup());
    part(root, "helpPanel").classList.replace("hidden", "flex");
    return root;
  },
};

/**
 * One arrival arrow (`arrivalArrowMarkup`), drawn by the real
 * arrivalArrows.ts, in the middle of the screen so it's easy to inspect.
 * In the game it sits on the screen edge where a plane is about to fly in,
 * pointing along its track, in its runway colour.
 */
export const ArrivalArrow: StoryObj<{ color: string; angleDeg: number }> = {
  args: { color: "#3b82f6", angleDeg: 30 },
  argTypes: {
    color: { control: "color" },
    angleDeg: { control: { type: "range", min: -180, max: 180, step: 5 } },
  },
  render: ({ color, angleDeg }) => {
    const root = stage(arrivalLayerMarkup());
    // The layer has no size until Storybook attaches `root`: place the arrow then.
    requestAnimationFrame(() => {
      const layer = part(root, "arrivals");
      createArrivalArrows(layer).update([
        {
          id: 1,
          color,
          x: layer.clientWidth / 2,
          y: layer.clientHeight / 2,
          angle: (angleDeg * Math.PI) / 180,
        },
      ]);
    });
    return root;
  },
};
