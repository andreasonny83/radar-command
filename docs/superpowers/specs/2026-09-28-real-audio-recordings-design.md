# Real audio recordings for the terminal and the planes — design

Date: 2026-09-28
Status: approved in conversation, awaiting written-spec review

## Goal

Replace the synthesised terminal ambience and the synthesised aircraft sounds
with real, copyright-free (CC0) field recordings, so the airport sounds real,
while keeping every sound in sync with the game.

Success means:

- the terminal sounds like a real airport, loops without an audible seam, and
  has no audible PA announcement in it (ours is the only PA);
- each aircraft type (airliner, turboprop, light) sounds like its own engine,
  from spool-up through take-off roll and climb-out, following the plane on
  screen;
- touchdown, rollout, go-around, gear and bank whoosh use real recordings
  (gear as foley, see below), timed to the animation as today;
- every recording is credited in the game, `README.md` and `CREDITS.md`, and
  no recording with a license we can't comply with can ship;
- no new console errors, no startup delay (audio loads in the background).

## Scope

In scope (becomes recordings):

| Sound | Today | New |
|---|---|---|
| Terminal hum (`room` layer) | low-passed noise | 60 s terminal recording |
| Terminal crowd (`chatter` layer) | eSpeak voices + murmur (`crowd.ts`) | same recording (merged layer) |
| Take-off engines | synth voice per plane | idle + full-power loops per aircraft type |
| Rollout rumble | synth | rumble loop |
| Touchdown chirp + reverse thrust | synth | tyre-chirp one-shot; reverse-thrust one-shot (airliner) |
| Go-around | synth `jetRoar` | the plane type's full-power loop, same envelope |
| Gear whine + clunk | synth | foley: hydraulic-whine loop + steel-clunk one-shot |
| Bank whoosh | synth | 3 fly-by whoosh one-shots |

Out of scope (stay synthesised): departure chime, near-miss alert, radio
readback (UI signals, must stay crisp and distinct), PA chime and announcer
voice (eSpeak NG), the `outside` layer (distant jets, radio squelch), music.

## Decisions (from the brainstorm)

- Engine approach: short loops driven by game state (approach 1), not whole
  recordings played through, not a hybrid over the synth.
- Gear: foley from real mechanical/hydraulic recordings (no CC0 exterior gear
  recordings exist; cabin recordings rejected).
- Bank whoosh: included.
- Terminal source: Freesound #394173 "Airport Sound Effect Stuttgart Germany"
  (FreeToUseSounds, CC0 1.0, 10:12). Tagged "announcement" and "laughing":
  the cut must avoid both.
- Crowd (`crowd.ts`) is deleted, not kept as fallback. eSpeak NG data is
  trimmed to English only.
- No synth fallback while samples load or if one fails: that sound is silent
  and one warning is logged.
- Credit every recording, CC0 included.
- Builds on the uncommitted eSpeak NG swap (see "Dependencies").

## 1. Asset pipeline

### Files

- `scripts/audio/sources.json` — the single source of truth. One entry per
  output file:

  ```jsonc
  {
    "id": "engine-jet-full",             // output name (no extension)
    "kind": "loop",                      // "loop" | "oneshot" | "bed"
    "source": {
      "freesoundId": 439536,
      "title": "AIRPLANES_TAKEOFF_ZAVENTEM.wav",
      "author": "keng-wai-chane-chick-te",
      "url": "https://freesound.org/s/439536/",
      "license": "CC0-1.0"
    },
    "cut": { "start": 12.4, "length": 4.0 },
    "process": { "normalize": -18, "fade": 0.01 },
    "changes": "cut, mixed to mono, re-encoded"
  }
  ```

- `scripts/audio/build-audio.mjs` — for each entry:
  1. rejects the entry unless `source.license` is on the allow-list
     (`["CC0-1.0"]` for now; NC/ND licenses are never allowed: our cuts are
     derivatives and the game ships under GPL-3.0);
  2. downloads the Freesound HQ preview MP3 (public, no login) into the
     gitignored `.cache/audio-sources/`, once;
  3. runs `ffmpeg`: cut, mono, loudness-normalise, then encode:
     - `loop` → FLAC, 32 kHz mono, cut at zero crossings, no fades at the
       seam (sample-exact looping);
     - `oneshot` / `bed` → MP3, mono, 64–96 kbps, short fades;
  4. writes `src/audio/assets/<id>.flac|mp3`;
  5. writes `src/audio/assets/credits.json` and `CREDITS.md` from all entries.
- `npm run audio:build` runs the script. Outputs are committed: `npm run build`
  never needs `ffmpeg` or the network. Re-cutting needs `brew install ffmpeg`.
- `.gitignore` gains `.cache/`.
- Running the script twice with no changes produces byte-identical outputs.

### Choosing cuts

Cut points are chosen by measurement over the source (short-term loudness):
the steadiest window for loops and the bed (rejects chimes, announcements,
laughter, bumps), the sharpest clean transient for one-shots. The user then
listens in the "Audio/Samples" story and adjusts `cut` in `sources.json`.

### Output set (15 files: 8 FLAC loops, 7 MP3; ~1.8 MB total)

| id | kind | format | Candidate source (Freesound, CC0) |
|---|---|---|---|
| `terminal` | bed, 60 s | MP3 | 394173 Stuttgart terminal |
| `engine-jet-idle` | loop | FLAC | 152509 jet_engine / 439536 Zaventem |
| `engine-jet-full` | loop | FLAC | 439536 Zaventem / 195051 737-800 take-off |
| `engine-turboprop-idle` | loop | FLAC | 502670 King Air 350 |
| `engine-turboprop-full` | loop | FLAC | 502670 King Air 350 / 502671 Turbo Commander |
| `engine-piston-idle` | loop | FLAC | 322321 Cessna start, idle, take-off |
| `engine-piston-full` | loop | FLAC | 322321 Cessna |
| `rollout` | loop | FLAC | 262755 stereo jet landing / 447826 737 landing |
| `gear-hydraulic` | loop | FLAC | 342463 / 212941 hydraulics |
| `touchdown-chirp` | oneshot | MP3 | 104026 tires squeaking / landing recordings |
| `reverse-thrust` | oneshot | MP3 | 262755 / 447826 |
| `gear-clunk` | oneshot | MP3 | 123253 mechanical clamp |
| `whoosh-1..3` | oneshot | MP3 | 168079 / 168078 jet flyby, 623015 whoosh passby, 431206 flyby |

Candidates are provisional: each is checked for license (CC0 on its page),
perspective (exterior) and cleanliness before it's used; any can be swapped
for another CC0 recording.

## 2. Loading and ambience

### `src/audio/samples.ts` (new)

- `type SampleId` — union of the ids above.
- `loadSamples(ctx: BaseAudioContext): Promise<Samples>` — fetches and decodes
  every file under `src/audio/assets/` in parallel (URLs via Vite asset
  imports), once; later calls share the promise.
- `Samples` — `get(id): AudioBuffer | null`. A file that fails to fetch or
  decode is `null` and logs one warning; the rest still load.
- Started when the mixer unlocks audio (first click), next to `loadSpeech()`.

### Terminal bed (in `ambience.ts`)

- Plays the `terminal` buffer as two alternating sources crossfaded over 3 s
  (hides MP3 padding and the restart), through a gentle low-pass (heard from
  the tower), into the new `terminal` layer.
- Level set by measurement to match the old `room` + `chatter` RMS.
- Layers become `terminal` · `pa` · `outside` (`AMBIENCE_LEVELS`,
  `AmbienceLayer`, `setLayer`, the mixer's `setAmbienceLayer`).
- Removed: `crowd.ts`, `startRoomTone`, crowd scheduling hooks
  (`restart`/`update`/`dispose` calls), `speakAs`, `SpeechStyle` and
  `CROWD_VOICES` (`speak` sets the announcer voice directly);
  `espeakNgData(["en"])` in `vite.config.ts`.
- Unchanged: PA chime + announcer, `outside`, the look-ahead scheduler, mixer
  buses, mute, pause.

## 3. Plane sounds (`sfx.ts`)

### Aircraft type in core

- New `src/core/fleet.ts`: `AircraftKind` and `aircraftKindFor(id)` move here
  from `render/aircraft.ts` unchanged, with the `TODO(you)` fleet-mix note.
- `render/` imports them from `core/fleet.ts`. `audio/` uses them to pick
  samples. Layering stays one-way (core ← render, core ← audio).
- Kind → sample family: `airliner` → `jet`, `turboprop` → `turboprop`,
  `light` → `piston`.

### Engine voice (per plane, from `engineSound()`)

- Two looping sources (the kind's `idle` and `full` loops), each through its
  own gain, summed into a low-pass → stereo panner → voice gain.
- Crossfade by `level` with equal-power gains:
  `idleGain = cos(level·π/2)`, `fullGain = sin(level·π/2)`.
- `playbackRate` from `speed`, clamped to 0.85–1.25.
- Low-pass cutoff rises with `level` (brighter under power, duller as the
  climb-out fade lowers `level`).
- Voice gain = `ENGINE_VOLUME · level · focusLevel(planeId)`; pan from the
  `PanLookup`; parameter changes smoothed with `ENGINE_SMOOTHING` as today.
- Loops start at a random offset so simultaneous planes don't phase.
- Stop / fade-out on voice removal as today.

### Rollout

- `rollout` loop per landing plane: gain from `rolloutLevel()` × kind scale
  (light < turboprop < airliner), `playbackRate` 0.8–1.1 by roll level.

### One-shots

- **Touchdown** (`touchdown` cue): `touchdown-chirp` for every kind, pitch and
  level scaled by kind; `reverse-thrust` layered for airliners.
- **Go-around** (`goAround(pan, planeId)`): the plane kind's `full` loop with
  today's envelope (0 → 40 % at 0.3 s → 100 % at 2 s, hold to 3 s, fade to 0
  at 4.8 s). No new file.
- **Gear move** (`gearMove` cue): `gear-hydraulic` looped for exactly
  `seconds`, 50 ms fades, `playbackRate` ramping 1.0 → 1.08 over the travel;
  retract pitched ~5 % above extend.
- **Gear locked** (`gearLocked` cue): `gear-clunk`, `playbackRate` 0.9 (down)
  / 1.05 (up), down slightly louder.
- **Bank whoosh** (`bankWhoosh` cue): random pick of `whoosh-1..3`, gain and
  `playbackRate` (0.9–1.2) from `strength`.

All keep follow-mode focus and panning as today. A missing sample means that
sound is skipped.

### Removed synth code

`createEngine` synth graph, `createRollout` synth graph, `jetRoar`,
synth `gearWhine`, `gearClunk`, `touchdown`, `whoosh`, and helpers only they
use. Kept: `chime`, `alert`, `readback` and their helpers (`bell`, `beep`,
`click`, `squelchBurst`), `noiseBuffer` (used by `outside`).

## 4. Licensing, docs, Storybook

### Licensing and credits

- `ui/licenses.ts` gains a "Sound recordings" list rendered from
  `src/audio/assets/credits.json`: title, author, Freesound link, license,
  changes made. `public/licenses/CC0-1.0.txt` holds the CC0 legal code.
- `CREDITS.md` (generated) lists the same; `README.md` credits link to it.
- `CLAUDE.md`: audio pipeline + "run `npm run audio:build` after editing
  `sources.json`"; "no asset files" → "recordings in `src/audio/assets/`";
  `core/fleet.ts`; new ambience layers; crowd removed.

### Storybook

- "Audio/Effects": layer toggles `terminal` / `pa` / `outside`; per-kind
  buttons for take-off, touchdown and gear; a "samples loaded" status line;
  doc comments naming constants updated.
- New "Audio/Samples" story: every asset with play and loop toggle — the
  listening bench for cut decisions.
- Licenses panel stories show the new section.
- Aircraft stories import `AircraftKind` from `core/fleet.ts`.

## Error handling

- `audio:build`: fails loudly on a disallowed license, a download failure, an
  `ffmpeg` error or a cut outside the source's duration.
- Runtime: per-file fetch/decode failure → `null` + one `console.warn`; the
  sound is skipped, everything else plays.
- Audio context not yet unlocked: nothing loads or plays (as today).

## Testing and verification

- No new unit tests (CLAUDE.md: tests ignored for now). `core/fleet.ts` is a
  pure move.
- `npm run typecheck`, `lint`, `build`, `build-storybook` pass.
- `npm run audio:build` twice → identical outputs.
- Browser (dev and `preview`): every asset 200 + decodes, no console errors;
  play a shift through a departure, a landing and a go-around.
- Every story renders without console/page errors.
- Levels: offline renders (`OfflineAudioContext`) of old synth vs new sample
  voices, matched by RMS so the mix balance holds.
- User listening checklist: terminal seam and no announcement; engine idle →
  full blend per kind; touchdown and reverse thrust; gear timing against the
  animation; whoosh variety.

## Dependencies and assumptions

- Builds on the uncommitted eSpeak NG swap (`vite-plugins/espeakNgData.ts`);
  English-only trimming assumes it stays. If meSpeak returns instead, the crowd
  removal still applies and only the trimming step changes.
- `ffmpeg` is a local developer tool (Homebrew), not a project dependency.
- Freesound HQ previews (~128 kbps MP3) are the source material: fine for
  mono, filtered game audio.
