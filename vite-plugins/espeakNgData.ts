/// <reference types="node" />
/**
 * Trims eSpeak NG's voice data down to the languages the game speaks.
 *
 * The speech engine (src/audio/speech.ts) is eSpeak NG compiled to
 * JavaScript (@echogarden/espeak-ng-emscripten). It reads its voice data
 * (phoneme tables, pronunciation dictionaries, language and voice
 * definitions) from a virtual file system, filled from one package file,
 * espeak-ng.data. That file holds every language eSpeak NG knows: ~24 MB,
 * most of it dictionaries the game never uses (Russian alone is 8.5 MB).
 *
 * Emscripten's loader describes the package in the engine's own code: a
 * list of files, each a byte range of espeak-ng.data. This plugin:
 * - rewrites that list in the engine to keep only the files for
 *   `languages` (plus the shared phoneme tables and voice variants), with
 *   byte ranges into a trimmed package (~1.2 MB instead of ~24 MB);
 * - serves the trimmed package: `virtual:espeak-ng-data` exports its URL
 *   (an emitted asset in the build, a dev-server route otherwise), which
 *   speech.ts fetches and hands to the engine (`getPreloadedPackage`).
 *
 * The engine must not be pre-bundled in dev (see vite.config.ts,
 * `optimizeDeps.exclude`), or this transform never sees it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const PACKAGE = "@echogarden/espeak-ng-emscripten";
const VIRTUAL_ID = "virtual:espeak-ng-data";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
/** Where the dev server serves the trimmed package. */
const DEV_URL = "/@espeak-ng/espeak-ng.data";
/** Where the voice data sits inside the engine's virtual file system. */
const DATA_DIR = "/usr/share/espeak-ng-data/";

/** Emscripten's package listing: `loadPackage({files:[...],remote_package_size:N})`. */
const LISTING = /loadPackage\(\{files:\[(.*?)\],remote_package_size:\d+\}\)/s;
const ENTRY = /\{filename:"([^"]+)",start:(\d+),end:(\d+)\}/g;

interface PackedFile {
  filename: string;
  start: number;
  end: number;
}

/**
 * Whether the game needs `path` (relative to the data directory):
 * - the phoneme tables and intonation, shared by every language;
 * - the voice variants (`voices/!v/`: m1-m8, f1-f5 and friends, a few
 *   hundred bytes each);
 * - each language's dictionary (`en_dict`) and definition files, the
 *   language itself and its accents (`lang/gmw/en`, `lang/gmw/en-GB-x-rp`).
 */
function needed(path: string, languages: readonly string[]): boolean {
  if (/^(phontab|phonindex|phondata|intonations)$/.test(path)) return true;
  if (path.startsWith("voices/!v/")) return true;
  const dict = /^(.+)_dict$/.exec(path);
  if (dict) return languages.includes(dict[1]!);
  if (path.startsWith("lang/")) {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    return languages.some((lang) => name === lang || name.startsWith(`${lang}-`));
  }
  return false;
}

/**
 * @param languages eSpeak language codes to keep ("en", "fr", ...): every
 *   voice speech.ts uses must be one of these or one of their accents.
 */
export function espeakNgData(languages: readonly string[]): Plugin {
  const engineFile = createRequire(import.meta.url).resolve(PACKAGE);
  let command: "build" | "serve" = "serve";
  let trimmed: { listing: string; data: Buffer } | undefined;

  /** Build the trimmed listing and package (once, on first use). */
  function trim(): { listing: string; data: Buffer } {
    if (trimmed) return trimmed;
    const engine = readFileSync(engineFile, "utf8");
    const listing = LISTING.exec(engine);
    if (!listing) throw new Error(`espeak-ng-data: no package listing in ${engineFile}`);
    const full = readFileSync(engineFile.replace(/\.js$/, ".data"));
    const files: PackedFile[] = [];
    const parts: Buffer[] = [];
    let offset = 0;
    for (const [, filename, start, end] of listing[1]!.matchAll(ENTRY)) {
      if (!needed(filename!.slice(DATA_DIR.length), languages)) continue;
      const bytes = full.subarray(Number(start), Number(end));
      files.push({ filename: filename!, start: offset, end: offset + bytes.length });
      parts.push(bytes);
      offset += bytes.length;
    }
    trimmed = {
      listing: `loadPackage(${JSON.stringify({ files, remote_package_size: offset })})`,
      data: Buffer.concat(parts),
    };
    return trimmed;
  }

  return {
    name: "espeak-ng-data",
    enforce: "pre",
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      if (command === "serve") return `export default ${JSON.stringify(DEV_URL)};`;
      const ref = this.emitFile({ type: "asset", name: "espeak-ng.data", source: trim().data });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    transform(code, id) {
      if (!id.split("?")[0]!.endsWith(`${PACKAGE}/espeak-ng.js`)) return null;
      return {
        code: code
          .replace(LISTING, () => trim().listing)
          // Dead code in the browser, but the bundler would go looking for
          // what it names: the .wasm file (this build is wasm2js, there's
          // none) and Node's "module" (only loaded when running in Node).
          .replace('new URL("espeak-ng.wasm",import.meta.url).href', '"espeak-ng.wasm"')
          .replace('await import("module")', "{}"),
        map: null,
      };
    },
    configureServer(server) {
      server.middlewares.use(DEV_URL, (_req, res) => {
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(trim().data);
      });
    },
  };
}
