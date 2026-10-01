/**
 * Weather warnings for the HUD strip (`Hud.setWeatherAlerts`), in the style
 * of the Met Office's National Severe Weather Warning Service
 * (https://weather.metoffice.gov.uk/guides/warnings): a yellow, amber or red
 * warning, headed "<Level> warning of <weather>", with the level's action
 * word (be aware / be prepared / take action) and what to expect. Unlike
 * the real service it names no area and no time: it is a heads-up that the
 * weather is about to turn. Only wind streams so far (core/windStreams.ts:
 * yellow for an ordinary one, red for the extreme kind);
 * another kind of severe weather adds its own case in `weatherAlerts`.
 * Shared by the game (main.ts) and the Storybook stories: `weatherAlerts`
 * reads the state, `createWeatherStrip` draws the lines.
 */
import { WARNING_HEX } from "../config";
import type { GameState, WarningLevel } from "../core/types";
import { peakPending, streamWarningLevel, windPhase } from "../core/windStreams";
import { weatherAlertLineMarkup } from "./hudMarkup";

/** One line of the warning strip. */
export interface WeatherAlert {
  /** Stable per kind of weather and level, so the HUD keeps a line rather than rebuilding it. */
  id: string;
  level: WarningLevel;
  /** The warning's title, e.g. "Amber warning of wind". */
  headline: string;
  /** What to do and what to expect, e.g. "Be prepared: strong winds may erase flight paths". */
  advice: string;
}

/** The Met Office's action word for each warning level. */
const ACTION: Record<WarningLevel, string> = {
  yellow: "Be aware",
  amber: "Be prepared",
  red: "Take action",
};

/** "Yellow", "Amber" or "Red", for a headline. */
function levelName(level: WarningLevel): string {
  return level[0]!.toUpperCase() + level.slice(1);
}

/**
 * The warning for wind at `level`. Red is the extreme one (a stream that
 * destroys aircraft at its peak; it is never called anything else to the
 * player), the others strong wind that erases flight paths.
 */
export function windAlert(level: WarningLevel): WeatherAlert {
  if (level === "red") {
    return {
      id: `wind-${level}`,
      level,
      headline: `${levelName(level)} warning of extreme wind`,
      advice: `${ACTION[level]}: extreme winds can destroy aircraft`,
    };
  }
  return {
    id: `wind-${level}`,
    level,
    headline: `${levelName(level)} warning of wind`,
    advice: `${ACTION[level]}: strong winds may erase flight paths`,
  };
}

/** Warning levels wind can raise, most serious first (the strip's line order). */
const WIND_LEVELS: readonly WarningLevel[] = ["red", "yellow"];

/**
 * Every warning to show now: one line per kind of weather and level on the
 * way, so a mild and an extreme stream can be announced together.
 */
export function weatherAlerts(state: GameState): WeatherAlert[] {
  // Wind: a stream is announced from its forecast until it turns active; a
  // black one (red warning) stays up until its lethal peak is over.
  const coming = new Set<WarningLevel>();
  for (const stream of state.streams) {
    const phase = windPhase(stream);
    if (phase === "forecast" || phase === "forming" || peakPending(stream)) {
      coming.add(streamWarningLevel(stream));
    }
  }
  return WIND_LEVELS.filter((level) => coming.has(level)).map(windAlert);
}

/** The strip's DOM: lines kept per alert id, added and removed as they change. */
export interface WeatherStrip {
  /** Show `alerts`, replacing the last list. Cheap to call every frame. */
  update(alerts: readonly WeatherAlert[]): void;
}

/** Drive the strip element made by `weatherAlertsMarkup`. */
export function createWeatherStrip(strip: HTMLElement): WeatherStrip {
  const lines = new Map<string, HTMLElement>();
  return {
    update(alerts) {
      const live = new Set(alerts.map((a) => a.id));
      for (const [id, line] of lines) {
        if (live.has(id)) continue;
        line.remove();
        lines.delete(id);
      }
      for (const alert of alerts) {
        if (lines.has(alert.id)) continue;
        const holder = document.createElement("div");
        holder.innerHTML = weatherAlertLineMarkup().trim();
        const line = holder.firstElementChild as HTMLElement;
        line.style.borderColor = WARNING_HEX[alert.level];
        line.querySelector<HTMLElement>("[data-alert-icon]")!.style.color =
          WARNING_HEX[alert.level];
        const headline = line.querySelector<HTMLElement>("[data-alert-headline]")!;
        headline.textContent = alert.headline;
        headline.style.color = WARNING_HEX[alert.level];
        line.querySelector("[data-alert-advice]")!.textContent = alert.advice;
        lines.set(alert.id, line);
        strip.append(line);
      }
    },
  };
}
