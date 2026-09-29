/**
 * The HUD's 24 h clock, HH:MM, with motion suited to a fast clock
 * (core/daytime.ts `DAY_SECONDS`: a game minute lasts about 0.2 s, an hour
 * about 12.5 s):
 * - the minutes tick, stop and go: each game minute the last digit rests,
 *   then rolls over to the next numeral on its strip and stops again
 *   (`TICK_HOLD`), and the tens digit turns only while the last one
 *   carries (…9 → 0), as an odometer's does. When the clock stops (paused,
 *   crashed) they ease onto the whole minute;
 * - a new hour slides up into place as the old one slides out, fading;
 * - the colon blinks while the clock runs, and holds still once it stops;
 * - at dusk and dawn the sun or moon icon beside it spins in
 *   (`createClockIcon`).
 *
 * Motion is skipped for players who ask for reduced motion (the minutes
 * then step, the hour swaps). The moving parts are `aria-hidden`; screen
 * readers get a visually hidden "HH:MM".
 */

import { CLOCK_ICONS } from "./hudMarkup";

/** Minutes in a day. */
const DAY_MINUTES = 24 * 60;

/** Minute of the day (0..1439) for a time of day in hours (wraps). */
function minuteOfDay(hours: number): number {
  return Math.floor(fractionalMinute(hours));
}

/** Fractional minute of the day, [0, 1440), for a time of day in hours. */
function fractionalMinute(hours: number): number {
  return (((hours * 60) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
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

/** How long a new hour takes to slide in (ms). */
const HOUR_SLIDE_MS = 420;

/** Easing of the slide: quick start, soft landing. */
const HOUR_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The clock counts as stopped once its time hasn't moved for this long
 * (ms): the minutes settle on a whole minute and the colon stops blinking.
 */
const STOPPED_AFTER_MS = 150;

/**
 * Share of each game minute the minutes hold still before ticking over to
 * the next: stop, then go. The rest of the minute is the roll itself.
 */
const TICK_HOLD = 0.5;

/**
 * How quickly (per second) the shown minutes close on where they should
 * be. While the clock runs, fast enough to keep each tick's stop-and-go
 * shape (it only irons out uneven frames); once it stops, slower, for a
 * soft glide onto the whole minute.
 */
const TICK_FOLLOW_RATE = 60;
const SETTLE_FOLLOW_RATE = 18;

/** Ease in and out (cubic): the tick sets off gently and lands softly. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Where the minute strips stand at fractional minute `exact`: resting on
 * the whole minute for `TICK_HOLD` of it, then rolling over to the next.
 */
function tickPosition(exact: number): number {
  const whole = Math.floor(exact);
  const roll = Math.min(1, Math.max(0, (exact - whole - TICK_HOLD) / (1 - TICK_HOLD)));
  return whole + easeInOut(roll);
}

/**
 * A jump bigger than this (minutes) isn't the clock running but a new
 * shift or a catch-up: the minutes snap to it rather than scroll there.
 */
const MINUTE_SNAP = 30;

/** A strip of numerals behind a one-line window, scrolled to a fractional position. */
interface DigitStrip {
  root: HTMLElement;
  /** Show position `pos` (0 = the first numeral; fractions sit between two). */
  show(pos: number): void;
}

/**
 * A strip of `count` numerals (0 .. count − 1) plus a second 0 after the
 * last, so the step from the last numeral back to 0 scrolls forward like
 * the others.
 */
function createDigitStrip(count: number): DigitStrip {
  const root = document.createElement("span");
  root.className = "clock-digit";
  const strip = document.createElement("span");
  strip.className = "clock-strip";
  const faces = count + 1;
  for (let n = 0; n < faces; n++) {
    const face = document.createElement("span");
    face.textContent = String(n % count);
    strip.append(face);
  }
  root.append(strip);
  let shown = NaN;
  return {
    root,
    show(pos) {
      // Nothing to write while it rests (and 1/1000 of a numeral is invisible).
      const rounded = Math.round(pos * 1000) / 1000;
      if (rounded === shown) return;
      shown = rounded;
      strip.style.transform = `translateY(${(-rounded / faces) * 100}%)`;
    },
  };
}

export interface ClockDisplay {
  /**
   * Show `hours` (fractional, wraps at 24) as HH:MM. Call it every frame,
   * paused or not: the minutes scroll and settle over successive calls.
   */
  set(hours: number): void;
}

/** Replace `el`'s contents with the clock, showing 00:00. */
export function createClockDisplay(el: HTMLElement): ClockDisplay {
  const label = document.createElement("span");
  label.className = "sr-only";
  const face = document.createElement("span");
  face.setAttribute("aria-hidden", "true");
  const hourBox = document.createElement("span");
  hourBox.className = "clock-hour";
  let hour = document.createElement("span");
  hour.textContent = "00";
  hourBox.append(hour);
  const colon = document.createElement("span");
  colon.textContent = ":";
  const tens = createDigitStrip(6);
  const units = createDigitStrip(10);
  face.append(hourBox, colon, tens.root, units.root);
  el.replaceChildren(label, face);

  /** The clock's time at the last call (hours), to tell when it stops. */
  let lastHours: number | null = null;
  let lastCall = 0;
  let lastMove = -Infinity;
  /** Minute of the day the strips show (fractional; may lag the clock). */
  let shown = 0;
  let shownHour: number | null = null;
  let labelMinute: number | null = null;
  let running = false;

  /** Swap in `text` as the hour: slide the old one up and out, the new one in. */
  const slideHour = (text: string) => {
    const next = document.createElement("span");
    next.textContent = text;
    const old = hour;
    hour = next;
    // Anything still sliding out goes now (a fast catch-up changes the
    // hour several times a second), leaving just the old hour and the new.
    for (const child of Array.from(hourBox.children)) if (child !== old) child.remove();
    hourBox.append(next);
    if (!el.isConnected || prefersReducedMotion()) {
      old.remove();
      return;
    }
    const timing = { duration: HOUR_SLIDE_MS, easing: HOUR_SLIDE_EASING };
    next.animate(
      [
        { transform: "translateY(75%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      timing,
    );
    old
      .animate(
        [
          { transform: "translateY(0)", opacity: 1 },
          { transform: "translateY(-75%)", opacity: 0 },
        ],
        { ...timing, fill: "forwards" },
      )
      .finished.then(
        () => old.remove(),
        () => old.remove(),
      );
  };

  return {
    set(hours) {
      const now = performance.now();
      const first = lastHours === null;
      if (hours !== lastHours) lastMove = now;
      const dt = first ? 0 : Math.min(0.1, (now - lastCall) / 1000);
      lastHours = hours;
      lastCall = now;

      // Running or stopped: blink the colon while it runs.
      const isRunning = !first && now - lastMove < STOPPED_AFTER_MS;
      if (isRunning !== running) {
        running = isRunning;
        colon.classList.toggle("clock-colon-running", running);
      }

      const exact = fractionalMinute(hours);
      const whole = Math.floor(exact);
      if (whole !== labelMinute) {
        labelMinute = whole;
        label.textContent = formatClock(hours);
      }

      // Tick over minute by minute while the clock runs; settle on the
      // whole minute once it stops. The gap is measured the short way round
      // midnight.
      const target = running ? tickPosition(exact) : whole;
      let gap = target - shown;
      gap -= Math.round(gap / DAY_MINUTES) * DAY_MINUTES;
      if (first || Math.abs(gap) > MINUTE_SNAP || prefersReducedMotion()) {
        shown = prefersReducedMotion() ? whole : target;
      } else {
        const rate = running ? TICK_FOLLOW_RATE : SETTLE_FOLLOW_RATE;
        shown += gap * (1 - Math.exp(-rate * dt));
        if (Math.abs(target - shown) < 1e-3) shown = target;
      }
      shown = ((shown % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

      const h = Math.floor(shown / 60);
      const m = shown - h * 60;
      const unit = m % 10;
      // The tens turn with the last numeral's carry, 9 → 0.
      const carry = Math.max(0, unit - 9);
      units.show(unit);
      tens.show(Math.floor(m / 10) + carry);
      if (h !== shownHour) {
        const text = String(h).padStart(2, "0");
        if (shownHour === null) hour.textContent = text;
        else slideHour(text);
        shownHour = h;
      }
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
