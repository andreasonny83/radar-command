/**
 * Display choices remembered between visits in localStorage (the
 * leaderboard's own keys live in net/leaderboardApi.ts). Storage can be
 * unavailable (private mode, a sandboxed Storybook): then nothing is
 * remembered and nothing breaks.
 */

const UI_HIDDEN_KEY = "radar-command.uiHidden";

/** Was the interface left hidden (U / the eye button) last time? Shown by default. */
export function savedUiHidden(): boolean {
  try {
    return localStorage.getItem(UI_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveUiHidden(hidden: boolean): void {
  try {
    localStorage.setItem(UI_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
