/**
 * The HUD's 24 h clock, HH:MM, as a neon seven-segment display:
 * - each digit is drawn from seven segments (`createSegmentDigit`, SVG, no
 *   font to load): the lit ones glow like neon tubes, the unlit ones stay
 *   faintly visible, as on a real digital clock;
 * - the glow grows as night falls (`setNight`), brightest in the dark;
 * - digits switch instantly, like any digital clock (a game minute lasts
 *   about 0.2 s, core/daytime.ts `DAY_SECONDS`);
 * - the colon blinks while the clock runs, and holds still once it stops
 *   (paused, crashed, or not started);
 * - at dusk and dawn the sun or moon icon beside it spins in
 *   (`createClockIcon`).
 *
 * Look: `.neon-clock` and `.seg` in style.css. The blink is skipped for
 * players who ask for reduced motion. The display is
 * `aria-hidden`; screen readers get a visually hidden "HH:MM".
 */

import { CLOCK_ICONS } from "./hudMarkup";

/** Minute of the day (0..1439) for a time of day in hours (wraps). */
function minuteOfDay(hours: number): number {
  return Math.floor((((hours % 24) + 24) % 24) * 60);
}

/** "HH:MM" for a time of day in hours (0 ≤ h < 24; wraps). */
export function formatClock(hours: number): string {
  const minute = minuteOfDay(hours);
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Does the player ask for less motion? */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The seven segments of a digit in a 12 × 20 box, in the order a b c d e f
 * g (top, top right, bottom right, bottom, bottom left, top left, middle).
 * Hexagonal bars with pointed ends, 2.2 thick, meeting with a small gap.
 */
const SEGMENTS: readonly string[] = [
  "1.6,1.1 2.7,0 9.3,0 10.4,1.1 9.3,2.2 2.7,2.2",
  "10.9,1.7 12,2.8 12,8.3 10.9,9.4 9.8,8.3 9.8,2.8",
  "10.9,10.6 12,11.7 12,17.2 10.9,18.3 9.8,17.2 9.8,11.7",
  "1.6,18.9 2.7,17.8 9.3,17.8 10.4,18.9 9.3,20 2.7,20",
  "1.1,10.6 2.2,11.7 2.2,17.2 1.1,18.3 0,17.2 0,11.7",
  "1.1,1.7 2.2,2.8 2.2,8.3 1.1,9.4 0,8.3 0,2.8",
  "1.6,10 2.7,8.9 9.3,8.9 10.4,10 9.3,11.1 2.7,11.1",
];

/** Lit segments per digit, as a string over a..g. */
const DIGIT_SEGMENTS: readonly string[] = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

interface SegmentDigit {
  root: SVGSVGElement;
  /** Light the segments of `digit` (0..9); no-op when it already shows. */
  set(digit: number): void;
}

/** A seven-segment digit showing 0. */
function createSegmentDigit(): SegmentDigit {
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("viewBox", "0 0 12 20");
  root.setAttribute("class", "seg-digit");
  const polygons = SEGMENTS.map((points) => {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", points);
    polygon.setAttribute("class", "seg");
    root.append(polygon);
    return polygon;
  });
  let shown = -1;
  const digit: SegmentDigit = {
    root,
    set(n) {
      if (n === shown) return;
      shown = n;
      const lit = DIGIT_SEGMENTS[n]!;
      polygons.forEach((polygon, i) =>
        polygon.classList.toggle("seg-on", lit.includes("abcdefg"[i]!)),
      );
    },
  };
  digit.set(0);
  return digit;
}

/**
 * The clock counts as stopped once its time hasn't moved for this long
 * (ms), and the colon stops blinking.
 */
const STOPPED_AFTER_MS = 150;

/**
 * Glow strength (`--neon` in style.css) by day and by full night. Neon
 * reads faint in daylight and blazes in the dark.
 */
const GLOW_DAY = 0.55;
const GLOW_NIGHT = 1.25;

export interface ClockDisplay {
  /**
   * Show `hours` (fractional, wraps at 24) as HH:MM. Call it every frame,
   * paused or not, so the colon knows when the clock stops. Nothing in the
   * DOM is touched unless the minute (or the running state) changed.
   */
  set(hours: number): void;
  /** Glow for how dark it is: `night` 0 (day) … 1 (full night). */
  setNight(night: number): void;
}

/** Replace `el`'s contents with the clock, showing 00:00. */
export function createClockDisplay(el: HTMLElement): ClockDisplay {
  const label = document.createElement("span");
  label.className = "sr-only";
  const display = document.createElement("span");
  display.className = "neon-clock";
  display.setAttribute("aria-hidden", "true");
  const hourTens = createSegmentDigit();
  const hourUnits = createSegmentDigit();
  const hourBox = document.createElement("span");
  hourBox.className = "neon-pair";
  hourBox.append(hourTens.root, hourUnits.root);
  const colon = document.createElement("span");
  colon.className = "seg-colon";
  const minuteTens = createSegmentDigit();
  const minuteUnits = createSegmentDigit();
  const minuteBox = document.createElement("span");
  minuteBox.className = "neon-pair";
  minuteBox.append(minuteTens.root, minuteUnits.root);
  display.append(hourBox, colon, minuteBox);
  el.replaceChildren(label, display);

  let shownMinute: number | null = null;
  let lastHours: number | null = null;
  let lastMove = -Infinity;
  let running = false;
  let glow = "";

  return {
    set(hours) {
      const now = performance.now();
      const first = lastHours === null;
      if (hours !== lastHours) lastMove = now;
      lastHours = hours;

      // Blink the colon while the clock runs.
      const isRunning = !first && now - lastMove < STOPPED_AFTER_MS;
      if (isRunning !== running) {
        running = isRunning;
        colon.classList.toggle("clock-colon-running", running);
      }

      const minute = minuteOfDay(hours);
      if (minute === shownMinute) return;
      shownMinute = minute;
      label.textContent = formatClock(hours);
      const h = Math.floor(minute / 60);
      const m = minute % 60;
      minuteTens.set(Math.floor(m / 10));
      minuteUnits.set(m % 10);
      hourTens.set(Math.floor(h / 10));
      hourUnits.set(h % 10);
    },
    setNight(night) {
      const n = Math.min(1, Math.max(0, night));
      const value = (GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * n).toFixed(2);
      if (value === glow) return;
      glow = value;
      display.style.setProperty("--neon", value);
    },
  };
}

export interface ClockIcon {
  /** Show the moon (`night`) or the sun; no-op when it already shows. */
  set(night: boolean): void;
}

/**
 * The sun / moon beside the clock (`#clockIcon`, whose markup starts on
 * the sun). Each swap after the first spins the new icon in, overshooting
 * a little.
 */
export function createClockIcon(el: HTMLElement): ClockIcon {
  let shown: boolean | null = null;
  return {
    set(night) {
      if (night === shown) return;
      const turned = shown !== null;
      shown = night;
      el.innerHTML = night ? CLOCK_ICONS.moon : CLOCK_ICONS.sun;
      el.title = night ? "Night" : "Day";
      el.classList.toggle("text-amber-300", !night);
      el.classList.toggle("text-sky-200", night);
      const icon = el.firstElementChild;
      if (!turned || !icon || !el.isConnected || prefersReducedMotion()) return;
      icon.animate(
        [
          { transform: "rotate(-150deg) scale(0.3)", opacity: 0 },
          { transform: "rotate(0) scale(1)", opacity: 1 },
        ],
        { duration: 600, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
      );
    },
  };
}
