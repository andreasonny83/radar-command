/**
 * HTML HUD layered over the canvas: score, start/game-over overlay, pause
 * button, toast notices, arrival arrows, the "track plane" badge, the
 * sound, music and camera buttons, the collision-risk list, the help button + panel, the GitHub /
 * feedback / licenses links, the licenses panel, and the leaderboard (the
 * game-over submit form and the boards panel, see ui/leaderboard.ts).
 * Markup lives in hudMarkup.ts (shared with Storybook); this module injects
 * and wires it up.
 */
import { COLOR_HEX } from "../config";
import { REROUTE_MIN_CONFIDENCE, severityLevel, type AdviceVerdict } from "../core/conflictAdvice";
import { conflictKey, type Conflict } from "../core/conflicts";
import type { Board, BoardResponse } from "../core/leaderboard";
import {
  DEPARTURE_POINTS,
  LANDING_POINTS,
  scoreOf,
  timePoints,
  type ScoreBreakdown,
} from "../core/scoring";
import type { GamePhase } from "../core/types";
import { shortcutHint } from "../input/shortcuts";
import type { Result } from "../net/leaderboardApi";
import { createArrivalArrows, type ArrivalMarker } from "./arrivalArrows";
import { hudMarkup } from "./hudMarkup";
import { createClockDisplay, createClockIcon } from "./clockDisplay";
import { createScoreRoll } from "./scoreRoll";
import { createLeaderboardPanel, formatRanks, type SubmitState } from "./leaderboard";
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
  /**
   * SUBMIT pressed (or Enter in the name field) on the game-over screen,
   * with the name as typed. Optional: without it the form does nothing.
   */
  onSubmitScore?: (name: string) => void;
  /** Fetch a board for the leaderboard panel. Missing: it shows as offline. */
  loadBoard?: (board: Board) => Promise<Result<BoardResponse>>;
  /** Board tab the panel first opens on (the one last viewed). */
  initialBoard?: Board;
  /** The panel switched board tabs (to remember the choice). */
  onBoardChange?: (board: Board) => void;
  /** The leaderboard panel opened or closed (to pause the game, like help). */
  onLeaderboard?: (open: boolean) => void;
}

export interface Hud {
  /**
   * The score panel: the total (`scoreOf`) and the "landed · departed"
   * line. Cheap every frame (the time trickle moves the total without any
   * event): the DOM is only touched when something shown changes.
   */
  setScore(breakdown: ScoreBreakdown): void;
  /**
   * Time of day under the score: `hours` as HH:MM, and a moon once
   * `night` ≥ 0.5 (a sun before). Call it every frame, paused or not:
   * the minutes scroll between calls and settle once the clock stops (see
   * ui/clockDisplay.ts). At rest nothing in the DOM is touched.
   */
  setClock(hours: number, night: number): void;
  hideOverlay(): void;
  /**
   * Crash screen: the final score with its breakdown (landed, departed,
   * time), and the leaderboard form with `name` (the last one used) filled
   * in. Call `setSubmitState` next.
   */
  showGameOver(breakdown: ScoreBreakdown, name?: string): void;
  /** Drive the game-over leaderboard form (see `SubmitState`). */
  setSubmitState(state: SubmitState): void;
  /** Is the leaderboard panel showing? */
  readonly leaderboardOpen: boolean;
  /**
   * Open the leaderboard panel (on `board`, else the last tab) or close
   * it (fires `onLeaderboard` on change). Opening always reloads the board.
   */
  setLeaderboardOpen(open: boolean, board?: Board): void;
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
  /**
   * The predicted collisions (core/conflicts.ts `predictConflicts`), soonest
   * first; an empty list hides the panel. `advice` is Jev's verdict per
   * pair (keyed by `conflictKey`), when it has answered: a row then gains
   * an urgency tag and, if Jev is sure enough, which plane to redirect.
   * Cheap to call often: the DOM is only rebuilt when a row's planes,
   * whole-second countdown or advice change.
   */
  setConflicts(conflicts: readonly Conflict[], advice?: ReadonlyMap<string, AdviceVerdict>): void;
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

/** Status line colour for each game-over form state. */
const SUBMIT_TONES: Record<SubmitState["kind"], string> = {
  ready: "text-slate-400",
  unavailable: "text-slate-400",
  sending: "text-slate-400",
  done: "font-bold text-sky-300",
  error: "text-amber-300",
};

/** Urgency tag for each `severityLevel` (see core/conflictAdvice.ts): text and colour. */
const SEVERITY_TAGS = [
  { text: "MINOR", tone: "text-slate-300" },
  { text: "SOON", tone: "text-amber-300" },
  { text: "NOW", tone: "text-red-400" },
] as const;

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

/** Whole seconds as m:ss (or h:mm:ss past the hour). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const ss = String(s % 60).padStart(2, "0");
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${ss}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss}`;
}

/** One line of the game-over score sheet: label, how it adds up, points. */
function summaryRow(label: string, detail: string, points: number): string {
  return `
    <dt class="font-bold text-slate-400">${label}</dt>
    <dd class="text-right text-slate-400">${detail}</dd>
    <dd class="text-right font-black text-sky-300">${points}</dd>`;
}

/**
 * Inject the HUD markup at the start of `root` (so it stacks above a canvas
 * that follows it) and wire it to `callbacks`.
 */
export function createHud(root: HTMLElement, callbacks: HudCallbacks): Hud {
  root.insertAdjacentHTML("afterbegin", hudMarkup());
  // Scoped to `root` rather than `document`, so Storybook can mount a HUD
  // inside its own preview element.
  const byId = <T extends HTMLElement>(id: string): T => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`Missing #${id} in hudMarkup.ts`);
    return el;
  };
  // The total rolls on drums, one per digit (ui/scoreRoll.ts).
  const score = createScoreRoll(byId("scoreDisplay"));
  const scoreBreakdown = byId("scoreBreakdown");
  let breakdownText = "";
  const scoreSummary = byId("scoreSummary");
  const clockIcon = createClockIcon(byId("clockIcon"));
  // HH:MM, the hour sliding over as it changes (ui/clockDisplay.ts).
  const clockTime = createClockDisplay(byId("clockTime"));
  const overlay = byId("overlay");
  const title = byId("overlayTitle");
  const message = byId("overlayMessage");
  const startBtn = byId<HTMLButtonElement>("startBtn");
  const submitForm = byId<HTMLFormElement>("submitForm");
  const nameInput = byId<HTMLInputElement>("playerName");
  const submitBtn = byId<HTMLButtonElement>("submitBtn");
  const submitStatus = byId("submitStatus");
  const pauseBtn = byId<HTMLButtonElement>("pauseBtn");
  const pausedBanner = byId("pausedBanner");
  const toast = byId("toast");
  const tracking = byId("trackingIndicator");
  let trackingShown = false;
  const conflictPanel = byId("conflictPanel");
  const conflictList = byId("conflictList");
  let conflictRowsKey = "";
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

  // Leaderboard (ui/leaderboard.ts): the boards panel, opened from the
  // overlay's button and the help panel's link (on top of help), and the
  // game-over form that submits a run.
  const leaderboard = createLeaderboardPanel(root, {
    load: callbacks.loadBoard,
    initialBoard: callbacks.initialBoard,
    onBoardChange: callbacks.onBoardChange,
    onOpenChange: callbacks.onLeaderboard,
  });
  byId("leaderboardBtn").addEventListener("click", () => leaderboard.setOpen(true));
  root
    .querySelectorAll<HTMLElement>("[data-leaderboard-link]")
    .forEach((link) => link.addEventListener("click", () => leaderboard.setOpen(true)));
  submitForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!submitBtn.disabled) callbacks.onSubmitScore?.(nameInput.value);
  });
  // Esc in the name field just leaves it, so Enter / Space go back to
  // meaning "try again".
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") nameInput.blur();
  });
  const setSubmitState = (state: SubmitState) => {
    const editable = state.kind === "ready" || state.kind === "error";
    nameInput.disabled = !editable;
    submitBtn.disabled = !editable;
    submitBtn.textContent =
      state.kind === "sending"
        ? "SENDING…"
        : state.kind === "done"
          ? "SUBMITTED ✓"
          : state.kind === "error"
            ? "RETRY"
            : "SUBMIT SCORE";
    submitStatus.className = `min-h-5 text-center text-sm ${SUBMIT_TONES[state.kind]}`;
    submitStatus.textContent =
      state.kind === "done"
        ? formatRanks(state.ranks)
        : state.kind === "unavailable" || state.kind === "error"
          ? state.message
          : "";
    // Ready on a keyboard-and-mouse screen: straight into the name, so
    // Enter submits. (Touch screens would pop up a keyboard: no.)
    const visible = !submitForm.classList.contains("hidden");
    if (state.kind === "ready" && visible && matchMedia("(pointer: fine)").matches) {
      nameInput.focus();
    }
    if (!editable) nameInput.blur();
  };

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
    setScore(b) {
      score.set(scoreOf(b));
      const parts = `${b.landed} landed · ${b.departed} departed`;
      if (parts !== breakdownText) {
        breakdownText = parts;
        scoreBreakdown.textContent = parts;
      }
    },
    setClock(hours, night) {
      clockTime.set(hours);
      clockIcon.set(night >= 0.5);
    },
    hideOverlay() {
      overlay.classList.add("opacity-0", "pointer-events-none");
      // Nothing on the hidden overlay keeps focus (keys would type into it).
      nameInput.blur();
    },
    showGameOver(b, name = "") {
      title.textContent = "CRASH!";
      title.classList.replace("text-sky-400", "text-red-500");
      title.classList.replace("glow-text", "glow-text-red");
      message.textContent = `Score ${scoreOf(b)}`;
      message.classList.replace("text-lg", "text-3xl");
      message.classList.add("font-black", "text-slate-100");
      // Numbers only, so building the rows as HTML is safe.
      scoreSummary.innerHTML = [
        summaryRow("Landed", `${b.landed} × ${LANDING_POINTS}`, b.landed * LANDING_POINTS),
        summaryRow(
          "Departed",
          `${b.departed} × ${DEPARTURE_POINTS}`,
          b.departed * DEPARTURE_POINTS,
        ),
        summaryRow("Time", formatDuration(b.seconds), timePoints(b)),
      ].join("");
      scoreSummary.classList.replace("hidden", "grid");
      startBtn.textContent = "TRY AGAIN";
      nameInput.value = name;
      submitForm.classList.replace("hidden", "flex");
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
    setConflicts(conflicts, advice = new Map()) {
      // Whole seconds, so the list only redraws when something shown changes.
      const rows = conflicts.map((c) => {
        const verdict = advice.get(conflictKey(c));
        const level = verdict ? severityLevel(verdict.severity) : null;
        // Which plane to redirect, once Jev is sure enough to say.
        const redirect =
          verdict && verdict.rerouteConfidence >= REROUTE_MIN_CONFIDENCE
            ? verdict.reroute === "a"
              ? `#${c.planeIds[0]}`
              : verdict.reroute === "b"
                ? `#${c.planeIds[1]}`
                : "either"
            : null;
        return { c, secs: Math.max(1, Math.round(c.time)), level, redirect };
      });
      const key = rows
        .map((r) => `${conflictKey(r.c)}@${r.secs}/${r.level}/${r.redirect}`)
        .join(",");
      if (key === conflictRowsKey) return;
      conflictRowsKey = key;
      conflictPanel.classList.toggle("hidden", rows.length === 0);
      conflictList.replaceChildren(
        ...rows.map(({ c, secs, level, redirect }) => {
          const li = document.createElement("li");
          li.className = "flex flex-col";
          const line = document.createElement("div");
          line.className = "flex items-center gap-2";
          const dot = (color: string) => {
            const d = document.createElement("span");
            d.className = "h-3 w-3 shrink-0 rounded-full";
            d.style.backgroundColor = color;
            return d;
          };
          const label = document.createElement("span");
          label.textContent = `#${c.planeIds[0]} × #${c.planeIds[1]}`;
          const eta = document.createElement("span");
          eta.className = "ml-auto text-red-300";
          eta.textContent = `${secs}s`;
          line.append(dot(COLOR_HEX[c.colors[0]]), dot(COLOR_HEX[c.colors[1]]), label, eta);
          li.append(line);
          if (level !== null) {
            const tag = SEVERITY_TAGS[level];
            const note = document.createElement("div");
            note.className = `pl-10 text-xs font-bold ${tag.tone}`;
            note.textContent = redirect ? `${tag.text} · redirect ${redirect}` : tag.text;
            li.append(note);
          }
          return li;
        }),
      );
    },
    get helpOpen() {
      return helpShown;
    },
    setHelpOpen,
    get licensesOpen() {
      return licensesShown;
    },
    setLicensesOpen,
    setSubmitState,
    get leaderboardOpen() {
      return leaderboard.open;
    },
    setLeaderboardOpen: leaderboard.setOpen,
  };
}
