/**
 * Soundboard for every sound effect (audio/sfx.ts) and the airport
 * ambience (audio/ambience.ts), through the game's own mixer
 * (audio/mixer.ts), for tuning by ear.
 *
 * Press "Start audio" first: browsers only play sound after a click. Each
 * button plays one effect the way the game triggers it: render cues (gear,
 * touchdown, whoosh, warning) as `SceneSync` raises them, moments as the sim
 * and input do, and the continuous sounds (take-off engines, landing
 * rollout) by running a stand-in plane through their state for a few
 * seconds. `pan` places the plane effects left or right; `focus` plays
 * them as in follow mode: from the followed plane (stepped forward) or
 * from another plane (pushed back). The ambience args
 * switch its layers (room tone, chatter, PA announcements, jets and radio
 * outside) on and off; "PA announcement" plays one straight away (a queued
 * game line, else a terminal line), and "Speak" announces whatever is in
 * the text box. The speech engine (audio/speech.ts, ~1 MB) loads when
 * audio starts; until then announcements use the wordless voice.
 *
 * Tuning loop: `LEVELS`, `ENGINE_*`, `ROLLOUT_VOLUME`, `ALERT_*`,
 * `FOCUS_LEVEL` / `BACKGROUND_LEVEL` and the builders in sfx.ts; `PA_SCHEDULE`, `AMBIENCE_LEVELS`, `VOWELS` and the
 * `*_LEVEL`s in ambience.ts; the lines in announcements.ts; the voices in
 * speech.ts; bus levels (`AMBIENCE_VOLUME`,
 * `SCENE_LEVELS`) in mixer.ts; gear timing (`GEAR_TRAVEL`) in
 * render/sceneSync.ts. Save, reload the story, press Start again.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { FLARE_DISTANCE, LANDING_SPEED_START, PLANE_SPEED, ROTATE_SPEED } from "../config";
import { createPlane } from "../core/plane";
import { createGameState } from "../core/state";
import type { GameState, Plane } from "../core/types";
import { GEAR_TRAVEL as GEAR_SECONDS } from "../render/sceneSync";
import type { AmbienceLayer } from "./ambience";
import { loadSpeech } from "./speech";
import { GameAudio } from "./mixer";

/** Follow mode for the plane effects (see `Sfx.setFocus`). */
type Focus = "no plane followed" | "followed plane" | "another plane";

interface EffectsArgs {
  /** Stereo position of the plane effects, -1 (left) to 1 (right). */
  pan: number;
  /** Play the plane effects as if the camera followed this plane, or another. */
  focus: Focus;
  room: boolean;
  chatter: boolean;
  pa: boolean;
  outside: boolean;
}

const AMBIENCE: AmbienceLayer[] = ["room", "chatter", "pa", "outside"];

/** The audio of the story on screen; closed when the next one mounts. */
let active: GameAudio | null = null;

const meta: Meta<EffectsArgs> = {
  title: "Audio/Effects",
  argTypes: {
    pan: { control: { type: "range", min: -1, max: 1, step: 0.1 } },
    focus: {
      control: { type: "inline-radio" },
      options: ["no plane followed", "followed plane", "another plane"] satisfies Focus[],
    },
  },
  args: {
    pan: 0,
    focus: "no plane followed",
    room: true,
    chatter: true,
    pa: true,
    outside: true,
  },
};
export default meta;

/** A stand-in plane driven through a continuous sound's state (see `demos`). */
interface Demo {
  plane: Plane;
  /** Seconds since it started; the demo ends at `until`. */
  t: number;
  until: number;
  step: (plane: Plane, t: number) => void;
}

export const Effects: StoryObj<EffectsArgs> = {
  render: (args) => {
    active?.close();
    const audio = new GameAudio(null); // no storage: args decide
    audio.setMusicOn(false); // effects and ambience only
    audio.setScene("playing");
    active = audio;

    const state: GameState = createGameState();
    state.phase = "playing";
    const demos: Demo[] = [];
    const pan = () => args.pan;

    /** Run stand-in plane `id` through `step` for `until` seconds. */
    const demo = (id: number, setup: (p: Plane) => void, until: number, step: Demo["step"]) => {
      const plane = createPlane(id, "violet", { x: 0, y: 0 }, 0);
      setup(plane);
      state.planes.push(plane);
      demos.push({ plane, t: 0, until, step });
    };

    /**
     * Each button plays an effect from a fresh plane `id` (so the alert's
     * rate limit never mutes it); `focus` follows that plane, or another.
     */
    const focusOn = (id: number) =>
      audio.setFocus(
        args.focus === "followed plane" ? id : args.focus === "another plane" ? -1 : null,
      );
    const buttons: [string, (id: number) => void][] = [
      ["Departure chime", () => audio.chime()],
      [
        "Gear down",
        (id) => {
          audio.cue({
            type: "gearMove",
            planeId: id,
            down: true,
            seconds: GEAR_SECONDS,
            pan: args.pan,
          });
          setTimeout(
            () => audio.cue({ type: "gearLocked", planeId: id, down: true, pan: args.pan }),
            GEAR_SECONDS * 1000,
          );
        },
      ],
      [
        "Gear up",
        (id) => {
          audio.cue({
            type: "gearMove",
            planeId: id,
            down: false,
            seconds: GEAR_SECONDS,
            pan: args.pan,
          });
          setTimeout(
            () => audio.cue({ type: "gearLocked", planeId: id, down: false, pan: args.pan }),
            GEAR_SECONDS * 1000,
          );
        },
      ],
      [
        "Take-off",
        (id) =>
          // Line up (spool), roll to rotate speed, climb away.
          demo(
            id,
            (p) => {
              p.departure = {
                runway: "red",
                standId: 0,
                leaveStandS: 0,
                holdS: 0,
                uTurnS: 0,
                cleared: true,
                waited: 0,
                lineupTime: 0,
                speed: 0,
                climbed: 0,
              };
              p.phase = "outbound";
            },
            16,
            (p, t) => {
              const dep = p.departure!;
              if (t < 2) {
                dep.lineupTime = t;
              } else if (t < 8) {
                p.phase = "takeoff";
                p.ground = { speed: (t - 2) * (ROTATE_SPEED / 6) } as Plane["ground"];
              } else {
                p.phase = "climbout";
                p.ground = null;
                dep.speed = Math.min(PLANE_SPEED, ROTATE_SPEED + (t - 8) * 0.35);
                dep.climbed = (t - 8) * dep.speed;
              }
            },
          ),
      ],
      [
        "Touchdown + rollout",
        (id) => {
          audio.cue({ type: "touchdown", planeId: id, pan: args.pan });
          const v0 = PLANE_SPEED * LANDING_SPEED_START;
          demo(
            id,
            (p) => {
              p.phase = "landing";
              p.color = "red";
            },
            8,
            (p, t) => {
              p.ground = {
                speed: Math.max(0, v0 - 0.6 * t),
                travelled: FLARE_DISTANCE,
              } as Plane["ground"];
            },
          );
        },
      ],
      ["Go-around", (id) => audio.onSimEvent({ type: "goAround", planeId: id, color: "red" }, pan)],
      [
        "Bank whoosh",
        (id) => audio.cue({ type: "bankWhoosh", planeId: id, strength: 1, pan: args.pan }),
      ],
      ["Readback (path)", () => audio.readback(false)],
      ["Readback (cleared to land)", () => audio.readback(true)],
      // Not focused: the alert always plays at full level.
      ["Near-miss alert", (id) => audio.cue({ type: "warning", planeId: id, pan: args.pan })],
      ["PA announcement", () => audio.ambience?.announce()],
    ];

    const root = document.createElement("div");
    root.className =
      "flex h-full w-full items-center justify-center bg-slate-950 p-8 text-slate-100";
    const panel = document.createElement("div");
    panel.className =
      "w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg";
    panel.innerHTML = `
      <h2 class="glow-text mb-1 text-2xl font-black tracking-wider text-sky-400">Sound effects</h2>
      <p class="mb-5 text-sm text-slate-400">audio/sfx.ts + audio/ambience.ts, through the mixer</p>`;
    const start = document.createElement("button");
    start.className = "hud-button mb-5 w-auto px-4 text-base";
    start.textContent = "▶ Start audio";
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-2 gap-2";
    const status = document.createElement("div");
    status.className = "mt-4 text-sm text-slate-400";
    status.textContent = "Stopped: press Start (ambience plays once started).";
    for (const [label, play] of buttons) {
      const b = document.createElement("button");
      b.className = "hud-button h-auto w-full px-3 py-2 text-sm";
      b.textContent = label;
      b.addEventListener("click", () => {
        audio.unlock();
        const id = state.nextPlaneId++;
        focusOn(id);
        play(id);
        status.textContent = `Played: ${label}`;
      });
      grid.append(b);
    }
    start.addEventListener("click", () => {
      audio.unlock();
      for (const layer of AMBIENCE) audio.setAmbienceLayer(layer, args[layer]);
      status.textContent = "Playing: ambience on. Loading the PA voice…";
      void loadSpeech().then((ok) => {
        status.textContent = ok
          ? "Playing: ambience on, PA voice ready."
          : "Playing: ambience on (PA voice unavailable: wordless announcements).";
      });
    });
    // Speak any line through the PA.
    const say = document.createElement("div");
    say.className = "mt-3 flex gap-2";
    const text = document.createElement("input");
    text.className =
      "min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 text-sm text-slate-100";
    text.value = "Flight Violet two one four to Lisbon is now departing from the red runway.";
    text.setAttribute("aria-label", "Announcement text");
    const speakBtn = document.createElement("button");
    speakBtn.className = "hud-button h-auto w-auto px-4 py-2 text-sm";
    speakBtn.textContent = "Speak";
    speakBtn.addEventListener("click", () => {
      audio.unlock();
      audio.ambience?.announce(text.value);
      status.textContent = "Announcing…";
    });
    say.append(text, speakBtn);
    panel.append(start, grid, say, status);
    root.append(panel);

    // Per frame: advance the demo planes and let the mixer follow them.
    let mounted = false;
    let last = performance.now();
    const tick = (now: number) => {
      mounted ||= root.isConnected;
      if (mounted && !root.isConnected) {
        audio.close();
        if (active === audio) active = null;
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      for (const d of [...demos]) {
        d.t += dt;
        d.step(d.plane, d.t);
        if (d.t >= d.until) {
          demos.splice(demos.indexOf(d), 1);
          state.planes = state.planes.filter((p) => p !== d.plane);
        }
      }
      audio.update(state, pan);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return root;
  },
};
