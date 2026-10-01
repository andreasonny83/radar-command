/**
 * Leaderboard panel: board tabs (today / this week / all-time), the top
 * players on the chosen board (rank, name, landings, departures, duration,
 * date and score of each one's best run) and the player's own row,
 * highlighted, or added under the list when it isn't on the page shown.
 *
 * Every board arrives whole in one response (top 10 daily / weekly, up to
 * `ALL_TIME_MAX` all-time, core/leaderboard.ts `boardLimit`); the panel
 * pages it `BOARD_SIZE` rows at a time with Prev / Next (or PgUp / PgDn),
 * so a page flip never waits on the network.
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
  BOARD_SIZE,
  BOARDS,
  pageCount,
  type Board,
  type BoardEntry,
  type BoardResponse,
} from "../core/leaderboard";
import type { Result } from "../net/leaderboardApi";
import { errorMessage } from "../net/leaderboardApi";
import { escapeHtml, formatGameDuration } from "./hudMarkup";

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

/**
 * Column layout shared by the header and every row: rank, name, landings,
 * departures, duration, date, score. Narrow screens keep rank, name,
 * landings and score; departures and duration join from `sm` (`WIDE`
 * cells), the date, the widest, from `md` (`WIDER`).
 */
const GRID =
  "grid items-center gap-x-2 grid-cols-[2.25rem_minmax(0,1fr)_2rem_3rem] " +
  "sm:gap-x-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_6rem_4rem] " +
  "md:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5rem_6rem_5.5rem_4rem]";

/** Cells shown from the `sm` breakpoint up. */
const WIDE = "hidden sm:block";
/** Cells shown from the `md` breakpoint up. */
const WIDER = "hidden md:block";

/** Short month names, British style ("Sept", not "Sep"). */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "June",
  "July",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The day a run was submitted, as "29 Sept 2026" (on every board; the
 * time is in the cell's tooltip). Local time.
 */
export function formatRunDate(at: string): string {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The column headings, above the rows (visual only: each cell has a title). */
function headerMarkup(): string {
  const head = "text-[10px] font-bold tracking-wider text-slate-500 uppercase";
  return `
    <div class="${GRID} ${head} sticky top-0 z-10 mb-1 border-b border-slate-800 bg-slate-900 px-2 pt-4 pb-1.5 sm:px-3" aria-hidden="true">
      <span class="text-right">#</span>
      <span>Pilot</span>
      <span class="text-right" title="Landings"><span class="sm:hidden">Lnd</span><span class="${WIDE}">Landings</span></span>
      <span class="${WIDE} text-right">Departures</span>
      <span class="${WIDE} text-right" title="Game time">Duration</span>
      <span class="${WIDER} text-right">Date</span>
      <span class="text-right">Score</span>
    </div>`;
}

/** One row of the list. */
function rowMarkup(entry: BoardEntry): string {
  const rankClass = RANK_CLASSES[entry.rank - 1] ?? "text-slate-500";
  const rowClass = entry.me
    ? "border-sky-400/60 bg-sky-500/15"
    : "border-transparent odd:bg-slate-800/40";
  const you = entry.me
    ? `<span class="ml-2 rounded-md bg-sky-400 px-1.5 text-[10px] font-black tracking-widest text-slate-950">YOU</span>`
    : "";
  const stat = "text-right font-mono text-sm text-slate-300 tabular-nums";
  return `
    <li class="${GRID} rounded-lg border px-2 py-1.5 sm:px-3 ${rowClass}" ${entry.me ? 'data-me=""' : ""}>
      <span class="text-right font-mono font-black tabular-nums ${rankClass}">#${entry.rank}</span>
      <span class="min-w-0 truncate font-semibold text-slate-100">${escapeHtml(entry.name)}${you}</span>
      <span class="${stat}" title="Landings">${entry.landed}</span>
      <span class="${WIDE} ${stat}" title="Departures">${entry.departed}</span>
      <span class="${WIDE} ${stat}" title="Duration (game time flown with two runways open: days, hours, minutes)">${formatGameDuration(entry.seconds)}</span>
      <span class="${WIDER} truncate text-right text-xs text-slate-400" title="${new Date(entry.at).toLocaleString()}">${formatRunDate(entry.at)}</span>
      <span class="text-right font-mono text-lg font-black text-sky-300 tabular-nums">${entry.score}</span>
    </li>`;
}

/**
 * The pager bar's label, "Page 2 of 5", or "" when there's one page (the
 * bar is hidden then).
 */
export function pagerLabel(page: number, pages: number): string {
  return pages > 1 ? `Page ${page + 1} of ${pages}` : "";
}

/** A centred note in the list area (loading, empty, offline). */
function noteMarkup(text: string, tone = "text-slate-400"): string {
  return `<p class="flex h-full min-h-40 items-center justify-center px-4 text-center ${tone}">${text}</p>`;
}

/** Pages `view` spans (1 unless it's a board of more than `BOARD_SIZE` rows). */
export function viewPageCount(view: BoardView): number {
  return view.kind === "ready" ? pageCount(view.data.entries.length) : 1;
}

/**
 * What goes in the list area for `view`, showing page `page` (0-based,
 * clamped to the pages there are).
 */
export function boardBodyMarkup(view: BoardView, page = 0): string {
  if (view.kind === "loading") return noteMarkup(`<span class="animate-pulse">Loading…</span>`);
  if (view.kind === "offline") return noteMarkup(escapeHtml(view.message), "text-amber-300");
  const { entries, me } = view.data;
  if (entries.length === 0) {
    const when = view.board === "all" ? "yet" : BOARD_RANK_LABELS[view.board];
    return noteMarkup(`No shifts on the board ${when}. Land some planes and be the first!`);
  }
  const shown = Math.min(Math.max(0, page), pageCount(entries.length) - 1);
  const pageEntries = entries.slice(shown * BOARD_SIZE, (shown + 1) * BOARD_SIZE);
  const rows = pageEntries.map(rowMarkup).join("");
  // Not on this page (on another one, or below the whole list): a gap,
  // then the player's own standing.
  const meBelow =
    me && !pageEntries.some((e) => e.me)
      ? `<li class="py-1 text-center text-slate-600" aria-hidden="true">⋯</li>` +
        rowMarkup({ ...me, name: "Your best", me: true })
      : "";
  return `${headerMarkup()}<ol class="space-y-1">${rows}${meBelow}</ol>`;
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
 * closes it, ← / → switch tabs, PgUp / PgDn turn pages, and no key reaches
 * the game's shortcuts.
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
  const pager = find("#leaderboardPager");
  const prevBtn = find<HTMLButtonElement>("#leaderboardPrevBtn");
  const nextBtn = find<HTMLButtonElement>("#leaderboardNextBtn");
  const pageLabel = find("#leaderboardPageLabel");
  const closeBtn = find<HTMLButtonElement>("#leaderboardCloseBtn");
  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-board]"));
  let shown = false;
  let board: Board = options.initialBoard ?? "daily";
  /** Page of the board shown (0-based); back to the first on a tab switch or reopen. */
  let page = 0;
  /** The last view rendered, kept to re-render on a page flip. */
  let view: BoardView = { kind: "loading" };
  /** Counts loads, so a slow reply for a tab left behind is dropped. */
  let request = 0;
  /** What had focus before opening, to hand it back on close. */
  let opener: Element | null = null;

  const render = (next: BoardView) => {
    view = next;
    const pages = viewPageCount(view);
    page = Math.min(page, pages - 1);
    body.innerHTML = boardBodyMarkup(view, page);
    body.setAttribute("aria-busy", String(view.kind === "loading"));
    pager.classList.toggle("hidden", pages <= 1);
    pager.classList.toggle("flex", pages > 1);
    pageLabel.textContent = pagerLabel(page, pages);
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page >= pages - 1;
  };

  /** Flip `step` pages (±1), staying within the board; the list scrolls back to its top. */
  const turnPage = (step: number) => {
    const next = Math.min(Math.max(0, page + step), viewPageCount(view) - 1);
    if (next === page) return;
    page = next;
    render(view);
    body.scrollTop = 0;
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
    page = 0;
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
  prevBtn.addEventListener("click", () => turnPage(-1));
  nextBtn.addEventListener("click", () => turnPage(1));
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
      } else if (key === "PageUp" || key === "PageDown") {
        turnPage(key === "PageUp" ? -1 : 1);
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
