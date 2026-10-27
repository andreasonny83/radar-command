/**
 * The HUD pieces the player can switch off one by one (on top of U, which
 * hides the lot). Each has a shortcut (input/shortcuts.ts) and a small key
 * hint that shows when the pointer rests on it (style.css `[data-panel]`).
 * Markup tags an element with `data-panel="<id>"`; `hud.setPanelOn` flips
 * its `data-off` attribute, which style.css turns into `display: none`.
 */
import type { ShortcutAction } from "../input/shortcuts";

export const PANEL_IDS = ["score", "radar", "notices", "controls", "arrows", "stats"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** The shortcut that toggles each panel (its key is the hover hint). */
export const PANEL_ACTIONS: Record<PanelId, ShortcutAction> = {
  score: "toggleScore",
  radar: "toggleRadar",
  notices: "toggleNotices",
  controls: "toggleControls",
  arrows: "toggleArrows",
  stats: "toggleStats",
};

/** Names for the settings card. */
export const PANEL_LABELS: Record<PanelId, string> = {
  score: "Score and clock",
  radar: "Radar",
  notices: "Toasts and weather warnings",
  controls: "Buttons",
  arrows: "Incoming-plane arrows",
  stats: "Stats for nerds",
};

const HIDDEN_PANELS_KEY = "radar-command.hiddenPanels";

/** Panels left switched off last time (all shown by default; stats is a separate opt-in). */
export function savedHiddenPanels(): PanelId[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HIDDEN_PANELS_KEY) ?? "[]");
    return Array.isArray(raw) ? PANEL_IDS.filter((id) => raw.includes(id)) : [];
  } catch {
    return [];
  }
}

export function saveHiddenPanels(hidden: readonly PanelId[]): void {
  try {
    localStorage.setItem(HIDDEN_PANELS_KEY, JSON.stringify(hidden));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
