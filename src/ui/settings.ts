/**
 * The player's interface choices that outlive a visit: where each movable
 * panel sits, how big the radar is and how see-through the panels are. Kept
 * in localStorage; storage can be unavailable (private mode, a sandboxed
 * Storybook), then nothing is remembered and nothing breaks. Which panels
 * are switched off is kept separately (panels.ts).
 */

/** Panels the player can drag (`data-move` in hudMarkup.ts). */
export const MOVE_IDS = ["score", "radar", "controls", "speed", "pause", "stats"] as const;
export type MoveId = (typeof MOVE_IDS)[number];

export const RADAR_SIZES = ["s", "m", "l"] as const;
export type RadarSize = (typeof RADAR_SIZES)[number];

/** Radar width (CSS length) for each size; the `--radar-size` variable. */
export const RADAR_SIZE_REM: Record<RadarSize, string> = { s: "7rem", m: "10rem", l: "13.5rem" };

/** Least opaque the panels can be made: below this they are hard to find. */
export const MIN_OPACITY = 0.35;

/** How far a panel has been dragged from its home spot (CSS px). */
export interface Offset {
  x: number;
  y: number;
}

export interface UiSettings {
  offsets: Partial<Record<MoveId, Offset>>;
  radarSize: RadarSize;
  /** Panel opacity, MIN_OPACITY..1. */
  opacity: number;
}

export const DEFAULT_SETTINGS: UiSettings = { offsets: {}, radarSize: "m", opacity: 1 };

const KEY = "radar-command.uiSettings";

/** Saved settings, with anything missing or malformed replaced by the defaults. */
export function loadSettings(): UiSettings {
  const settings: UiSettings = { ...DEFAULT_SETTINGS, offsets: {} };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return settings;
    const saved = raw as Partial<Record<keyof UiSettings, unknown>>;
    if (RADAR_SIZES.includes(saved.radarSize as RadarSize)) {
      settings.radarSize = saved.radarSize as RadarSize;
    }
    if (typeof saved.opacity === "number" && Number.isFinite(saved.opacity)) {
      settings.opacity = Math.min(1, Math.max(MIN_OPACITY, saved.opacity));
    }
    const offsets = saved.offsets as Record<string, Partial<Offset>> | undefined;
    for (const id of MOVE_IDS) {
      const o = offsets?.[id];
      if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
        settings.offsets[id] = { x: o.x!, y: o.y! };
      }
    }
  } catch {
    // Unreadable: start from the defaults.
  }
  return settings;
}

export function saveSettings(settings: UiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
