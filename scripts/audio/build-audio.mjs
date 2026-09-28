#!/usr/bin/env node
/**
 * Builds the game's recorded sounds (src/audio/assets/) from real,
 * copyright-free field recordings, and the credits that go with them.
 *
 * Everything is described in scripts/audio/sources.json, one entry per
 * output file: which recording it comes from (Freesound id, title, author,
 * license, preview URL), which stretch of it to cut, and how to process it.
 * For each entry this script:
 *
 * 1. refuses the entry unless its license is on `ALLOWED_LICENSES` (our
 *    cuts are derivative works, and the game ships under GPL-3.0, so
 *    non-commercial and no-derivatives licenses can never be used);
 * 2. downloads the recording's public preview (MP3, no login needed) into
 *    .cache/audio-sources/ (git-ignored), once;
 * 3. cuts the stretch, mixes it to mono and levels it (RMS target, peak
 *    safe), then:
 *    - `loop`: bakes a crossfade from the stretch's tail into its head, so
 *      the file loops seamlessly, and encodes lossless FLAC (no encoder
 *      padding: the loop point is sample-exact);
 *    - `oneshot` / `bed`: short fades at both ends, encoded as MP3;
 * 4. writes src/audio/assets/<id>.flac|mp3.
 *
 * Then it writes the credits for every recording used:
 * src/audio/assets/credits.json (shown in the game's Licenses panel) and
 * CREDITS.md.
 *
 * The outputs are committed, so building the game needs neither ffmpeg
 * nor the network: only re-cutting does. ffmpeg comes from the
 * `ffmpeg-static` dev dependency (a binary for this machine, downloaded by
 * `npm install`), so there's nothing to install by hand.
 *
 * Usage:
 *   npm run audio:build                  build every entry
 *   npm run audio:build -- <id> [<id>]   build only these entries (credits: all)
 *   npm run audio:build -- --analyse <freesoundId> [seconds]
 *       print the recording's short-term loudness once a second, and the
 *       steadiest windows of `seconds` (default 5): the calmest stretches,
 *       free of bumps, chimes and announcements (candidates for a cut).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import FFMPEG from "ffmpeg-static";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCES = join(ROOT, "scripts", "audio", "sources.json");
const CACHE = join(ROOT, ".cache", "audio-sources");
const ASSETS = join(ROOT, "src", "audio", "assets");

/** SPDX ids of the licenses a recording may carry. */
const ALLOWED_LICENSES = ["CC0-1.0"];
const LICENSE_NAMES = { "CC0-1.0": "CC0 1.0 (public domain dedication)" };
const LICENSE_URLS = { "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/" };
const KINDS = ["loop", "oneshot", "bed"];

/** Sample rate of the loops (FLAC), and of everything else (MP3). */
const LOOP_RATE = 22050;
const MP3_RATE = 44100;
/** Defaults for an entry's `process` settings. */
const DEFAULTS = {
  /** Target RMS level, dBFS (then pulled down if the peak would clip). */
  normalize: -20,
  /** Seconds of the loop crossfade (loops only). */
  crossfade: 0.25,
  /** Fade in / out, seconds (one-shots and beds only). */
  fadeIn: 0.005,
  fadeOut: 0.05,
  /** MP3 bitrate, kbit/s. */
  bitrate: 80,
  /** Extra ffmpeg filter chain (e.g. "highpass=f=60"), or null. */
  filter: null,
};
/** Highest peak allowed after levelling (-0.4 dBFS). */
const PEAK_LIMIT = 0.955;

function fail(message) {
  console.error(`audio:build: ${message}`);
  process.exit(1);
}

/** Run a command, returning stdout (a Buffer); exit on failure. */
function run(cmd, args, input) {
  const result = spawnSync(cmd, args, { input, maxBuffer: 1 << 30 });
  if (result.error)
    fail(`${cmd}: ${result.error.message} (try npm install: ffmpeg comes from ffmpeg-static)`);
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")}\n${result.stderr.toString()}`);
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Read sources.json and check every entry before anything is built. */
function readSources() {
  const entries = JSON.parse(readFileSync(SOURCES, "utf8"));
  const ids = new Set();
  for (const e of entries) {
    const where = `entry "${e.id}"`;
    if (!e.id || ids.has(e.id)) fail(`${where}: missing or duplicate id`);
    ids.add(e.id);
    if (!KINDS.includes(e.kind)) fail(`${where}: kind must be one of ${KINDS.join(", ")}`);
    const s = e.source ?? {};
    for (const key of ["freesoundId", "title", "author", "url", "preview", "license"]) {
      if (!s[key]) fail(`${where}: source.${key} is missing`);
    }
    if (!ALLOWED_LICENSES.includes(s.license)) {
      fail(
        `${where}: license "${s.license}" is not allowed (allowed: ${ALLOWED_LICENSES.join(", ")})`,
      );
    }
    if (!(e.cut?.start >= 0) || !(e.cut?.length > 0))
      fail(`${where}: cut needs start >= 0 and length > 0`);
    if (!e.changes) fail(`${where}: "changes" (what was done to the recording) is missing`);
  }
  return entries;
}

/** The cached preview of a recording, downloaded on first use. */
async function fetchSource(source) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${source.freesoundId}.mp3`);
  if (existsSync(file)) return file;
  console.log(`  downloading ${source.url}`);
  const response = await fetch(source.preview);
  if (!response.ok) fail(`${source.preview}: HTTP ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

/** Duration of an audio file, seconds (from ffmpeg's own report of the input). */
function duration(file) {
  const info = spawnSync(FFMPEG, ["-hide_banner", "-i", file]).stderr.toString();
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  if (!m) fail(`${file}: can't read its duration`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/** Decode `seconds` of `file` from `start` as mono float samples at `rate`. */
function decode(file, start, seconds, rate, filter) {
  const args = ["-v", "error", "-ss", String(start), "-t", String(seconds), "-i", file, "-ac", "1"];
  if (filter) args.push("-af", filter);
  args.push("-ar", String(rate), "-f", "f32le", "-");
  const raw = run(FFMPEG, args);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

/** Scale to the target RMS (dBFS), pulled down if the peak would pass `PEAK_LIMIT`. */
function level(samples, targetDb) {
  let sum = 0;
  let peak = 0;
  for (const s of samples) {
    sum += s * s;
    peak = Math.max(peak, Math.abs(s));
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return samples;
  const gain = Math.min(10 ** (targetDb / 20) / rms, PEAK_LIMIT / peak);
  return samples.map((s) => s * gain);
}

/**
 * A seamless loop of `length` samples from `samples` (which holds
 * `length + fade` samples): the head is crossfaded with what follows the
 * loop's end, so playing past the end runs straight into the start.
 * Equal-power (sin / cos) curves: the recordings are noisy, uncorrelated
 * signals, which a linear crossfade would leave ~3 dB quieter mid-fade.
 */
function bakeLoop(samples, length, fade) {
  const out = samples.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const x = (i / fade) * (Math.PI / 2);
    out[i] = samples[i] * Math.sin(x) + samples[length + i] * Math.cos(x);
  }
  return out;
}

/** Linear fades over the first `fadeIn` and last `fadeOut` samples. */
function fadeEnds(samples, fadeIn, fadeOut) {
  const n = samples.length;
  for (let i = 0; i < fadeIn && i < n; i++) samples[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < n; i++) samples[n - 1 - i] *= i / fadeOut;
  return samples;
}

/** Encode mono float samples to `file` (FLAC for loops, else MP3). */
function encode(samples, rate, file, loop, bitrate) {
  const codec = loop
    ? ["-c:a", "flac", "-compression_level", "12"]
    : ["-c:a", "libmp3lame", "-b:a", `${bitrate}k`];
  const args = ["-v", "error", "-y", "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "-"];
  args.push(...codec, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags", "+bitexact", file);
  run(FFMPEG, args, Buffer.from(samples.buffer));
}

async function build(entry) {
  const p = { ...DEFAULTS, ...entry.process };
  const file = await fetchSource(entry.source);
  const total = duration(file);
  const loop = entry.kind === "loop";
  const extra = loop ? p.crossfade : 0;
  if (entry.cut.start + entry.cut.length + extra > total) {
    fail(
      `entry "${entry.id}": cut ends at ${entry.cut.start + entry.cut.length + extra}s, recording is ${total.toFixed(2)}s`,
    );
  }
  const rate = loop ? LOOP_RATE : MP3_RATE;
  let samples = decode(file, entry.cut.start, entry.cut.length + extra, rate, p.filter);
  samples = level(samples, p.normalize);
  const length = Math.round(entry.cut.length * rate);
  samples = loop
    ? bakeLoop(samples, length, Math.round(p.crossfade * rate))
    : fadeEnds(samples, Math.round(p.fadeIn * rate), Math.round(p.fadeOut * rate));
  const out = join(ASSETS, `${entry.id}.${loop ? "flac" : "mp3"}`);
  encode(samples, rate, out, loop, p.bitrate);
  console.log(
    `  ${entry.id}: ${entry.cut.length}s from ${entry.cut.start}s of #${entry.source.freesoundId}`,
  );
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

/** One credit per recording used, listing the files cut from it. */
function credits(entries) {
  const byRecording = new Map();
  for (const e of entries) {
    const s = e.source;
    const credit = byRecording.get(s.freesoundId) ?? {
      title: s.title,
      author: s.author,
      url: s.url,
      license: s.license,
      licenseName: LICENSE_NAMES[s.license],
      licenseUrl: LICENSE_URLS[s.license],
      changes: e.changes,
      files: [],
    };
    credit.files.push(`${e.id}.${e.kind === "loop" ? "flac" : "mp3"}`);
    byRecording.set(s.freesoundId, credit);
  }
  return [...byRecording.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function writeCredits(entries) {
  const list = credits(entries);
  writeFileSync(join(ASSETS, "credits.json"), `${JSON.stringify(list, null, 2)}\n`);
  const lines = [
    "# Sound credits",
    "",
    "The game's recorded sounds (`src/audio/assets/`) are cut from these field",
    "recordings, found on [Freesound](https://freesound.org). This file is",
    "generated by `npm run audio:build` from `scripts/audio/sources.json`.",
    "",
    ...list.map(
      (c) =>
        `- [${c.title}](${c.url}) by ${c.author}, ${c.licenseName} ([license](${c.licenseUrl})). ` +
        `${c.changes[0].toUpperCase()}${c.changes.slice(1)}: ${c.files.map((f) => `\`${f}\``).join(", ")}.`,
    ),
    "",
  ];
  writeFileSync(join(ROOT, "CREDITS.md"), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Print a recording's short-term loudness (LUFS, 3 s window) once a
 * second, then the steadiest windows of `seconds`: lowest spread, and no
 * second louder than the window's median by more than 4 LU (a chime, an
 * announcement, a laugh).
 */
async function analyse(freesoundId, seconds) {
  const entry = readSources().find((e) => String(e.source.freesoundId) === String(freesoundId));
  const file = entry ? await fetchSource(entry.source) : join(CACHE, `${freesoundId}.mp3`);
  if (!existsSync(file)) fail(`no entry uses #${freesoundId} and it isn't in ${CACHE}`);
  const log = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-v",
      "verbose",
      "-i",
      file,
      "-af",
      "ebur128=framelog=verbose",
      "-f",
      "null",
      "-",
    ],
    {
      maxBuffer: 1 << 30,
    },
  ).stderr.toString();
  const perSecond = [];
  for (const m of log.matchAll(/t:\s*([\d.]+)\s+TARGET.*?S:\s*(-?[\d.]+|-inf)/g)) {
    const t = Number(m[1]);
    if (Math.abs(t - Math.round(t)) < 0.05 && t >= 1)
      perSecond[Math.round(t)] = m[2] === "-inf" ? -70 : Number(m[2]);
  }
  const values = perSecond.map((v, t) => ({ t, v })).filter((x) => x.v !== undefined);
  console.log(`#${freesoundId}: ${duration(file).toFixed(1)}s`);
  console.log(values.map(({ t, v }) => `${String(t).padStart(4)}s ${v.toFixed(1)}`).join("\n"));
  const windows = [];
  for (let i = 0; i + seconds <= values.length; i++) {
    const w = values.slice(i, i + seconds).map((x) => x.v);
    const sorted = [...w].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const spread = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
    if (sorted.at(-1) - median <= 4) windows.push({ start: values[i].t - 1, spread, mean });
  }
  windows.sort((a, b) => a.spread - b.spread);
  console.log(`\nSteadiest ${seconds}s windows (start: spread LU, mean LUFS):`);
  const picked = [];
  for (const w of windows) {
    if (picked.some((p) => Math.abs(p.start - w.start) < seconds)) continue;
    picked.push(w);
    console.log(`  ${w.start}s: ${w.spread.toFixed(2)}, ${w.mean.toFixed(1)}`);
    if (picked.length === 8) break;
  }
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args[0] === "--analyse") {
  if (!args[1]) fail("usage: --analyse <freesoundId> [seconds]");
  await analyse(args[1], Number(args[2] ?? 5));
} else {
  const entries = readSources();
  const only = new Set(args);
  const unknown = [...only].filter((id) => !entries.some((e) => e.id === id));
  if (unknown.length) fail(`unknown entries: ${unknown.join(", ")}`);
  mkdirSync(ASSETS, { recursive: true });
  for (const entry of entries) {
    if (only.size === 0 || only.has(entry.id)) await build(entry);
  }
  writeCredits(entries);
  console.log(`audio:build: done (${entries.length} entries, credits written)`);
}
