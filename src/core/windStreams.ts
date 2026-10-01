/**
 * Wind streams: the difficulty layer that arrives with the second game day.
 *
 * A stream is a band of strong wind across the map. It lives in four
 * phases (see `windPhase`): `forecast` (a HUD warning only, see
 * ui/weatherAlerts.ts; nothing on the map yet), `forming` (a warning the
 * player can see and route around; harmless), `active` (pushes planes and
 * erases their paths) and `fading` (the push dies down). A flying plane that flies into an
 * active stream loses the path it was given, so the player has to draw it
 * again; while inside, it is pushed sideways along the wind (`Plane.wind`,
 * applied in core/plane.ts) and shaken by small heading shoves
 * (`Plane.windTurn`).
 *
 * From the third game day some streams spawn black. A black stream does all
 * of the above, and in addition kills any flying plane inside it during its
 * peak window (`isLethal`): `BLACK_PEAK_DELAY` seconds into the active phase,
 * for `BLACK_PEAK_SECONDS`. `BLACK_PEAK_WARN` seconds before that the build-up
 * (`isPeakWarning`) is shown and heard, so the danger is never a surprise.
 *
 * Streams only start once a whole game day has passed
 * (`DAY_SECONDS` of `state.elapsed`), and more of them can be up at once
 * each further day (`windLevel`). Departures, which the game flies, and
 * planes on the ground are not affected. Like all of `core`, nothing in
 * here knows about drawing; render/windStreams.ts shows the bands.
 */
import {
  BLACK_PEAK_DELAY,
  BLACK_PEAK_SECONDS,
  BLACK_PEAK_WARN,
  BLACK_WIND_FROM_DAY,
  BLACK_WIND_SHARE,
  WIND_ACTIVE_SECONDS,
  WIND_DRIFT,
  WIND_FADE_SECONDS,
  WIND_FORECAST_SECONDS,
  WIND_FORM_SECONDS,
  WIND_GAP_MAX,
  WIND_GAP_MIN,
  WIND_LENGTH,
  WIND_MAX_STREAMS,
  WIND_TURN,
  WIND_TURN_RATE,
  WIND_WIDTH,
} from "../config";
import { DAY_SECONDS } from "./daytime";
import { pointInRect } from "./geometry";
import { airspaceBounds } from "./layout";
import { headingVector, lerp } from "./math";
import type { GameState, Plane, Rng, SimEvent, WarningLevel, WindPhase, WindStream } from "./types";

/** Seconds a stream lives from first showing on the map to gone. */
export const WIND_LIFETIME = WIND_FORM_SECONDS + WIND_ACTIVE_SECONDS + WIND_FADE_SECONDS;

/**
 * How many streams may be up at once after `elapsed` seconds: none on the
 * first game day, one on the second, one more each day after, up to
 * `WIND_MAX_STREAMS`.
 */
export function windLevel(elapsed: number): number {
  return Math.min(WIND_MAX_STREAMS, Math.max(0, Math.floor(elapsed / DAY_SECONDS)));
}

/**
 * How serious the warning for `stream` is, in the Met Office's terms (see
 * ui/weatherAlerts.ts): yellow for an ordinary stream, red for a black one
 * (the player is never told it is "black": it is simply the red warning).
 * So from the third game day the warnings are a mix of mild and extreme.
 */
export function streamWarningLevel(stream: WindStream): WarningLevel {
  return stream.black ? "red" : "yellow";
}

/** Where `stream` is in its life, or null once it is over. */
export function windPhase(stream: WindStream): WindPhase | null {
  if (stream.age < 0) return "forecast";
  if (stream.age < WIND_FORM_SECONDS) return "forming";
  if (stream.age < WIND_FORM_SECONDS + WIND_ACTIVE_SECONDS) return "active";
  if (stream.age < WIND_LIFETIME) return "fading";
  return null;
}

/** How hard the stream blows: 0 before it is active, 1 active, easing to 0 as it fades. */
export function windStrength(stream: WindStream): number {
  switch (windPhase(stream)) {
    case "active":
      return 1;
    case "fading": {
      const t = (stream.age - WIND_FORM_SECONDS - WIND_ACTIVE_SECONDS) / WIND_FADE_SECONDS;
      return 1 - t * t * (3 - 2 * t);
    }
    default:
      return 0;
  }
}

/** Stream age (seconds) at which a black stream's lethal peak opens. */
const PEAK_OPENS = WIND_FORM_SECONDS + BLACK_PEAK_DELAY;
/** Stream age at which the peak closes again. */
const PEAK_CLOSES = PEAK_OPENS + BLACK_PEAK_SECONDS;
/** Stream age at which the build-up to the peak starts. */
const PEAK_BUILDS = PEAK_OPENS - BLACK_PEAK_WARN;

/** Is `stream` a black one inside its lethal peak window? Flying planes in it die. */
export function isLethal(stream: WindStream): boolean {
  return stream.black && stream.age >= PEAK_OPENS && stream.age < PEAK_CLOSES;
}

/** Is `stream` a black one in the build-up just before its peak? Never lethal. */
export function isPeakWarning(stream: WindStream): boolean {
  return stream.black && stream.age >= PEAK_BUILDS && stream.age < PEAK_OPENS;
}

/**
 * Is `stream` a black one whose peak has not finished yet (forecast,
 * forming, active or in its peak)? The HUD keeps the black warning up for it.
 */
export function peakPending(stream: WindStream): boolean {
  return stream.black && stream.age < PEAK_CLOSES;
}

/**
 * Is a black `stream` a danger `ahead` seconds from now: active (it erases
 * paths and pushes planes about) and not yet past its lethal peak? The demo
 * autopilot (core/autopilot) keeps planned tracks out of the band for that
 * whole window, not just during the peak: a plane that meant to slip
 * through before the peak can be stuck inside when it comes. The forecast
 * and forming phases are harmless, so planes may cross then.
 */
export function peakAhead(stream: WindStream, ahead: number): boolean {
  const age = stream.age + ahead;
  return stream.black && age >= WIND_FORM_SECONDS && age < PEAK_CLOSES;
}

/**
 * Put a new stream somewhere over the airspace, blowing in a random
 * direction, starting in its forecast. From the third game day it may be a
 * black one. Runways are not avoided: the warnings are what keep it fair.
 */
function spawnStream(state: GameState, rng: Rng): WindStream {
  const b = airspaceBounds(state.world);
  const center = { x: lerp(b.minX, b.maxX, rng()), y: lerp(b.minY, b.maxY, rng()) };
  const heading = rng() * Math.PI * 2;
  // Rolled only once black is allowed, so the first days keep their random sequence.
  const mayBeBlack = Math.floor(state.elapsed / DAY_SECONDS) >= BLACK_WIND_FROM_DAY;
  return {
    id: state.nextStreamId++,
    rect: { center, heading, length: WIND_LENGTH, width: WIND_WIDTH },
    age: -WIND_FORECAST_SECONDS,
    black: mayBeBlack && rng() < BLACK_WIND_SHARE,
  };
}

/**
 * Advance the streams by `dt` seconds (age them, start new ones, drop dead
 * ones) and apply them to the planes. Does nothing on the first game day.
 *
 * @returns the flying planes caught inside a black stream's lethal peak.
 *          The caller ends the game (core/simulation.ts); nothing here does.
 */
export function updateWind(state: GameState, dt: number, rng: Rng, events: SimEvent[]): Plane[] {
  const cap = windLevel(state.elapsed);

  // Age the streams and report the ones that just changed phase.
  for (const stream of state.streams) {
    const before = windPhase(stream);
    stream.age += dt;
    const after = windPhase(stream);
    if (before === "forecast" && after !== "forecast") {
      events.push({ type: "windForming", streamId: stream.id });
    }
    if (before !== "active" && after === "active") {
      events.push({ type: "windActive", streamId: stream.id });
    }
    // The build-up to a black stream's peak: once, as its age crosses the start.
    if (stream.black && stream.age - dt < PEAK_BUILDS && stream.age >= PEAK_BUILDS) {
      events.push({ type: "blackWindPeak", streamId: stream.id });
    }
  }
  state.streams = state.streams.filter((s) => windPhase(s) !== null);

  // A new one, once there is room and the gap since the last has passed. At
  // the cap the timer just waits at zero, so a freed slot fills at once.
  if (cap > 0) {
    state.windTimer = Math.max(0, state.windTimer - dt);
    if (state.windTimer === 0 && state.streams.length < cap) {
      const stream = spawnStream(state, rng);
      state.streams.push(stream);
      events.push({
        type: "windForecast",
        streamId: stream.id,
        level: streamWarningLevel(stream),
      });
      state.windTimer = lerp(WIND_GAP_MIN, WIND_GAP_MAX, rng());
    }
  }

  // The lethal check is its own scan: a plane in a normal stream that
  // overlaps a lethal one is still caught (`applyWind` finds only one).
  const caught: Plane[] = [];
  for (const plane of state.planes) {
    applyWind(plane, state, events);
    if (
      plane.phase === "flying" &&
      state.streams.some((s) => isLethal(s) && pointInRect(plane.pos, s.rect))
    ) {
      caught.push(plane);
    }
  }
  return caught;
}

/** Push `plane` by the stream it is in, or clear the effect if it is in none. */
function applyWind(plane: Plane, state: GameState, events: SimEvent[]): void {
  plane.wind.x = 0;
  plane.wind.y = 0;
  plane.windTurn = 0;
  const stream =
    plane.phase === "flying"
      ? state.streams.find((s) => windStrength(s) > 0 && pointInRect(plane.pos, s.rect))
      : undefined;
  if (!stream) {
    plane.windStreamId = null;
    return;
  }

  // Newly in an active stream (flew in, or it turned active round the
  // plane): the path is lost. A plane already inside keeps what it is
  // drawn, so redrawing in the wind is possible (the push still applies).
  // The final approach of a locked-on plane goes too.
  if (plane.windStreamId !== stream.id && windPhase(stream) === "active") {
    if (plane.path.length > 0 || plane.pathAnchored) {
      plane.path = [];
      plane.pathAnchored = false;
      plane.pathVersion++;
      events.push({ type: "pathLost", planeId: plane.id });
    }
  }
  plane.windStreamId = stream.id;

  const strength = windStrength(stream);
  const dir = headingVector(stream.rect.heading);
  plane.wind.x = dir.x * WIND_DRIFT * strength;
  plane.wind.y = dir.y * WIND_DRIFT * strength;
  plane.windTurn = WIND_TURN * strength * Math.sin(state.elapsed * WIND_TURN_RATE + plane.id * 1.3);
}
