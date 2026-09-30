/**
 * What the terminal PA says: the words of the announcements
 * (audio/ambience.ts voices them through audio/speech.ts).
 *
 * Pure text, no audio: each call picks a line and fills in a made-up
 * flight, destination and gate. Numbers are written out the way PA
 * announcers say them ("flight two one four", "gate twelve"), which is
 * also what the speech engine reads most naturally.
 *
 * Two kinds of line:
 * - terminal lines (`ANNOUNCEMENT_LINES.terminal`): boarding calls, final
 *   calls, gate changes, delays, reminders; pure atmosphere;
 * - game lines (`ANNOUNCEMENT_LINES.departure` / `.runwayOpen`): about what
 *   just happened on the field, e.g. a departure the game announced
 *   (see core/departures.ts).
 */
import type { Rng, RunwayColor } from "../core/types";

/**
 * Line templates. `{flight}`, `{city}`, `{gate}`, `{minutes}` and
 * `{runway}` are filled in by `fill`.
 *
 * TODO(you): write the airport's voice. These defaults are the classics of
 * a British regional terminal. Things to consider:
 *   - keep lines short (one or two sentences): the synthesiser is clearest
 *     on plain words, and a long line keeps the PA talking over the game;
 *   - the game lines are the ones players actually listen to, so they
 *     should say something useful (which runway is busy) rather than
 *     just flavour;
 *   - the speech engine reads punctuation: commas give a short pause, full
 *     stops a longer one.
 */
export const ANNOUNCEMENT_LINES = {
  terminal: [
    "Flight {flight} to {city} is now boarding at gate {gate}.",
    "This is the final call for passengers on flight {flight} to {city}. Please proceed immediately to gate {gate}.",
    "Passengers on flight {flight} to {city}, please note: this flight will now depart from gate {gate}.",
    "We regret to announce that flight {flight} to {city} is delayed by approximately {minutes} minutes.",
    "Please keep your baggage with you at all times. Unattended baggage may be removed.",
    "Passengers are reminded that smoking is not permitted anywhere in the terminal.",
    "Attention please. This is a final boarding call for passengers Luurrry - and - Geeena, booked on flight {flight} to {city}. Please proceed immediately to Gate {gate} where your flight is ready to depart.",
  ],
  departure: ["Flight {flight} to {city} is now departing from the {runway} runway."],
  runwayOpen: ["Ladies and gentlemen, the {runway} runway is now open."],
} as const;

/** Made-up airlines (said before the flight number) and destinations. */
const AIRLINES = ["Skyline", "Northwind", "Aerolink", "Bluebird", "Meridian", "Violet"];
const CITIES = [
  "Lisbon",
  "Dublin",
  "Oslo",
  "Vienna",
  "Madrid",
  "Edinburgh",
  "Copenhagen",
  "Geneva",
  "Prague",
  "Rome",
  "Paris",
  "Amsterdam",
];
const DELAYS = [10, 15, 20, 30, 45];

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0-99 in words ("forty five"). */
export function numberWords(n: number): string {
  if (n < 10) return ONES[n]!;
  if (n < 20) return TEENS[n - 10]!;
  const tens = TENS[Math.floor(n / 10)]!;
  return n % 10 === 0 ? tens : `${tens} ${ONES[n % 10]}`;
}

/** A flight number the PA way, digit by digit: 214 → "two one four". */
export function digitWords(n: number): string {
  return String(n)
    .split("")
    .map((d) => ONES[Number(d)]!)
    .join(" ");
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Fill a template's placeholders with random flight details. */
export function fill(template: string, rng: Rng, runway?: RunwayColor): string {
  const flight = `${pick(AIRLINES, rng)} ${digitWords(100 + Math.floor(rng() * 900))}`;
  return template
    .replaceAll("{flight}", flight)
    .replaceAll("{city}", pick(CITIES, rng))
    .replaceAll("{gate}", numberWords(1 + Math.floor(rng() * 20)))
    .replaceAll("{minutes}", numberWords(pick(DELAYS, rng)))
    .replaceAll("{runway}", runway ?? "main");
}

/** A random terminal announcement. */
export function terminalLine(rng: Rng): string {
  return fill(pick(ANNOUNCEMENT_LINES.terminal, rng), rng);
}

/** The announcement for a departure the game just rolled out, bound for `runway`. */
export function departureLine(runway: RunwayColor, rng: Rng): string {
  return fill(pick(ANNOUNCEMENT_LINES.departure, rng), rng, runway);
}

/** The announcement for a runway colour opening to arrivals. */
export function runwayOpenLine(runway: RunwayColor, rng: Rng): string {
  return fill(pick(ANNOUNCEMENT_LINES.runwayOpen, rng), rng, runway);
}
