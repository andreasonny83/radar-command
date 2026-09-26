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
import { POINTER_CONTROLS, SHORTCUT_GROUPS, shortcutHint } from "../input/shortcuts";
import { GITHUB_REPO_URL } from "./links";

/** "Landed" counter, top-left. */
export function scorePanelMarkup(): string {
  return `
    <div class="pointer-events-none absolute top-4 left-4 z-10">
      <div
        data-arrow-avoid
        class="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 shadow-lg backdrop-blur-sm"
      >
        <span class="text-sm font-bold tracking-wider text-slate-400 uppercase">Landed</span>
        <div id="scoreDisplay" class="glow-text text-3xl font-black text-sky-400">0</div>
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

/** Camera controls (buttons only: every drag on the canvas draws a path). */
export function cameraControlsMarkup(): string {
  return `
    <div
      data-arrow-avoid
      class="absolute right-4 bottom-4 z-10 flex gap-2"
      aria-label="Camera controls"
    >
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

/**
 * Start / game-over overlay. The game-over variant (text, and a see-through
 * backdrop so the crash stays visible) is patched in by `showGameOver`; keep
 * the backdrop classes here in sync with `START_BACKDROP` in hud.ts.
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
      <button
        id="startBtn"
        class="transform rounded-full bg-sky-500 px-8 py-4 text-xl font-bold text-slate-950 shadow-[0_0_20px_rgba(14,165,233,0.5)] transition-all hover:scale-105 hover:bg-sky-400 active:scale-95"
      >
        START SHIFT
      </button>
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

/**
 * "GitHub · Send feedback" links, on the start / game-over overlay and at
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
            <li>New runways open as your score grows. If two planes touch, the shift is over.</li>
          </ul>
          <div class="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <section>
              ${helpHeadingMarkup("Mouse &amp; touch")}
              <ul class="divide-y divide-slate-800">${pointer}</ul>
            </section>
            ${keyboard}
          </div>
        </div>
        <footer class="border-t border-slate-800 px-6 py-3">${projectLinksMarkup()}</footer>
      </div>
    </div>`;
}

/** The whole HUD, in stacking order (help button and panel last, on top). */
export function hudMarkup(): string {
  return [
    arrivalLayerMarkup(),
    scorePanelMarkup(),
    pauseButtonMarkup(),
    pausedBannerMarkup(),
    toastMarkup(),
    trackingIndicatorMarkup(),
    cameraControlsMarkup(),
    overlayMarkup(),
    helpButtonMarkup(),
    helpPanelMarkup(),
  ].join("");
}
