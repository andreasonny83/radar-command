# Real audio recordings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synthesised terminal ambience and aircraft sounds with real CC0 recordings, driven by the existing game state and cues.

**Architecture:** A reproducible pipeline (`scripts/audio/`) cuts Freesound CC0 previews into 15 committed assets plus generated credits. A runtime loader (`audio/samples.ts`) decodes them once after the first click and hands buffers to the ambience (terminal bed) and sfx (per-kind engine loops, rollout, one-shots). Aircraft kind moves to `core/fleet.ts` so audio can use it without importing the renderer.

**Tech Stack:** TypeScript, Web Audio API, Vite asset imports, Node script + `ffmpeg` (dev-only, Homebrew), Storybook.

**Spec:** `docs/superpowers/specs/2026-09-28-real-audio-recordings-design.md`

## Global Constraints

- Allowed source licenses: `["CC0-1.0"]` only; NC/ND never.
- Loops: FLAC, mono, 32 kHz, sample-exact. One-shots and bed: MP3, mono, 64–96 kbps.
- Assets live in `src/audio/assets/` and are committed; `npm run build` needs neither `ffmpeg` nor network.
- Every recording is credited (title, author, Freesound link, license, changes) in the Licenses panel, `CREDITS.md` and `README.md`.
- Engine `playbackRate` clamped to 0.85–1.25; idle/full crossfade equal-power (`cos`/`sin` of `level·π/2`).
- No synth fallback: a missing sample means that sound is skipped (one `console.warn` per failed file).
- Stay synthesised: chime, near-miss alert, readback, PA chime + eSpeak voice, `outside` layer, music.
- Layer names become `terminal` · `pa` · `outside`.
- Unit tests: none (CLAUDE.md: tests ignored for now). Verification is typecheck, lint, build, browser checks and Storybook sweep.
- Keep all Babylon code in `src/render/`, pure logic in `src/core/` (no DOM/Babylon/Web Audio there).
- Commits go on `feat/real-audio`, one per task, ending with the Co-Authored-By line.

## Review Focus

1. Samples not decoded yet when a departure/landing/gear cue fires → that sound is skipped silently, no exception, and later planes get sound once loaded.
2. Many simultaneous planes (5+ engine voices + rollouts) → no clicks on voice creation/removal; voices fade out over ~0.25 s and stop.
3. Pause, tab hidden, crash, restart shift → engines stop with the sfx bus as today; terminal bed keeps playing through pause (ambience bus) and restarts cleanly after a gap in the scheduler.
4. A source whose license isn't CC0, or a cut beyond the source length → `audio:build` exits non-zero with a clear message and writes nothing for that entry.
5. Terminal bed loop boundary → crossfade overlaps, no silence or level dip at the seam; no audible PA announcement inside the cut.

(Each is checked in the task that owns it: 1–3 in Tasks 3, 4, 6, 7 browser checks; 4 in Task 1; 5 in Tasks 2 and 4.)

---

### Task 1: Audio build pipeline

**Files:**
- Create: `scripts/audio/build-audio.mjs`, `scripts/audio/sources.json`
- Modify: `package.json` (script `audio:build`), `.gitignore` (`.cache/`), `eslint.config.js` (node globals for `scripts/`)

**Interfaces:**
- Produces: `npm run audio:build` → writes `src/audio/assets/<id>.(flac|mp3)`, `src/audio/assets/credits.json`, `CREDITS.md`. `node scripts/audio/build-audio.mjs --analyse <freesoundId>` prints per-second loudness (LUFS short-term) for choosing cuts.
- `credits.json`: `{ id, title, author, url, license, changes }[]`.

- [ ] **Step 1:** `sources.json` schema per spec §1 (`id`, `kind: "loop"|"oneshot"|"bed"`, `source{freesoundId,title,author,url,preview,license}`, `cut{start,length}`, `process{normalize?, fade?, rate?}`, `changes`).
- [ ] **Step 2:** `build-audio.mjs`:
  - validate every entry first (license allow-list, `kind`, cut > 0); abort with `process.exit(1)` and the entry id on failure;
  - download `source.preview` to `.cache/audio-sources/<freesoundId>.mp3` if missing (fetch; non-200 → exit 1);
  - probe duration with `ffprobe`; `cut.start + cut.length` beyond it → exit 1;
  - `ffmpeg -ss start -t length -i src -ac 1` + `loudnorm`/`volume` normalise + `afade` (not for loops) → `-ar 32000 -c:a flac` (loop) or `-ar 44100 -c:a libmp3lame -b:a 80k` (oneshot/bed); `-map_metadata -1 -fflags +bitexact` for byte-identical reruns;
  - loops: after cut, trim both ends to the nearest rising zero crossing (`ffmpeg` decode to raw f32 in Node, find crossings, re-encode) so the seam is sample-exact;
  - write `credits.json` (sorted by id) and `CREDITS.md`;
  - `--analyse <freesoundId>`: `ffmpeg -af ebur128` on the cached preview, print `t=… S=…` once per second.
- [ ] **Step 3:** `package.json` → `"audio:build": "node scripts/audio/build-audio.mjs"`; `.gitignore` → `.cache/`.
- [ ] **Step 4:** Verify failure paths: temporarily set one entry's license to `CC-BY-NC-4.0` → exit 1 naming it; set `cut.start` past duration → exit 1. Restore.
- [ ] **Step 5:** `npm run lint` passes; commit `feat(audio): add CC0 recording pipeline`.

### Task 2: Choose cuts, produce the 15 assets

**Files:**
- Modify: `scripts/audio/sources.json`
- Create: `src/audio/assets/*.flac|*.mp3`, `src/audio/assets/credits.json`, `CREDITS.md`

- [ ] **Step 1:** For each candidate in the spec's output table, fetch its Freesound page and confirm "Creative Commons 0" and the preview URL (`cdn.freesound.org/previews/.../<id>_<user>-hq.mp3`). Swap any candidate that isn't CC0, isn't exterior, or is too noisy.
- [ ] **Step 2:** `--analyse` each source; pick windows: `terminal` = the 60 s window with the lowest short-term-loudness variance (reject spikes > +4 LU over the median: chimes, announcements, laughter); loops = steadiest 3–6 s at idle / full power; one-shots = the transient plus its tail.
- [ ] **Step 3:** `npm run audio:build`; run it again and `git status` shows no changes to `src/audio/assets/` (byte-identical).
- [ ] **Step 4:** Total size of `src/audio/assets/` ≤ ~2 MB (`du -ch`).
- [ ] **Step 5:** Commit `feat(audio): add CC0 terminal and aircraft recordings`.

### Task 3: Sample loader, mixer wiring, "Audio/Samples" story

**Files:**
- Create: `src/audio/samples.ts`, `src/audio/samples.stories.ts`
- Modify: `src/audio/mixer.ts` (create `Samples` on unlock, pass to `Sfx` and `Ambience`)

**Interfaces:**
- Produces:
  ```ts
  export type SampleId =
    | "terminal" | "engine-jet-idle" | "engine-jet-full" | "engine-turboprop-idle"
    | "engine-turboprop-full" | "engine-piston-idle" | "engine-piston-full" | "rollout"
    | "gear-hydraulic" | "touchdown-chirp" | "reverse-thrust" | "gear-clunk"
    | "whoosh-1" | "whoosh-2" | "whoosh-3";
  export const SAMPLE_URLS: Record<SampleId, string>; // Vite `?url` imports
  export class Samples {
    constructor(ctx: BaseAudioContext);          // starts loading at once
    readonly ready: Promise<void>;               // settles when every file has loaded or failed
    get(id: SampleId): AudioBuffer | null;       // null until decoded, or if it failed
  }
  ```
- `Sfx` constructor becomes `(ctx, out, samples: Samples)`; `Ambience` becomes `(ctx, out, samples: Samples, seed)`.

- [ ] **Step 1:** Write `samples.ts` (explicit `import url from "./assets/x.flac?url"` per id; `fetch` → `arrayBuffer` → `decodeAudioData`; per-file `catch` → `console.warn` once, leave null).
- [ ] **Step 2:** `mixer.ts`: on unlock `const samples = new Samples(ctx)`; pass into `Sfx` and `Ambience`.
- [ ] **Step 3:** `samples.stories.ts` "Audio/Samples": Start button, one row per `SampleId` with ▶ play, loop toggle (loops default on), duration; status "N/15 loaded".
- [ ] **Step 4:** `npm run typecheck`; Storybook: every row plays, network shows 15 × 200, no console errors.
- [ ] **Step 5:** Commit `feat(audio): load recordings and add Audio/Samples story`.

### Task 4: Terminal bed replaces room tone and crowd

**Files:**
- Modify: `src/audio/ambience.ts`, `src/audio/speech.ts`, `vite.config.ts`, `src/audio/effects.stories.ts`, `src/audio/mixer.ts` (layer type only)
- Delete: `src/audio/crowd.ts`

**Interfaces:**
- Produces: `AMBIENCE_LEVELS = { terminal: 1, pa: 1, outside: 1 }`; `speech.ts` exports `ANNOUNCER_VOICES`, `loadSpeech`, `speak` only.

- [ ] **Step 1:** In `update()`, schedule the bed on the look-ahead clock: `while (nextBed < horizon)` start a source of `terminal` at `nextBed` with gain 0 → `TERMINAL_LEVEL` over `BED_CROSSFADE` (3 s), hold, → 0 over the last 3 s; `nextBed += duration − BED_CROSSFADE`. Reset `nextBed = now` in the "first call / after gap" branch. Skip while the sample is null. Route through a low-pass (`BED_CUTOFF` ≈ 5 kHz) into `layers.terminal`. Track sources for `dispose`.
- [ ] **Step 2:** Delete `crowd.ts`, `startRoomTone`, `ROOM_LEVEL`, the chatter hall chain and crowd calls; rename layers; update the header comment.
- [ ] **Step 3:** `speech.ts`: drop `CROWD_VOICES`, `CrowdVoice`, `SpeechStyle`, `speakAs`; `speak` sets `en-gb-x-rp+variant`, rate, pitch itself. `vite.config.ts`: `espeakNgData(["en"])`.
- [ ] **Step 4:** `effects.stories.ts`: args/toggles `terminal`, `pa`, `outside`; doc comment updated (no crowd).
- [ ] **Step 5:** typecheck + build; data asset shrinks; Effects story: bed plays, toggle works, seam at ~57 s has no dip. Commit `feat(audio): real terminal ambience replaces synth room and crowd`.

### Task 5: Aircraft kind in core

**Files:**
- Create: `src/core/fleet.ts`
- Modify: `src/render/aircraft.ts` (remove definitions, `export { type AircraftKind, aircraftKindFor } from "../core/fleet";`)

**Interfaces:**
- Produces: `export type AircraftKind = "airliner" | "turboprop" | "light"; export function aircraftKindFor(id: number): AircraftKind;` (body and `TODO(you)` comment moved verbatim).

- [ ] **Step 1:** Move; re-export from `render/aircraft.ts` so render importers are unchanged.
- [ ] **Step 2:** typecheck; commit `refactor: move aircraft kind to core/fleet`.

### Task 6: Engine and rollout voices from recordings

**Files:**
- Modify: `src/audio/sfx.ts`

**Interfaces:**
- Consumes: `Samples.get`, `aircraftKindFor`.
- Produces: `ENGINE_FAMILY: Record<AircraftKind, "jet" | "turboprop" | "piston">`, `KIND_SCALE: Record<AircraftKind, number>` (light 0.55, turboprop 0.8, airliner 1).

- [ ] **Step 1:** `EngineVoice = { idle, full: AudioBufferSourceNode; idleGain, fullGain: GainNode; tone: BiquadFilterNode; out: GainNode; pan: StereoPannerNode }`. `createEngine(kind)` returns null if either loop is missing. Both sources `loop = true`, started at a random offset.
- [ ] **Step 2:** In `update`: `idleGain = cos(level·π/2)`, `fullGain = sin(level·π/2)`; `playbackRate = clamp(0.85 + 0.4·speed, 0.85, 1.25)` on both; `tone.frequency = 900 + 7000·level`; `out.gain = ENGINE_VOLUME · level · focus`; all via `setTargetAtTime(…, ENGINE_SMOOTHING)`.
- [ ] **Step 3:** Rollout: `rollout` loop, gain `ROLLOUT_VOLUME · roll · KIND_SCALE[kind] · focus`, `playbackRate 0.8 + 0.3·roll`.
- [ ] **Step 4:** Remove synth engine/rollout graphs. Effects story Take-off / Touchdown buttons still work.
- [ ] **Step 5:** typecheck; commit `feat(audio): recorded engine and rollout voices per aircraft kind`.

### Task 7: One-shots from recordings

**Files:**
- Modify: `src/audio/sfx.ts`, `src/audio/effects.stories.ts`

- [ ] **Step 1:** `playSample(id, pan, level, t, { rate?, gain?, loopFor? })` helper returning the source (null if missing).
- [ ] **Step 2:** touchdown: `touchdown-chirp` (rate 1.1 light / 1 turboprop / 0.9 airliner, level · KIND_SCALE) + `reverse-thrust` at +0.3 s for airliners.
- [ ] **Step 3:** goAround: kind's `full` loop, today's envelope, stop at 5 s.
- [ ] **Step 4:** gearMove: `gear-hydraulic` looped for `seconds`, 50 ms fades, rate 1.0→1.08 (retract ×1.05); gearLocked: `gear-clunk` rate 0.9 down / 1.05 up, down ×1.2 gain.
- [ ] **Step 5:** whoosh: random `whoosh-1..3`, gain `LEVELS.whoosh · min(1.3, strength)`, rate `0.9 + 0.3·min(1, strength)`.
- [ ] **Step 6:** Delete `jetRoar`, `thump`, synth `gearWhine`/`gearClunk`/`touchdown`/`whoosh`, now-unused `click` and `noiseSource` only if unused (readback/alert keep `beep`, `squelchBurst`, `bell`). Update header comment.
- [ ] **Step 7:** Effects story: per-kind rows (airliner / turboprop / light) for Take-off, Touchdown + rollout, Gear down, Gear up, Go-around (ids picked so `aircraftKindFor(id)` matches); "samples loaded" status.
- [ ] **Step 8:** typecheck, lint; commit `feat(audio): recorded touchdown, go-around, gear and whoosh`.

### Task 8: Levels by measurement

**Files:**
- Modify: `src/audio/sfx.ts`, `src/audio/ambience.ts` (level constants only)

- [ ] **Step 1:** In the browser, render old (git `HEAD~n`) vs new voices through an `OfflineAudioContext` and compare RMS: engine at full power, rollout, touchdown, gear, whoosh, go-around; terminal bed vs old room + chatter.
- [ ] **Step 2:** Set `ENGINE_VOLUME`, `ROLLOUT_VOLUME`, `LEVELS.*`, `TERMINAL_LEVEL` so each is within ±1.5 dB of the old; update the level comments.
- [ ] **Step 3:** Commit `tune(audio): match recorded levels to the old mix`.

### Task 9: Licenses, credits, docs

**Files:**
- Create: `public/licenses/CC0-1.0.txt`
- Modify: `src/ui/licenses.ts` (`RECORDINGS` from `credits.json`), `src/ui/hudMarkup.ts` ("Sound recordings" section + CC0 text), `README.md`, `CLAUDE.md`, story comments naming changed files

- [ ] **Step 1:** CC0 legal code text into `public/licenses/CC0-1.0.txt`.
- [ ] **Step 2:** Licenses panel lists every recording (title linked, author, license, changes) and the CC0 text.
- [ ] **Step 3:** README credits → `CREDITS.md`; CLAUDE.md: pipeline, `npm run audio:build`, assets rule, `core/fleet.ts`, layers, crowd removed, "Audio/Samples" story.
- [ ] **Step 4:** Commit `docs: credit recordings in Licenses panel, README and CLAUDE.md`.

### Task 10: Full verification

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm run build && npm run build-storybook`.
- [ ] **Step 2:** Dev + preview: start a shift; network: 15 assets 200; play through a departure, landing, go-around; no console errors besides the known Vercel 404.
- [ ] **Step 3:** Storybook sweep: every story renders without console/page errors.
- [ ] **Step 4:** Stop dev/preview/Storybook servers and the headless browser.
- [ ] **Step 5:** Report with the user's listening checklist.
