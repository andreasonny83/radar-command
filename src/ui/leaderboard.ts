/**
 * Leaderboard panel: board tabs (today / this week / all-time), the top
 * players on the chosen board and the player's own row, highlighted, or
 * added under the list when they're outside the top `BOARD_SIZE`.
 *
 * Markup of the frame lives in hudMarkup.ts (`leaderboardPanelMarkup`);
 * this module fills in the list and wires the tabs. Data comes from a
 * `load` function (net/leaderboardApi.ts in the game, canned results in
 * Storybook), so the panel never talks to the network itself.
 *
 * Also here: the game-over form's states (`SubmitState`) and how a
 * submitted run's ranks read.
 */
import {
  BOARD_LABELS,
  BOARD_RANK_LABELS,
  BOARDS,
  type Board,
  type BoardEntry,
  type BoardResponse,
} from "../core/leaderboard";
import type { Result } from "../net/leaderboardApi";
import { errorMessage } from "../net/leaderboardApi";
import { escapeHtml } from "./hudMarkup";

/** What the list area shows. */
export type BoardView =
  | { kind: "loading" }
  | { kind: "offline"; message: string }
  | { kind: "ready"; board: Board; data: BoardResponse };

/** The view for a finished request. */
export function boardView(board: Board, result: Result<BoardResponse>): BoardView {
  return result.ok
    ? { kind: "ready", board, data: result.data }
    : { kind: "offline", message: errorMessage(result.error) };
}

/**
 * The game-over form, as main.ts drives it:
 * - `ready`: name field and SUBMIT enabled;
 * - `unavailable`: this run can't go on the board (no run token, nothing
 *   landed, already refused), with why;
 * - `sending`: waiting on the server;
 * - `done`: on the board, with its ranks;
 * - `error`: the submit failed but can be tried again.
 */
export type SubmitState =
  | { kind: "ready" }
  | { kind: "unavailable"; message: string }
  | { kind: "sending" }
  | { kind: "done"; ranks: Record<Board, number> }
  | { kind: "error"; message: string };

/** "#4 today · #12 this week · #87 all-time" (boards the run isn't on are left out). */
export function formatRanks(ranks: Record<Board, number>): string {
  return BOARDS.filter((b) => ranks[b] > 0)
    .map((b) => `#${ranks[b]} ${BOARD_RANK_LABELS[b]}`)
    .join(" · ");
}

/** Rank badge colours: gold, silver, bronze, then plain. */
const RANK_CLASSES = ["text-amber-300", "text-slate-200", "text-orange-400"];

/** One row of the list. */
function rowMarkup(entry: Pick<BoardEntry, "rank" | "name" | "score" | "me">): string {
  const rankClass = RANK_CLASSES[entry.rank - 1] ?? "text-slate-500";
  const rowClass = entry.me
    ? "border-sky-400/60 bg-sky-500/15"
    : "border-transparent odd:bg-slate-800/40";
  const you = entry.me
    ? `<span class="ml-2 rounded-md bg-sky-400 px-1.5 text-[10px] font-black tracking-widest text-slate-950">YOU</span>`
    : "";
  return `
    <li class="flex items-center gap-3 rounded-lg border px-3 py-1.5 ${rowClass}" ${entry.me ? 'data-me=""' : ""}>
      <span class="w-10 shrink-0 text-right font-mono font-black tabular-nums ${rankClass}">#${entry.rank}</span>
      <span class="min-w-0 flex-1 truncate font-semibold text-slate-100">${escapeHtml(entry.name)}${you}</span>
      <span class="shrink-0 font-mono text-lg font-black text-sky-300 tabular-nums">${entry.score}</span>
    </li>`;
}

/** A centred note in the list area (loading, empty, offline). */
function noteMarkup(text: string, tone = "text-slate-400"): string {
  return `<p class="flex h-full min-h-40 items-center justify-center px-4 text-center ${tone}">${text}</p>`;
}

/** What goes in the list area for `view`. */
export function boardBodyMarkup(view: BoardView): string {
  if (view.kind === "loading") return noteMarkup(`<span class="animate-pulse">Loading…</span>`);
  if (view.kind === "offline") return noteMarkup(escapeHtml(view.message), "text-amber-300");
  const { entries, me } = view.data;
  if (entries.length === 0) {
    const when = view.board === "all" ? "yet" : BOARD_RANK_LABELS[view.board];
    return noteMarkup(`No shifts on the board ${when}. Land some planes and be the first!`);
  }
  const rows = entries.map(rowMarkup).join("");
  // Outside the top list: a gap, then the player's own standing.
  const meBelow =
    me && !entries.some((e) => e.me)
      ? `<li class="py-1 text-center text-slate-600" aria-hidden="true">⋯</li>` +
        rowMarkup({ rank: me.rank, name: "Your best", score: me.score, me: true })
      : "";
  return `<ol class="space-y-1">${rows}${meBelow}</ol>`;
}

export interface LeaderboardPanelOptions {
  /** Fetch a board. Missing: every board shows as offline. */
  load?: (board: Board) => Promise<Result<BoardResponse>>;
  /** Tab to show the first time the panel opens. */
  initialBoard?: Board;
  /** The tab changed (to remember it for next time). */
  onBoardChange?: (board: Board) => void;
  /** The panel opened or closed (to pause the game behind it). */
  onOpenChange?: (open: boolean) => void;
}

export interface LeaderboardPanel {
  readonly open: boolean;
  /** Open (on `board`, or the last tab) or close. Opening reloads the board. */
  setOpen(open: boolean, board?: Board): void;
}

/**
 * Wire the panel markup inside `root` (from `leaderboardPanelMarkup`).
 * While it's open it owns the keyboard, like the licenses panel: Esc or L
 * closes it, ← / → switch tabs, and no key reaches the game's shortcuts.
 */
export function createLeaderboardPanel(
  root: HTMLElement,
  options: LeaderboardPanelOptions,
): LeaderboardPanel {
  const find = <T extends HTMLElement>(selector: string): T => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Missing ${selector} in hudMarkup.ts`);
    return el;
  };
  const panel = find("#leaderboardPanel");
  const body = find("#leaderboardBody");
  const closeBtn = find<HTMLButtonElement>("#leaderboardCloseBtn");
  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-board]"));
  let shown = false;
  let board: Board = options.initialBoard ?? "daily";
  /** Counts loads, so a slow reply for a tab left behind is dropped. */
  let request = 0;
  /** What had focus before opening, to hand it back on close. */
  let opener: Element | null = null;

  const render = (view: BoardView) => {
    body.innerHTML = boardBodyMarkup(view);
    body.setAttribute("aria-busy", String(view.kind === "loading"));
  };

  const load = async () => {
    const id = ++request;
    const current = board;
    if (!options.load) {
      render({ kind: "offline", message: errorMessage("offline") });
      return;
    }
    render({ kind: "loading" });
    const result = await options.load(current);
    if (id === request) render(boardView(current, result));
  };

  const selectBoard = (next: Board) => {
    board = next;
    for (const tab of tabs) {
      const active = tab.dataset.board === next;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    options.onBoardChange?.(next);
    void load();
  };

  const setOpen = (open: boolean, next?: Board) => {
    if (open && next) board = next;
    if (open) selectBoard(board); // always fresh: the board moves while you play
    if (open === shown) return;
    shown = open;
    panel.classList.toggle("hidden", !open);
    panel.classList.toggle("flex", open);
    if (open) {
      opener = root.ownerDocument.activeElement;
      closeBtn.focus();
    } else if (opener instanceof HTMLElement) {
      // Back where it was, but unfocused so Space/Enter can't reopen it.
      opener.focus();
      opener.blur();
      opener = null;
    }
    options.onOpenChange?.(open);
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const next = tab.dataset.board as Board;
      if (next !== board) selectBoard(next);
    });
  }
  closeBtn.addEventListener("click", () => setOpen(false));
  panel.addEventListener("click", (e) => {
    if (e.target === panel) setOpen(false);
  });
  root.ownerDocument.addEventListener(
    "keydown",
    (e) => {
      if (!shown) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "Escape" || key === "l") {
        setOpen(false);
        e.preventDefault();
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        const step = key === "ArrowLeft" ? -1 : 1;
        const next = BOARDS[(BOARDS.indexOf(board) + step + BOARDS.length) % BOARDS.length];
        if (next) {
          selectBoard(next);
          tabs.find((t) => t.dataset.board === next)?.focus();
        }
        e.preventDefault();
      }
      e.stopImmediatePropagation();
    },
    true,
  );

  // The tabs' labels come from core/leaderboard.ts.
  for (const tab of tabs) tab.textContent = BOARD_LABELS[tab.dataset.board as Board];

  return {
    get open() {
      return shown;
    },
    setOpen,
  };
}
