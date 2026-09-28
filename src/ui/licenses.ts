/**
 * What the Licenses panel (ui/hudMarkup.ts `licensesPanelMarkup`) shows:
 * the project's own license, how the game as served is licensed, and a
 * notice for every third-party component bundled into it.
 *
 * Why the game as a whole is GPL-3.0: the PA announcer's voice
 * (audio/speech.ts) is eSpeak NG, the speech synthesiser, compiled to
 * JavaScript, and it's GPL-3.0. The project's own source stays ISC (LICENSE), but
 * serving the game conveys the combined work, which has to follow the GPL:
 * its full text travels with the game, and the complete source is public.
 *
 * Full license texts live in public/licenses/ (copied verbatim from the
 * packages) and are fetched when the panel opens; the ISC text comes from
 * the repository's LICENSE file itself.
 *
 * Adding a runtime dependency? Add its notice here and its license text to
 * public/licenses/, then check the "HUD/Elements/LicensesPanel" story.
 */
import projectLicense from "../../LICENSE?raw";
import { GITHUB_REPO_URL } from "./links";

/** The project's own ISC license text (the repository's LICENSE file). */
export const PROJECT_LICENSE_TEXT = projectLicense;

/** A third-party component bundled into the game. */
export interface ThirdPartyNotice {
  name: string;
  /** What it does in the game. */
  role: string;
  /** SPDX identifier. */
  license: string;
  copyright: string;
  /** Where to find it (and its source). */
  url: string;
  /** Full license text, under public/ (fetched when shown). */
  text: string;
}

export const THIRD_PARTY: readonly ThirdPartyNotice[] = [
  {
    name: "eSpeak NG (speech synthesiser)",
    role: "The voices of the terminal PA announcements and the crowd",
    license: "GPL-3.0",
    copyright:
      "© 2005–2014 Jonathan Duddington, © 2015– Reece H. Dunn and the eSpeak NG contributors; JavaScript port by Eitan Isaacson (espeakng.js) and the Echogarden project",
    url: "https://github.com/echogarden-project/espeak-ng-emscripten",
    text: "licenses/GPL-3.0.txt",
  },
  {
    name: "Babylon.js",
    role: "3D rendering engine",
    license: "Apache-2.0",
    copyright: "© Babylon.js contributors",
    url: "https://github.com/BabylonJS/Babylon.js",
    text: "licenses/babylonjs.txt",
  },
  {
    name: "Vercel Web Analytics",
    role: "Anonymous page-view counts",
    license: "MIT",
    copyright: "© Vercel, Inc.",
    url: "https://github.com/vercel/analytics",
    text: "licenses/vercel-analytics.txt",
  },
  {
    name: "Tailwind CSS",
    role: "Compiled into the game's stylesheet",
    license: "MIT",
    copyright: "© Tailwind Labs, Inc.",
    url: "https://github.com/tailwindlabs/tailwindcss",
    text: "licenses/tailwindcss.txt",
  },
];

/** The GPL text shown in full at the end of the panel. */
export const GPL_TEXT = "licenses/GPL-3.0.txt";

/** Where the complete corresponding source of the game can be found. */
export const SOURCE_URL = GITHUB_REPO_URL;

/** URL of a license text under public/, respecting the app's base path. */
export function licenseTextUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
