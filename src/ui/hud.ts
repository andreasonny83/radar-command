/**
 * HTML HUD layered over the canvas: score, start/game-over overlay, pause
 * button, toast notices, arrival arrows, the "track plane" badge, the
 * sound, music and camera buttons, the help button + panel, the GitHub /
 * feedback / licenses links and the licenses panel.
 * Markup lives in hudMarkup.ts (shared with Storybook); this module injects
 * and wires it up.
 */
import type { GamePhase } from "../core/types";
import { shortcutHint } from "../input/shortcuts";
import { createArrivalArrows, type ArrivalMarker } from "./arrivalArrows";
import { CLOCK_ICONS, hudMarkup } from "./hudMarkup";
import { licenseTextUrl, PROJECT_LICENSE_TEXT } from "./licenses";
import { feedbackIssueUrl } from "./links";

export interface HudCallbacks {
  onStart: () => void;
  /** Pause button pressed (pause while playing, continue while paused). */
  onTogglePause: () => void;
  /** -1 = rotate counter-clockwise, +1 = clockwise. */
  onRotate: (direction: -1 | 1) => void;
  /** +1 = zoom in, -1 = zoom out. */
  onZoom: (direction: -1 | 1) => void;
  /** Sound button pressed: toggle mute. Optional (stories without sound). */
  onToggleSound?: () => void;
  /** Music button pressed: toggle the music. Optional, like `onToggleSound`. */
  onToggleMusic?: () => void;
  /**
   * The help panel opened or closed (button, backdrop, or `setHelpOpen`),
   * e.g. to pause the game while it's open. Optional: stories without a
   * game behind them leave it out.
   */
  onHelp?: (open: boolean) => void;
}

export interface Hud {
  setScore(score: number): void;
  /**
   * Time of day under the score: `hours` as HH:MM, and a moon once
   * `night` ≥ 0.5 (a sun before). Cheap every frame: the DOM is only
   * touched when the minute or the icon changes.
   */
  setClock(hours: number, night: number): void;
  hideOverlay(): void;
  showGameOver(score: number): void;
  /** Sync the pause button and banner with the current game phase. */
  setPhase(phase: GamePhase): void;
  /** Briefly show a notice at the top of the screen, optionally tinted. */
  showToast(text: string, color?: string): void;
  /** Arrows on the screen edge for planes about to fly in (call every frame). */
  setArrivals(markers: readonly ArrivalMarker[]): void;
  /**
   * Show or hide the "track plane active" badge (the camera is following a
   * plane). Cheap to call every frame: the DOM is only touched on change.
   */
  setTracking(active: boolean): void;
  /** Show the sound button as muted (dimmed, struck through) or on. */
  setMuted(muted: boolean): void;
  /** Show the music button as on (lit) or off (dimmed). */
  setMusicOn(on: boolean): void;
  /** Is the help panel showing? */
  readonly helpOpen: boolean;
  /** Open or close the help panel (fires `onHelp` on change). */
  setHelpOpen(open: boolean): void;
  /** Is the licenses panel showing? */
  readonly licensesOpen: boolean;
  /**
   * Open or close the licenses panel (the "Licenses" links open it). While
   * it's open, keys don't reach the game's shortcuts; Esc closes it.
   */
  setLicensesOpen(open: boolean): void;
}

/** How long a toast stays fully visible before fading out (ms). */
const TOAST_MS = 2500;

/** The start screen's backdrop (as in hudMarkup.ts): dim and blur the map. */
const START_BACKDROP = ["justify-center", "bg-slate-950/80", "backdrop-blur-md"];
/**
 * Game-over backdrop: the crash cinematic keeps orbiting behind it (see
 * render/camera.ts `focusOn`), so leave the centre of the screen clear and
 * sit the panel low, over a gradient that only darkens the bottom.
 */
const CRASH_BACKDROP = [
  "justify-end",
  "pb-[12vh]",
  "bg-linear-to-t",
  "from-slate-950/90",
  "via-slate-950/30",
  "to-transparent",
];

/**
 * Inject the HUD markup at the start of `root` (so it stacks above a canvas
 * that follows it) and wire it to `callbacks`.
 */
/** "HH:MM" for a time of day in hours (0 ≤ h < 24; wraps). */
export function formatClock(hours: number): string {
  const minutes = Math.floor((((hours % 24) + 24) % 24) * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function createHud(root: HTMLElement, callbacks: HudCallbacks): Hud {
  root.insertAdjacentHTML("afterbegin", hudMarkup());
  // Scoped to `root` rather than `document`, so Storybook can mount a HUD
  // inside its own preview element.
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`Missing #${id} in hudMarkup.ts`);
    return el;
  };
  const score = byId("scoreDisplay");
  const clockIcon = byId("clockIcon");
  const clockTime = byId("clockTime");
  let clockText = "";
  let clockNight: boolean | null = null;
  const overlay = byId("overlay");
  const title = byId("overlayTitle");
  const message = byId("overlayMessage");
  const startBtn = byId<HTMLButtonElement>("startBtn");
  const pauseBtn = byId<HTMLButtonElement>("pauseBtn");
  const pausedBanner = byId("pausedBanner");
  const toast = byId("toast");
  const tracking = byId("trackingIndicator");
  let trackingShown = false;
  const helpBtn = byId<HTMLButtonElement>("helpBtn");
  const helpPanel = byId("helpPanel");
  const helpCloseBtn = byId<HTMLButtonElement>("helpCloseBtn");
  let helpShown = false;
  const arrivals = createArrivalArrows(
    byId("arrivals"),
    Array.from(root.querySelectorAll<HTMLElement>("[data-arrow-avoid]")),
  );
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  startBtn.addEventListener("click", () => {
    callbacks.onStart();
    // The overlay fades out but keeps focus: drop it, or Space/Enter would
    // press the invisible button again.
    startBtn.blur();
  });
  pauseBtn.addEventListener("click", () => {
    callbacks.onTogglePause();
    // Drop focus so a later Space/Enter doesn't re-press the button by accident.
    pauseBtn.blur();
  });
  // Feedback links: pre-fill the issue form on click, just before the
  // browser follows the href (so the screen size it reports is current).
  root.querySelectorAll<HTMLAnchorElement>("a[data-feedback-link]").forEach((a) =>
    a.addEventListener("click", () => {
      a.href = feedbackIssueUrl();
    }),
  );
  byId("rotateLeftBtn").addEventListener("click", () => callbacks.onRotate(-1));
  byId("rotateRightBtn").addEventListener("click", () => callbacks.onRotate(1));
  byId("zoomInBtn").addEventListener("click", () => callbacks.onZoom(1));
  byId("zoomOutBtn").addEventListener("click", () => callbacks.onZoom(-1));
  const soundBtn = byId<HTMLButtonElement>("soundBtn");
  soundBtn.addEventListener("click", () => {
    callbacks.onToggleSound?.();
    soundBtn.blur();
  });
  const musicBtn = byId<HTMLButtonElement>("musicBtn");
  musicBtn.addEventListener("click", () => {
    callbacks.onToggleMusic?.();
    musicBtn.blur();
  });

  const setHelpOpen = (open: boolean) => {
    if (open === helpShown) return;
    helpShown = open;
    // `hidden` and `flex` both set `display`, so swap them rather than stack.
    helpPanel.classList.toggle("hidden", !open);
    helpPanel.classList.toggle("flex", open);
    helpBtn.setAttribute("aria-expanded", String(open));
    // Focus follows the dialog: onto its close button, then back to the
    // "?" button (blurred, so Space/Enter can't reopen it by accident).
    if (open) helpCloseBtn.focus();
    else helpBtn.blur();
    callbacks.onHelp?.(open);
  };
  helpBtn.addEventListener("click", () => setHelpOpen(!helpShown));
  helpCloseBtn.addEventListener("click", () => setHelpOpen(false));
  // A click on the dimmed backdrop (not the dialog itself) closes it.
  helpPanel.addEventListener("click", (e) => {
    if (e.target === helpPanel) setHelpOpen(false);
  });

  // Licenses panel (ui/licenses.ts): opened from the "Licenses" links on
  // the overlay and in the help panel, on top of either.
  const licensesPanel = byId("licensesPanel");
  const licensesCloseBtn = byId<HTMLButtonElement>("licensesCloseBtn");
  byId("projectLicenseText").textContent = PROJECT_LICENSE_TEXT;
  let licensesShown = false;
  /** The link that opened the panel, to hand focus back to on close. */
  let licensesOpener: HTMLElement | null = null;
  /** Fetch the full license texts (from public/licenses/) the first time they're shown. */
  const loadLicenseTexts = () => {
    for (const pre of licensesPanel.querySelectorAll<HTMLElement>("[data-license-text]")) {
      const path = pre.dataset.licenseText;
      if (!path || pre.dataset.loaded) continue;
      pre.dataset.loaded = "1";
      fetch(licenseTextUrl(path))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((text) => (pre.textContent = text))
        .catch(() => {
          pre.textContent = `Couldn't load this license text: it's also in the source repository, as public/${path}.`;
          delete pre.dataset.loaded; // try again next time
        });
    }
  };
  const setLicensesOpen = (open: boolean) => {
    if (open === licensesShown) return;
    licensesShown = open;
    licensesPanel.classList.toggle("hidden", !open);
    licensesPanel.classList.toggle("flex", open);
    if (open) {
      loadLicenseTexts();
      licensesCloseBtn.focus();
    } else {
      licensesOpener?.focus();
      licensesOpener?.blur();
      licensesOpener = null;
    }
  };
  root.querySelectorAll<HTMLElement>("[data-licenses-link]").forEach((link) =>
    link.addEventListener("click", () => {
      licensesOpener = link;
      setLicensesOpen(true);
    }),
  );
  licensesCloseBtn.addEventListener("click", () => setLicensesOpen(false));
  licensesPanel.addEventListener("click", (e) => {
    if (e.target === licensesPanel) setLicensesOpen(false);
  });
  // While open, the panel owns the keyboard: Esc closes it, and no key
  // reaches the game's shortcuts (input/shortcuts.ts listens on window, so
  // stopping the event on its way down, at the document, is enough).
  root.ownerDocument.addEventListener(
    "keydown",
    (e) => {
      if (!licensesShown) return;
      if (e.key === "Escape") setLicensesOpen(false);
      e.stopImmediatePropagation();
    },
    true,
  );

  return {
    setScore(value) {
      score.textContent = String(value);
    },
    setClock(hours, night) {
      const text = formatClock(hours);
      if (text !== clockText) {
        clockText = text;
        clockTime.textContent = text;
      }
      const isNight = night >= 0.5;
      if (isNight !== clockNight) {
        clockNight = isNight;
        clockIcon.innerHTML = isNight ? CLOCK_ICONS.moon : CLOCK_ICONS.sun;
        clockIcon.title = isNight ? "Night" : "Day";
        clockIcon.classList.toggle("text-amber-300", !isNight);
        clockIcon.classList.toggle("text-sky-200", isNight);
      }
    },
    hideOverlay() {
      overlay.classList.add("opacity-0", "pointer-events-none");
    },
    showGameOver(value) {
      title.textContent = "CRASH!";
      title.classList.replace("text-sky-400", "text-red-500");
      title.classList.replace("glow-text", "glow-text-red");
      message.textContent = `You safely landed ${value} aircraft.`;
      startBtn.textContent = "TRY AGAIN";
      overlay.classList.remove(...START_BACKDROP);
      overlay.classList.add(...CRASH_BACKDROP);
      overlay.classList.remove("opacity-0", "pointer-events-none");
    },
    setPhase(phase) {
      const inShift = phase === "playing" || phase === "paused";
      const paused = phase === "paused";
      pauseBtn.classList.toggle("hidden", !inShift);
      pauseBtn.textContent = paused ? "▶" : "⏸";
      const keys = shortcutHint("togglePause");
      pauseBtn.title = paused ? `Continue (${keys})` : `Pause (${keys})`;
      pauseBtn.setAttribute("aria-label", paused ? "Continue" : "Pause");
      pauseBtn.setAttribute("aria-pressed", String(paused));
      // `hidden` and `flex` both set `display`, so swap them rather than stack.
      pausedBanner.classList.toggle("hidden", !paused);
      pausedBanner.classList.toggle("flex", paused);
    },
    showToast(text, color) {
      toast.textContent = text;
      toast.style.color = color ?? "";
      toast.classList.remove("opacity-0");
      // A newer toast replaces the old one and restarts the clock.
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.add("opacity-0"), TOAST_MS);
    },
    setArrivals(markers) {
      arrivals.update(markers);
    },
    setMuted(muted) {
      soundBtn.classList.toggle("hud-button-off", muted);
      const keys = shortcutHint("toggleSound");
      soundBtn.title = muted ? `Sound on (${keys})` : `Sound off (${keys})`;
      soundBtn.setAttribute("aria-pressed", String(!muted));
    },
    setMusicOn(on) {
      musicBtn.classList.toggle("hud-button-off", !on);
      const keys = shortcutHint("toggleMusic");
      musicBtn.title = on ? `Music off (${keys})` : `Music on (${keys})`;
      musicBtn.setAttribute("aria-pressed", String(on));
    },
    setTracking(active) {
      if (active === trackingShown) return;
      trackingShown = active;
      // `hidden` and `flex` both set `display`, so swap them rather than stack.
      tracking.classList.toggle("hidden", !active);
      tracking.classList.toggle("flex", active);
    },
    get helpOpen() {
      return helpShown;
    },
    setHelpOpen,
    get licensesOpen() {
      return licensesShown;
    },
    setLicensesOpen,
  };
}
