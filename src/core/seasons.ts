/**
 * The four seasons of a shift: a pure function of the clock.
 *
 * A shift always opens in summer (`FIRST_SEASON`) and moves to the next one every `SEASON_DAYS` game days
 * (`SEASON_SECONDS` of play), in the order of the year. Like the time of day
 * (core/daytime.ts) the season is derived from `GameState.elapsed`, never
 * stored, so it resets with a new shift and stands still whenever the sim
 * does. Visual only: the render layer (render/seasonTuning.ts) turns it into
 * colours; nothing in the sim reads it.
 *
 * The change is not a cut: over the last `SEASON_BLEND_HOURS` of a season
 * the look slides into the next one (`blend` 0 → 1).
 */
import { DAY_SECONDS } from "./daytime";

/** In the order of the year; a shift cycles through them and wraps. */
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

/** Game days each season lasts. */
export const SEASON_DAYS = 2;

/** Real seconds of play per season. */
export const SEASON_SECONDS = SEASON_DAYS * DAY_SECONDS;

/** Game hours at the end of a season spent sliding into the next. */
export const SEASON_BLEND_HOURS = 8;

/** Where a shift is in the year at an instant. */
export interface SeasonPhase {
  /** The season now. */
  season: Season;
  /** The one after it (what `blend` slides towards). */
  next: Season;
  /** 0 = fully `season` … 1 = fully `next`; 0 for most of a season. */
  blend: number;
  /** Seasons since the shift began (0 in the first), for the HUD toast. */
  count: number;
}

/** The season every shift opens in. */
export const FIRST_SEASON: Season = "summer";

/** The season after `season`, wrapping winter → spring. */
export function nextSeason(season: Season): Season {
  return SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length]!;
}

/** 0..1 ease with zero slope at both ends, so the slide has no visible kink. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** The season `elapsed` seconds into a shift that opened in `start`. */
export function seasonAt(elapsed: number, start: Season): SeasonPhase {
  const seasons = Math.max(0, elapsed) / SEASON_SECONDS;
  const count = Math.floor(seasons);
  const season = SEASONS[(SEASONS.indexOf(start) + count) % SEASONS.length]!;
  const blendShare = SEASON_BLEND_HOURS / (SEASON_DAYS * 24);
  const blend = smoothstep((seasons - count - (1 - blendShare)) / blendShare);
  return { season, next: nextSeason(season), blend, count };
}
