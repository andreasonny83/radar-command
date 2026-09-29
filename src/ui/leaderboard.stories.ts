/**
 * Leaderboard: the boards panel and the game-over submit form, on the real
 * `createHud` with canned data in place of the API (net/leaderboardApi.ts).
 *
 * Rows show each best run's landings, departures, duration and date as
 * well as its score (the sample breakdowns add up to the score, as
 * `scoreOf` would). Panel stories: pick what `loadBoard` returns (a full board, the player in
 * or outside the top ten, a long all-time board of `ALL_TIME_MAX` rows that
 * pages ten at a time, an empty board, a load that never finishes, or no
 * API at all); the tabs switch boards as in the game, and Prev / Next (or
 * PgUp / PgDn) turn the pages. Submit stories
 * put the game-over form in each `SubmitState` (ui/leaderboard.ts).
 * Tweak `leaderboardPanelMarkup` / `submitFormMarkup` in hudMarkup.ts,
 * the row look in ui/leaderboard.ts or the labels in core/leaderboard.ts
 * and the story hot-reloads.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import {
  ALL_TIME_MAX,
  boardLimit,
  type Board,
  type BoardEntry,
  type BoardResponse,
  type BoardStanding,
} from "../core/leaderboard";
import { DEPARTURE_POINTS, LANDING_POINTS, SECONDS_PER_TIME_POINT } from "../core/scoring";
import type { Result } from "../net/leaderboardApi";
import { createHud, type HudCallbacks } from "./hud";
import type { SubmitState } from "./leaderboard";

/** What the mocked `loadBoard` answers. */
type Data =
  | "populated"
  | "youInTop"
  | "youOutside"
  | "long"
  | "longYouOnPage3"
  | "empty"
  | "loading"
  | "offline";

interface LeaderboardArgs {
  /** Show the panel (else the game-over screen with its form). */
  panel: boolean;
  board: Board;
  data: Data;
  /** Game-over form state (when `panel` is off). */
  submit: SubmitState["kind"];
  /** The run's breakdown on the game-over screen (core/scoring.ts). */
  landed: number;
  departed: number;
  seconds: number;
  name: string;
  onSubmitScore: HudCallbacks["onSubmitScore"];
  onBoardChange: HudCallbacks["onBoardChange"];
}

const NAMES = [
  "Maverick",
  "SkyQueen",
  "tower_ops",
  "Jet Lag",
  "R.Flyer",
  "Glide-Path",
  "nightowl",
  "ATC Nerd",
  "Holding 7",
  "LowAndSlow",
];

/** Call-sign suffixes, for names past the first ten ("Maverick 2", …). */
const SUFFIXES = ["", " 2", "_x", " Jr", "99"];

/**
 * A run breakdown that `scoreOf` (core/scoring.ts) turns back into exactly
 * `score`: about one departure per 150 points, a few minutes flown, the
 * rest in landings. `i` varies the time so rows don't all look alike.
 */
function breakdownFor(
  score: number,
  i: number,
): Pick<BoardStanding, "landed" | "departed" | "seconds"> {
  const departed = Math.floor(score / 150);
  let timePoints = 18 + ((i * 7) % 40);
  let rest = score - departed * DEPARTURE_POINTS - timePoints;
  if (rest < 0) {
    timePoints += rest;
    rest = 0;
  }
  // What landings can't cover (under 10 points) goes back into time.
  timePoints += rest % LANDING_POINTS;
  return {
    landed: Math.floor(rest / LANDING_POINTS),
    departed,
    seconds: timePoints * SECONDS_PER_TIME_POINT + ((i * 3) % SECONDS_PER_TIME_POINT),
  };
}

/** A standing (the player's own, below the list) for `score` at `rank`. */
function standingFor(rank: number, score: number): BoardStanding {
  const at = new Date(Date.UTC(2026, 8, 29, 8, 12)).toISOString();
  return { rank, score, ...breakdownFor(score, rank), at };
}

/**
 * A board of `count` rows (ten by default, up to `ALL_TIME_MAX`), scores
 * falling (in the range `scoreOf` gives real shifts; a long board eases
 * down so row 50 still scores); `me` marks the player's row (rank).
 */
function sampleEntries(board: Board, me?: number, count = 10): BoardEntry[] {
  const top = board === "daily" ? 412 : board === "weekly" ? 695 : 1340;
  const fall = count > 10 ? 0.018 : 0.075;
  // Runs spread back in time: minutes apart today, hours this week, days all-time.
  const step = board === "daily" ? 17 * 60e3 : board === "weekly" ? 5 * 3600e3 : 26 * 3600e3;
  return Array.from({ length: Math.min(count, ALL_TIME_MAX) }, (_, i) => {
    const score = Math.round(top * (1 - i * fall));
    return {
      rank: i + 1,
      name:
        i + 1 === me
          ? "Helm Pilot"
          : `${NAMES[i % NAMES.length]}${SUFFIXES[Math.floor(i / NAMES.length)] ?? ""}`,
      score,
      ...breakdownFor(score, i),
      at: new Date(Date.UTC(2026, 8, 29, 20, 0) - i * step).toISOString(),
      me: i + 1 === me,
    };
  });
}

/**
 * The player's standing as the API sends it: their row's, when it made the
 * list, else a run of `score` at `rank`.
 */
function ownStanding(entries: BoardEntry[], rank: number, score: number): BoardStanding {
  const row = entries.find((e) => e.me);
  if (!row) return standingFor(rank, score);
  const { rank: r, score: sc, landed, departed, seconds, at } = row;
  return { rank: r, score: sc, landed, departed, seconds, at };
}

/** The canned answer for `data` on `board`. */
function sample(data: Data, board: Board): Promise<Result<BoardResponse>> {
  const ok = (value: BoardResponse) => Promise.resolve({ ok: true as const, data: value });
  switch (data) {
    case "populated":
      return ok({ entries: sampleEntries(board), me: null });
    case "youInTop": {
      const entries = sampleEntries(board, 4);
      return ok({ entries, me: ownStanding(entries, 4, 96) });
    }
    case "youOutside":
      return ok({
        entries: sampleEntries(board),
        me: standingFor(board === "all" ? 87 : 23, 96),
      });
    case "long": {
      // The API's row count for the tab: 50 on all-time, 10 on the others.
      const entries = sampleEntries(board, undefined, boardLimit(board));
      return ok({ entries, me: null });
    }
    case "longYouOnPage3": {
      // Rank 24 is on all-time's page 3; the ten-row boards pin it below.
      const entries = sampleEntries(board, 24, boardLimit(board));
      return ok({ entries, me: ownStanding(entries, 24, 96) });
    }
    case "empty":
      return ok({ entries: [], me: null });
    case "loading":
      return new Promise(() => {}); // never answers
    case "offline":
      return Promise.resolve({ ok: false, error: "offline" });
  }
}

/** Each form state, as main.ts would set it. */
const SUBMIT_STATES: Record<SubmitState["kind"], SubmitState> = {
  ready: { kind: "ready" },
  sending: { kind: "sending" },
  done: { kind: "done", ranks: { daily: 4, weekly: 12, all: 87 } },
  error: { kind: "error", message: "Leaderboard unreachable. Check your connection." },
  unavailable: {
    kind: "unavailable",
    message: "Leaderboard offline: this shift can't be submitted.",
  },
};

const meta: Meta<LeaderboardArgs> = {
  title: "HUD/Leaderboard",
  render: (args) => {
    const root = document.createElement("div");
    root.className = "relative h-full w-full overflow-hidden text-slate-100";
    const hud = createHud(root, {
      onStart: fn(),
      onTogglePause: fn(),
      onRotate: fn(),
      onZoom: fn(),
      onSubmitScore: args.onSubmitScore,
      onBoardChange: args.onBoardChange,
      loadBoard: args.data === "offline" ? undefined : (board) => sample(args.data, board),
      initialBoard: args.board,
    });
    const breakdown = { landed: args.landed, departed: args.departed, seconds: args.seconds };
    hud.setScore(breakdown);
    hud.showGameOver(breakdown, args.name);
    hud.setPhase("gameover");
    hud.setSubmitState(SUBMIT_STATES[args.submit]);
    if (args.panel) hud.setLeaderboardOpen(true, args.board);
    return root;
  },
  argTypes: {
    board: { control: "inline-radio", options: ["daily", "weekly", "all"] },
    data: {
      control: "select",
      options: [
        "populated",
        "youInTop",
        "youOutside",
        "long",
        "longYouOnPage3",
        "empty",
        "loading",
        "offline",
      ],
    },
    submit: {
      control: "inline-radio",
      options: ["ready", "sending", "done", "error", "unavailable"],
    },
    landed: { control: { type: "number", min: 0, step: 1 } },
    departed: { control: { type: "number", min: 0, step: 1 } },
    seconds: { control: { type: "number", min: 0, step: 1 } },
    onSubmitScore: { table: { disable: true } },
    onBoardChange: { table: { disable: true } },
  },
  args: {
    panel: true,
    board: "daily",
    data: "populated",
    submit: "ready",
    landed: 18,
    departed: 2,
    seconds: 341,
    name: "Helm Pilot",
    onSubmitScore: fn(),
    onBoardChange: fn(),
  },
};
export default meta;

type Story = StoryObj<LeaderboardArgs>;

/** Today's board, ten players, the viewer not on it. */
export const Populated: Story = {};

/** The player's best is 4th: their row lights up with a YOU tag. */
export const YouInTopTen: Story = { args: { data: "youInTop" } };

/**
 * The player placed below the whole list (here rank 87, past the all-time
 * top 50): their rank follows after a gap, on every page.
 */
export const YouOutsideTopTen: Story = { args: { data: "youOutside", board: "all" } };

/**
 * All-time: the top 50, ten per page. Prev / Next (or PgUp / PgDn) turn
 * the pages; ranks carry on (#11… on page 2). Switch to Today or This week
 * and the pager hides (those boards are ten rows).
 */
export const AllTimeLong: Story = { args: { data: "long", board: "all" } };

/**
 * All-time, the player 24th: pages 1, 2, 4 and 5 pin "Your best" under the
 * list; page 3 highlights their own row instead.
 */
export const AllTimeYouOnPage3: Story = { args: { data: "longYouOnPage3", board: "all" } };

/** No runs yet in the window (e.g. just after midnight UTC). */
export const Empty: Story = { args: { data: "empty" } };

/** Waiting on the API. */
export const Loading: Story = { args: { data: "loading" } };

/** No API (down, or not deployed): the game plays on regardless. */
export const Offline: Story = { args: { data: "offline" } };

/**
 * Game-over form, ready: the name from last time filled in, SUBMIT (or
 * Enter in the field) sends the run.
 */
export const SubmitReady: Story = { args: { panel: false } };

/** Waiting on the server. */
export const SubmitSending: Story = { args: { panel: false, submit: "sending" } };

/** On the board: where the run placed today, this week and all-time. */
export const SubmitDone: Story = { args: { panel: false, submit: "done" } };

/** The submit failed but can be retried (network, rate limit, server). */
export const SubmitError: Story = { args: { panel: false, submit: "error" } };

/** This run can't go on the board (no run token, nothing landed, refused). */
export const SubmitUnavailable: Story = { args: { panel: false, submit: "unavailable" } };
