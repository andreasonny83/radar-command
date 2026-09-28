/**
 * HUD elements one at a time, straight from their hudMarkup.ts templates.
 *
 * Useful for styling a single piece without the rest of the HUD on top.
 * Elements that start hidden in the game (pause button, paused banner,
 * toast, tracking badge, help panel) are forced visible here.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { createArrivalArrows } from "./arrivalArrows";
import {
  arrivalLayerMarkup,
  cameraControlsMarkup,
  helpButtonMarkup,
  helpPanelMarkup,
  musicButtonMarkup,
  overlayMarkup,
  pauseButtonMarkup,
  pausedBannerMarkup,
  projectLinksMarkup,
  scorePanelMarkup,
  soundButtonMarkup,
  toastMarkup,
  trackingIndicatorMarkup,
} from "./hudMarkup";

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

export const ScorePanel: StoryObj<{ score: number }> = {
  args: { score: 42 },
  argTypes: { score: { control: { type: "number", min: 0, step: 1 } } },
  render: ({ score }) => {
    const root = stage(scorePanelMarkup());
    part(root, "scoreDisplay").textContent = String(score);
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

export const Overlay: Story = { render: () => stage(overlayMarkup()) };

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

/** "?" button, top-right: opens the help panel from any screen. */
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
