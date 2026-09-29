/**
 * Leaderboard: the boards panel and the game-over submit form, on the real
 * `createHud` with canned data in place of the API (net/leaderboardApi.ts).
 *
 * Panel stories: pick what `loadBoard` returns (a full board, the player in
 * or outside the top ten, an empty board, a load that never finishes, or
 * no API at all); the tabs switch boards as in the game. Submit stories
 * put the game-over form in each `SubmitState` (ui/leaderboard.ts).
 * Tweak `leaderboardPanelMarkup` / `submitFormMarkup` in hudMarkup.ts,
 * the row look in ui/leaderboard.ts or the labels in core/leaderboard.ts
 * and the story hot-reloads.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import type { Board, BoardEntry, BoardResponse } from "../core/leaderboard";
import type { Result } from "../net/leaderboardApi";
import { createHud, type HudCallbacks } from "./hud";
import type { SubmitState } from "./leaderboard";

/** What the mocked `loadBoard` answers. */
type Data = "populated" | "youInTop" | "youOutside" | "empty" | "loading" | "offline";

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

/**
 * A board of ten, scores falling (in the range `scoreOf` gives real
 * shifts); `me` marks the player's row (rank).
 */
function sampleEntries(board: Board, me?: number): BoardEntry[] {
  const top = board === "daily" ? 412 : board === "weekly" ? 695 : 1340;
  return NAMES.map((name, i) => ({
    rank: i + 1,
    name: i + 1 === me ? "Helm Pilot" : name,
    score: Math.round(top * (1 - i * 0.075)),
    at: new Date(Date.UTC(2026, 8, 29, 9, i)).toISOString(),
    me: i + 1 === me,
  }));
}

/** The canned answer for `data` on `board`. */
function sample(data: Data, board: Board): Promise<Result<BoardResponse>> {
  const ok = (value: BoardResponse) => Promise.resolve({ ok: true as const, data: value });
  switch (data) {
    case "populated":
      return ok({ entries: sampleEntries(board), me: null });
    case "youInTop":
      return ok({
        entries: sampleEntries(board, 4),
        me: { rank: 4, score: sampleEntries(board)[3]!.score },
      });
    case "youOutside":
      return ok({
        entries: sampleEntries(board),
        me: { rank: board === "all" ? 87 : 23, score: 96 },
      });
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
      options: ["populated", "youInTop", "youOutside", "empty", "loading", "offline"],
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

/** The player placed below the top ten: their rank follows after a gap. */
export const YouOutsideTopTen: Story = { args: { data: "youOutside", board: "all" } };

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
