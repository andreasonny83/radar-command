/**
 * HUD markup, one template per element.
 *
 * Lives in TypeScript rather than index.html so the game (via `createHud`)
 * and Storybook (src/ui/hud.stories.ts) render the exact same elements:
 * tweak a class here and both update. Tailwind picks up the class names
 * from this file like any other source file.
 *
 * Templates are static strings: anything dynamic (score, toast text, pause
 * state) is filled in by `hud.ts` at runtime. Key hints in tooltips and the
 * help panel come from the shortcut table in input/shortcuts.ts.
 */
import { ALL_TIME_MAX, BOARD_LABELS, BOARDS, NAME_MAX } from "../core/leaderboard";
import { DEPARTURE_POINTS, LANDING_POINTS, SECONDS_PER_TIME_POINT } from "../core/scoring";
import { POINTER_CONTROLS, SHORTCUT_GROUPS, shortcutHint } from "../input/shortcuts";
import { CC0_TEXT, GPL_TEXT, RECORDINGS, SOURCE_URL, THIRD_PARTY } from "./licenses";
import { GITHUB_REPO_URL } from "./links";

/**
 * Score, top-left: the total (core/scoring.ts `scoreOf`), a small
 * "landed · departed" line under it, then the time of day (a sun or a moon
 * and the 24 h clock, both `flex` so no line box pads them and the icon
 * sits level with the middle of the digits). `hud.setScore` and `hud.setClock` fill them in.
 */
export function scorePanelMarkup(): string {
  return `
    <div class="pointer-events-none absolute top-4 left-4 z-10">
      <div
        data-arrow-avoid
        class="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 shadow-lg backdrop-blur-sm"
      >
        <span class="text-sm font-bold tracking-wider text-slate-400 uppercase">Score</span>
        <div id="scoreDisplay" class="glow-text text-3xl font-black text-sky-400 tabular-nums">0</div>
        <div id="scoreBreakdown" class="text-xs font-bold text-slate-400 tabular-nums">
          0 landed · 0 departed
        </div>
        <div class="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-300 tabular-nums">
          <span id="clockIcon" class="flex text-amber-300" title="Day">${CLOCK_ICONS.sun}</span>
          <span id="clockTime" class="flex">08:00</span>
        </div>
      </div>
    </div>`;
}

/**
 * Pause / continue, top-right, left of the help button. Hidden until a
 * shift starts (see `setPhase`).
 */
export function pauseButtonMarkup(): string {
  return `
    <div class="absolute top-4 right-18 z-10">
      <button
        id="pauseBtn"
        data-arrow-avoid
        class="hud-button hidden"
        title="Pause (${shortcutHint("togglePause")})"
        aria-label="Pause"
        aria-pressed="false"
      >
        ⏸
      </button>
    </div>`;
}

/**
 * Game speed button, top-right, left of pause: shows the current multiplier
 * (1×, 1.5×, 2×, 3×) and cycles to the next on click. Hidden until a shift
 * starts (see `setPhase`); `hud.setSpeed` sets the label.
 */
export function speedButtonMarkup(): string {
  return `
    <div class="absolute top-4 right-32 z-10">
      <button
        id="speedBtn"
        data-arrow-avoid
        class="hud-button hidden min-w-12 text-sm"
        title="Game speed (1 / 2 / 3 / 4)"
        aria-label="Game speed"
      >
        1×
      </button>
    </div>`;
}

/** Paused banner: pointer-events-none so the camera buttons still work. */
export function pausedBannerMarkup(): string {
  return `
    <div
      id="pausedBanner"
      class="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center"
    >
      <div
        class="rounded-2xl border border-slate-700 bg-slate-900/70 px-8 py-4 text-center shadow-lg backdrop-blur-sm"
      >
        <div class="glow-text text-4xl font-black tracking-widest text-sky-400">PAUSED</div>
        <div class="mt-1 text-sm text-slate-300">Press ▶, P, Esc or Space to continue</div>
      </div>
    </div>`;
}

/** Toast: short notices such as "BLUE runway open"; fades via opacity. */
export function toastMarkup(): string {
  return `
    <div class="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
      <div
        id="toast"
        role="status"
        aria-live="polite"
        class="rounded-2xl border border-slate-700 bg-slate-900/70 px-6 py-2 text-lg font-black tracking-widest uppercase opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-500"
      ></div>
    </div>`;
}

/**
 * Speaker with sound waves, for the sound button. An SVG in currentColor
 * rather than an emoji, so it matches the music note in size and colour
 * and dims with `.hud-button-off` like any text glyph.
 */
const SOUND_ICON = `
  <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>`;

/**
 * Sun and moon for the HUD clock (same stroke style, smaller). Used before
 * this point in the file, but only at runtime (after module init).
 */
export const CLOCK_ICONS = {
  sun: `
  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" fill="currentColor" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
  </svg>`,
  moon: `
  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>`,
};

/** Beamed pair of eighth notes, for the music button (same style as SOUND_ICON). */
const MUSIC_ICON = `
  <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 17.5V6l10-2v11.5" />
    <circle cx="6.5" cy="17.5" r="2.5" fill="currentColor" />
    <circle cx="16.5" cy="15.5" r="2.5" fill="currentColor" />
  </svg>`;

/**
 * Sound on / off, first in the bottom-right button row (with the camera
 * buttons). `hud.setMuted` dims it (`.hud-button-off` in style.css) while
 * the sound is off, the same look as the music button.
 */
export function soundButtonMarkup(): string {
  return `
      <button
        id="soundBtn"
        class="hud-button"
        title="Sound off (${shortcutHint("toggleSound")})"
        aria-label="Sound"
        aria-pressed="true"
      >
        ${SOUND_ICON}
      </button>`;
}

/**
 * Music on / off, next to the sound button. `hud.setMusicOn` dims it
 * (`.hud-button-off` in style.css) while the music is off.
 */
export function musicButtonMarkup(): string {
  return `
      <button
        id="musicBtn"
        class="hud-button"
        title="Music off (${shortcutHint("toggleMusic")})"
        aria-label="Music"
        aria-pressed="true"
      >
        ${MUSIC_ICON}
      </button>`;
}

/**
 * Bottom-right button row: sound and music, then the camera controls
 * (buttons only: every drag on the canvas draws a path).
 */
export function cameraControlsMarkup(): string {
  return `
    <div
      data-arrow-avoid
      class="absolute right-4 bottom-4 z-10 flex gap-2"
      aria-label="Sound, music and camera controls"
    >
      ${soundButtonMarkup()}
      ${musicButtonMarkup()}
      <span class="w-1" aria-hidden="true"></span>
      <button
        id="rotateLeftBtn"
        class="hud-button"
        title="Rotate left (${shortcutHint("rotateLeft")})"
        aria-label="Rotate left"
      >
        ⟲
      </button>
      <button
        id="rotateRightBtn"
        class="hud-button"
        title="Rotate right (${shortcutHint("rotateRight")})"
        aria-label="Rotate right"
      >
        ⟳
      </button>
      <button
        id="zoomOutBtn"
        class="hud-button"
        title="Zoom out (${shortcutHint("zoomOut")})"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        id="zoomInBtn"
        class="hud-button"
        title="Zoom in (${shortcutHint("zoomIn")})"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>`;
}

/**
 * "Track plane" badge, bottom-left: shown while the camera follows a plane
 * (right-click one), with a blinking red dot (`.tracking-dot` in style.css)
 * and how to leave the mode. Hidden until `setTracking(true)`; arrival
 * arrows slide clear of it while it shows. On narrow screens it sits above
 * the camera buttons instead of beside them.
 */
export function trackingIndicatorMarkup(): string {
  return `
    <div
      id="trackingIndicator"
      data-arrow-avoid
      role="status"
      class="pointer-events-none absolute bottom-4 left-4 z-10 hidden max-w-[calc(100%-2rem)] items-center max-sm:bottom-18 gap-3 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 shadow-lg backdrop-blur-sm"
    >
      <span class="tracking-dot h-3 w-3 shrink-0 rounded-full bg-red-500"></span>
      <div>
        <div class="text-sm font-bold tracking-wider text-red-400 uppercase">
          Track plane active
        </div>
        <div class="text-xs text-slate-300">
          Right-click or X to return to the map · F for the next plane
        </div>
      </div>
    </div>`;
}

/**
 * Layer for arrival arrows (see arrivalArrows.ts). Below the other HUD
 * panels; arrows slide out from under any element marked
 * `data-arrow-avoid` (score, pause, camera buttons, tracking badge), so neither hides the other.
 */
export function arrivalLayerMarkup(): string {
  return `
    <div
      id="arrivals"
      class="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      aria-hidden="true"
    ></div>`;
}

/**
 * One arrival arrow, pinned to the screen edge where an off-screen plane
 * will fly in. Drawn pointing right (+x); `arrivalArrows.ts` positions the
 * wrapper and rotates the SVG to the plane's direction of travel, and sets
 * `color` to the plane's runway colour (the SVG paints in currentColor).
 */
export function arrivalArrowMarkup(): string {
  return `
    <div class="arrival-arrow absolute top-0 left-0 -mt-6 -ml-6 h-12 w-12 drop-shadow-lg">
      <svg viewBox="-24 -24 48 48" class="h-full w-full overflow-visible">
        <circle class="arrival-ring" r="17" fill="none" stroke="currentColor" stroke-width="3" />
        <circle r="14" fill="#0f172a" fill-opacity="0.55" />
        <path
          d="M 13 0 L 2 -10 L 2 -4 L -11 -4 L -11 4 L 2 4 L 2 10 Z"
          fill="currentColor"
          stroke="#f8fafc"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </div>`;
}

/** Trophy (cup with handles on a stand), for the leaderboard button and link. */
const TROPHY_ICON = `
  <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6H4a3 3 0 0 0 3.5 3.5M17 6h3a3 3 0 0 1-3.5 3.5" />
    <path d="M12 14v4M8 20h8" />
  </svg>`;

/**
 * Game-over leaderboard form: nickname (`NAME_RULE` in core/leaderboard.ts,
 * prefilled from the last one used), SUBMIT and a status line for the
 * result ("#4 today · …") or what went wrong. Hidden on the title screen;
 * `showGameOver` shows it and `setSubmitState` (hud.ts) drives it.
 */
export function submitFormMarkup(): string {
  return `
      <form id="submitForm" class="mb-6 hidden w-full max-w-md flex-col items-center gap-2 px-4" novalidate>
        <label for="playerName" class="text-xs font-bold tracking-widest text-slate-400 uppercase">
          Put your shift on the leaderboard
        </label>
        <div class="flex w-full gap-2">
          <input
            id="playerName"
            name="name"
            maxlength="${NAME_MAX}"
            autocomplete="nickname"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Your name"
            class="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-2 text-lg font-bold text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none disabled:opacity-50"
          />
          <button
            id="submitBtn"
            type="submit"
            class="shrink-0 rounded-xl bg-amber-400 px-4 py-2 font-bold text-slate-950 transition hover:bg-amber-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-400"
          >
            SUBMIT SCORE
          </button>
        </div>
        <p id="submitStatus" role="status" aria-live="polite" class="min-h-5 text-center text-sm text-slate-400"></p>
      </form>`;
}

/**
 * Game-over score sheet: one row per part of the score (landed, departed,
 * time; see core/scoring.ts) and the total. Hidden on the title screen;
 * `showGameOver` (hud.ts) fills the rows in and shows it.
 */
export function scoreSummaryMarkup(): string {
  return `
      <dl
        id="scoreSummary"
        class="mb-6 hidden w-full max-w-xs grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-1 px-4 text-slate-300 tabular-nums"
      ></dl>`;
}

/**
 * Start / game-over overlay. The game-over variant (text, the leaderboard
 * form, and a see-through backdrop so the crash stays visible) is patched
 * in by `showGameOver`; keep the backdrop classes here in sync with
 * `START_BACKDROP` in hud.ts.
 */
export function overlayMarkup(): string {
  return `
    <div
      id="overlay"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md transition-opacity duration-300"
    >
      <h1 id="overlayTitle" class="glow-text mb-4 text-5xl font-black text-sky-400 md:text-6xl">
        RADAR COMMAND
      </h1>
      <p id="overlayMessage" class="mb-8 max-w-md px-4 text-center text-lg text-slate-300">
        Drag a path from the airplanes to their matching colored runways. Land them over the colored
        threshold, following the arrow. Don't let them crash!
      </p>
      <p class="-mt-4 mb-8 text-sm text-slate-400">
        Press <kbd class="kbd">H</kbd> or <span class="font-bold text-slate-300">?</span> for
        controls &amp; shortcuts
      </p>
      ${scoreSummaryMarkup()}
      ${submitFormMarkup()}
      <div class="flex flex-wrap items-center justify-center gap-3">
        <button
          id="startBtn"
          class="transform rounded-full bg-sky-500 px-8 py-4 text-xl font-bold text-slate-950 shadow-[0_0_20px_rgba(14,165,233,0.5)] transition-all hover:scale-105 hover:bg-sky-400 active:scale-95"
        >
          START SHIFT
        </button>
        <button
          id="leaderboardBtn"
          class="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/70 px-6 py-4 text-lg font-bold text-slate-200 transition-all hover:scale-105 hover:border-amber-300 hover:text-amber-300 active:scale-95"
          title="Leaderboard (${shortcutHint("toggleLeaderboard")})"
          aria-haspopup="dialog"
          aria-controls="leaderboardPanel"
        >
          ${TROPHY_ICON}LEADERBOARD
        </button>
      </div>
      <div class="mt-8">${projectLinksMarkup()}</div>
    </div>`;
}

/** GitHub's "mark" logo (Octicons), painted in currentColor. */
const GITHUB_ICON = `
  <svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true">
    <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
  </svg>`;

/** Speech bubble (Octicons "comment"), painted in currentColor. */
const FEEDBACK_ICON = `
  <svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true">
    <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
  </svg>`;

/** Scales of justice (Octicons "law"), painted in currentColor. */
const LICENSE_ICON = `
  <svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true">
    <path d="M8.75.75V2h.985c.304 0 .603.08.867.231l1.29.736c.038.022.08.033.124.033h2.234a.75.75 0 0 1 0 1.5h-.427l2.111 4.692a.75.75 0 0 1-.154.838l-.53-.53.529.531-.001.002-.002.002-.006.006-.006.005-.01.01-.045.04c-.21.176-.441.327-.686.45C14.556 10.78 13.88 11 13 11a4.498 4.498 0 0 1-2.023-.454 3.544 3.544 0 0 1-.686-.45l-.045-.04-.016-.015-.006-.006-.004-.004v-.001a.75.75 0 0 1-.154-.838L12.178 4.5h-.162c-.305 0-.604-.079-.868-.231l-1.29-.736a.245.245 0 0 0-.124-.033H8.75V13h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5V3.5h-.984a.245.245 0 0 0-.124.033l-1.289.737c-.265.15-.564.23-.869.23h-.162l2.112 4.692a.75.75 0 0 1-.154.838l-.53-.53.529.531-.001.002-.002.002-.006.006-.016.015-.045.04c-.21.176-.441.327-.686.45C4.556 10.78 3.88 11 3 11a4.498 4.498 0 0 1-2.023-.454 3.544 3.544 0 0 1-.686-.45l-.045-.04-.016-.015-.006-.006-.004-.004v-.001a.75.75 0 0 1-.154-.838L2.178 4.5H1.75a.75.75 0 0 1 0-1.5h2.234a.249.249 0 0 0 .125-.033l1.288-.737c.265-.15.564-.23.869-.23h.984V.75a.75.75 0 0 1 1.5 0Zm2.945 8.477c.285.135.718.273 1.305.273s1.02-.138 1.305-.273L13 6.327Zm-10 0c.285.135.718.273 1.305.273s1.02-.138 1.305-.273L3 6.327Z" />
  </svg>`;

/**
 * "GitHub · Send feedback · Licenses" links, on the start / game-over overlay and at
 * the foot of the help panel (so they're reachable mid-shift too: opening
 * help pauses the game). Both open in a new tab, leaving the game as it
 * was. The feedback link's static href is a blank new-issue form; `hud.ts`
 * swaps in a pre-filled one (links.ts `feedbackIssueUrl`) on click, via the
 * `data-feedback-link` attribute (an attribute, not an id: the markup
 * appears twice).
 */
export function projectLinksMarkup(): string {
  return `
    <nav class="flex items-center justify-center gap-2 text-slate-600" aria-label="Project links">
      <a
        class="hud-link"
        href="${GITHUB_REPO_URL}"
        target="_blank"
        rel="noopener noreferrer"
        title="Source code on GitHub (opens in a new tab)"
      >
        ${GITHUB_ICON}<span>GitHub</span>
      </a>
      <span aria-hidden="true">·</span>
      <a
        class="hud-link"
        data-feedback-link
        href="${GITHUB_REPO_URL}/issues/new"
        target="_blank"
        rel="noopener noreferrer"
        title="Report a bug or suggest an idea on GitHub (opens in a new tab)"
      >
        ${FEEDBACK_ICON}<span>Send feedback</span>
      </a>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        class="hud-link"
        data-licenses-link
        aria-haspopup="dialog"
        aria-controls="licensesPanel"
        title="Open-source licenses of the game and its components"
      >
        ${LICENSE_ICON}<span>Licenses</span>
      </button>
    </nav>`;
}

/**
 * "?" button, top-right: opens the help panel. Stacks above the start /
 * game-over overlay (z-30), so the controls are one click away on every
 * screen.
 */
export function helpButtonMarkup(): string {
  return `
    <div class="absolute top-4 right-4 z-30">
      <button
        id="helpBtn"
        data-arrow-avoid
        class="hud-button"
        title="How to play &amp; controls (${shortcutHint("toggleHelp")})"
        aria-label="How to play and controls"
        aria-haspopup="dialog"
        aria-controls="helpPanel"
        aria-expanded="false"
      >
        ?
      </button>
    </div>`;
}

/** One key cap per alternative, e.g. [P] or [Esc] or [Space]. */
function capsMarkup(caps: readonly string[]): string {
  return caps
    .map((cap) => `<kbd class="kbd">${cap}</kbd>`)
    .join(`<span class="px-1 text-xs text-slate-500">or</span>`);
}

/** A two-column list: what you press (left), what it does (right). */
function controlRowsMarkup(rows: ReadonlyArray<{ keys: string; description: string }>): string {
  return rows
    .map(
      (row) => `
        <li class="flex items-center justify-between gap-4 py-1.5">
          <span class="text-slate-300">${row.description}</span>
          <span class="flex shrink-0 flex-wrap items-center justify-end">${row.keys}</span>
        </li>`,
    )
    .join("");
}

/** Section heading inside the help panel. */
function helpHeadingMarkup(title: string): string {
  return `<h3 class="mb-1 text-xs font-bold tracking-widest text-sky-400 uppercase">${title}</h3>`;
}

/**
 * Help panel: how to play, mouse/touch controls and every keyboard
 * shortcut. Rows are generated from input/shortcuts.ts, so adding a
 * shortcut there lists it here. Hidden until `hud.setHelpOpen(true)`;
 * opening it mid-shift pauses the game (main.ts). Clicking the backdrop,
 * the ✕ button, H, ? or Esc closes it.
 */
export function helpPanelMarkup(): string {
  const keyboard = SHORTCUT_GROUPS.map(
    (group) => `
      <section>
        ${helpHeadingMarkup(group.title)}
        <ul class="divide-y divide-slate-800">
          ${controlRowsMarkup(
            group.shortcuts.map((s) => ({ keys: capsMarkup(s.caps), description: s.description })),
          )}
        </ul>
      </section>`,
  ).join("");
  const pointer = controlRowsMarkup(
    POINTER_CONTROLS.map((c) => ({
      keys: `<span class="text-sm font-semibold text-slate-200">${c.input}</span>`,
      description: c.description,
    })),
  );
  return `
    <div
      id="helpPanel"
      class="absolute inset-0 z-40 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="helpTitle"
        class="relative flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl"
      >
        <header class="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 id="helpTitle" class="glow-text text-2xl font-black tracking-wider text-sky-400">
            HOW TO PLAY
          </h2>
          <button id="helpCloseBtn" class="hud-button h-9 w-9 text-base" title="Close (Esc)" aria-label="Close help">
            ✕
          </button>
        </header>
        <div class="overflow-y-auto px-6 py-4">
          <ul class="mb-5 list-disc space-y-1 pl-5 text-slate-300">
            <li>Planes fly in from the edges; an arrow on the screen edge warns where.</li>
            <li>
              Drag a path from each plane to the runway of its
              <span class="font-bold text-slate-100">colour</span>.
            </li>
            <li>
              It lands only if it crosses the coloured threshold in the direction of the runway
              arrow. From the wrong end it just flies on; if the runway is busy it goes around.
            </li>
            <li>
              New runways open as you land more planes. If two planes touch, the shift is over.
            </li>
            <li>
              Later on, <span class="font-bold text-violet-400">violet</span> planes take off from
              the airports, following a dotted route you can't change. While one uses a runway,
              arrivals there go around; once airborne, keep your planes clear of it.
            </li>
            <li>
              Score: ${LANDING_POINTS} points a landing, ${DEPARTURE_POINTS} a departure that clears
              the airspace, and 1 for every ${SECONDS_PER_TIME_POINT} seconds once a second runway
              is open.
            </li>
          </ul>
          <div class="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <section>
              ${helpHeadingMarkup("Mouse &amp; touch")}
              <ul class="divide-y divide-slate-800">${pointer}</ul>
            </section>
            ${keyboard}
          </div>
        </div>
        <footer class="flex flex-wrap items-center justify-center gap-2 border-t border-slate-800 px-6 py-3 text-slate-600">
          <button
            type="button"
            class="hud-link"
            data-leaderboard-link
            aria-haspopup="dialog"
            aria-controls="leaderboardPanel"
            title="Leaderboard (${shortcutHint("toggleLeaderboard")})"
          >
            ${TROPHY_ICON.replace("h-5 w-5", "h-4 w-4")}<span>Leaderboard</span>
          </button>
          <span aria-hidden="true">·</span>
          ${projectLinksMarkup()}
        </footer>
      </div>
    </div>`;
}

/**
 * Leaderboard panel (driven by ui/leaderboard.ts): a tab per board
 * (today / this week / all-time), the list, filled in at runtime, a
 * Prev / Next pager (shown only when the board has more than one page:
 * all-time holds up to `ALL_TIME_MAX` rows) and how the boards work. Opened by the LEADERBOARD button on the start and
 * game-over screens, the link in the help panel, L, or a submitted score.
 * Stacks above the help panel (z-50, before the licenses panel in the DOM).
 * The ✕ button, Esc, L or a click on the backdrop close it.
 */
export function leaderboardPanelMarkup(): string {
  const tabs = BOARDS.map(
    (board) => `
      <button
        type="button"
        role="tab"
        data-board="${board}"
        aria-selected="false"
        aria-controls="leaderboardBody"
        class="flex-1 rounded-lg px-3 py-1.5 text-sm font-bold tracking-wider text-slate-400 uppercase transition hover:text-slate-100 aria-selected:bg-sky-500 aria-selected:text-slate-950"
      >
        ${BOARD_LABELS[board]}
      </button>`,
  ).join("");
  return `
    <div
      id="leaderboardPanel"
      class="absolute inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboardTitle"
        class="relative flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl"
      >
        <header class="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 id="leaderboardTitle" class="glow-text flex items-center gap-2 text-2xl font-black tracking-wider text-sky-400">
            ${TROPHY_ICON.replace("h-5 w-5", "h-6 w-6")}LEADERBOARD
          </h2>
          <button id="leaderboardCloseBtn" class="hud-button h-9 w-9 text-base" title="Close (Esc)" aria-label="Close leaderboard">
            ✕
          </button>
        </header>
        <div role="tablist" aria-label="Boards" class="mx-6 mt-4 flex gap-1 rounded-xl border border-slate-700 bg-slate-950/60 p-1">
          ${tabs}
        </div>
        <div
          id="leaderboardBody"
          role="tabpanel"
          aria-live="polite"
          class="min-h-[26rem] overflow-y-auto px-3 pb-4 sm:px-6"
        ></div>
        <nav
          id="leaderboardPager"
          aria-label="Pages"
          class="hidden items-center justify-between gap-3 border-t border-slate-800 px-6 py-2"
        >
          <button id="leaderboardPrevBtn" type="button" class="hud-button h-8 w-auto px-3 text-xs tracking-wider disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-800/80 disabled:active:scale-100" title="Previous page (PgUp)">
            ‹ PREV
          </button>
          <span id="leaderboardPageLabel" class="font-mono text-xs text-slate-400 tabular-nums" aria-live="polite"></span>
          <button id="leaderboardNextBtn" type="button" class="hud-button h-8 w-auto px-3 text-xs tracking-wider disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-800/80 disabled:active:scale-100" title="Next page (PgDn)">
            NEXT ›
          </button>
        </nav>
        <footer class="border-t border-slate-800 px-6 py-3 text-center text-xs text-slate-500">
          Each player's best shift · All-time: top ${ALL_TIME_MAX} · Today and this week restart at 00:00 UTC (weeks on Monday)
        </footer>
      </div>
    </div>`;
}

/** Whole seconds as m:ss (or h:mm:ss past the hour). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const ss = String(s % 60).padStart(2, "0");
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${ss}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss}`;
}

/** `text` made safe to place inside markup (text or an attribute value). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Licenses panel: how the game is licensed (the project's own code is ISC;
 * the game as served bundles the GPL-3.0 speech engine, so the whole is
 * conveyed under GPL-3.0), a notice per bundled component, and the full
 * license texts. Data and reasoning in ui/licenses.ts; the texts are filled
 * in by hud.ts (`[data-license-text]` elements, fetched when shown).
 * Stacks above the help panel (z-50), which links to it. The ✕ button,
 * Esc or a click on the backdrop close it.
 */
export function licensesPanelMarkup(): string {
  const notices = THIRD_PARTY.map(
    (n) => `
      <li class="py-3">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4">
          <a class="font-semibold text-slate-100 underline decoration-slate-600 hover:text-sky-300" href="${n.url}" target="_blank" rel="noopener noreferrer">${n.name}</a>
          <span class="rounded-md border border-slate-600 px-1.5 font-mono text-xs text-slate-300">${n.license}</span>
        </div>
        <div class="text-sm text-slate-400">${n.role}</div>
        <div class="text-xs text-slate-500">${n.copyright}</div>
        <details class="mt-1 text-xs">
          <summary class="cursor-pointer text-slate-400 hover:text-sky-300">License text</summary>
          <pre data-license-text="${n.text}" class="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950/60 p-3 whitespace-pre-wrap text-slate-400">Loading…</pre>
        </details>
      </li>`,
  ).join("");
  // Titles and names come from Freesound: escaped, not trusted as markup.
  const recordings = RECORDINGS.map(
    (r) => `
      <li class="py-2">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4">
          <a class="font-semibold text-slate-100 underline decoration-slate-600 hover:text-sky-300" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a>
          <a class="rounded-md border border-slate-600 px-1.5 font-mono text-xs text-slate-300 hover:text-sky-300" href="${escapeHtml(r.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.license)}</a>
        </div>
        <div class="text-sm text-slate-400">by ${escapeHtml(r.author)}</div>
        <div class="text-xs text-slate-500">${escapeHtml(r.changes)}: ${r.files.map(escapeHtml).join(", ")}</div>
      </li>`,
  ).join("");
  return `
    <div
      id="licensesPanel"
      class="absolute inset-0 z-50 hidden items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="licensesTitle"
        class="relative flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl"
      >
        <header class="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 id="licensesTitle" class="glow-text text-2xl font-black tracking-wider text-sky-400">
            LICENSES
          </h2>
          <button id="licensesCloseBtn" class="hud-button h-9 w-9 text-base" title="Close (Esc)" aria-label="Close licenses">
            ✕
          </button>
        </header>
        <div class="space-y-5 overflow-y-auto px-6 py-4 text-slate-300">
          <section class="space-y-2">
            <p>
              Radar Command's own source code is free software under the
              <span class="font-semibold text-slate-100">ISC license</span> (below).
            </p>
            <p>
              The game as you're playing it also includes
              <span class="font-semibold text-slate-100">eSpeak NG</span>, the speech synthesiser
              that voices the terminal announcements. It is licensed under the
              <span class="font-semibold text-slate-100">GNU General Public License, version 3</span>,
              so the game as a whole is distributed under the terms of the GPL-3.0 (full text
              below). You may copy, modify and share it under those terms.
            </p>
            <p>
              Complete source code:
              <a class="text-sky-300 underline" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">${SOURCE_URL.replace("https://", "")}</a>.
            </p>
          </section>
          <section>
            ${helpHeadingMarkup("This project (ISC)")}
            <pre id="projectLicenseText" class="max-h-48 overflow-auto rounded-lg bg-slate-950/60 p-3 text-xs whitespace-pre-wrap text-slate-400"></pre>
          </section>
          <section>
            ${helpHeadingMarkup("Third-party components")}
            <ul class="divide-y divide-slate-800">${notices}</ul>
          </section>
          <section>
            ${helpHeadingMarkup("Sound recordings")}
            <p class="text-sm">
              The planes' engines, runway and gear sounds, the fly-bys and the terminal are
              cut from real field recordings shared on
              <a class="text-sky-300 underline" href="https://freesound.org" target="_blank" rel="noopener noreferrer">Freesound</a>,
              all dedicated to the public domain (CC0 1.0). Thank you to everyone who recorded them.
            </p>
            <ul class="divide-y divide-slate-800">${recordings}</ul>
            <details class="mt-1 text-xs">
              <summary class="cursor-pointer text-slate-400 hover:text-sky-300">CC0 1.0 legal code</summary>
              <pre data-license-text="${CC0_TEXT}" class="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950/60 p-3 whitespace-pre-wrap text-slate-400">Loading…</pre>
            </details>
          </section>
          <section>
            ${helpHeadingMarkup("GNU General Public License v3.0")}
            <pre data-license-text="${GPL_TEXT}" class="max-h-96 overflow-auto rounded-lg bg-slate-950/60 p-3 text-xs whitespace-pre-wrap text-slate-400">Loading…</pre>
          </section>
        </div>
      </div>
    </div>`;
}

/** The whole HUD, in stacking order (help button and panel last, on top). */
export function hudMarkup(): string {
  return [
    arrivalLayerMarkup(),
    scorePanelMarkup(),
    speedButtonMarkup(),
    pauseButtonMarkup(),
    pausedBannerMarkup(),
    toastMarkup(),
    trackingIndicatorMarkup(),
    cameraControlsMarkup(),
    overlayMarkup(),
    helpButtonMarkup(),
    helpPanelMarkup(),
    leaderboardPanelMarkup(),
    licensesPanelMarkup(),
  ].join("");
}
