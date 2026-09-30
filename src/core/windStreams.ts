/**
 * Wind streams: the difficulty layer that arrives with the second game day.
 *
 * A stream is a band of strong wind across the map. It lives in three
 * phases (see `windPhase`): `forming` (a warning the player can see and
 * route around; harmless), `active` (pushes planes and erases their paths)
 * and `fading` (the push dies down). A flying plane that flies into an
 * active stream loses the path it was given, so the player has to draw it
 * again; while inside, it is pushed sideways along the wind (`Plane.wind`,
 * applied in core/plane.ts) and shaken by small heading shoves
 * (`Plane.windTurn`).
 *
 * Streams only start once a whole game day has passed
 * (`DAY_SECONDS` of `state.elapsed`), and more of them can be up at once
 * each further day (`windLevel`). Departures, which the game flies, and
 * planes on the ground are not affected. Like all of `core`, nothing in
 * here knows about drawing; render/windStreams.ts shows the bands.
 */
import {
  WIND_ACTIVE_SECONDS,
  WIND_DRIFT,
  WIND_FADE_SECONDS,
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
import type { GameState, Plane, Rng, SimEvent, WindPhase, WindStream } from "./types";

/** Seconds a stream lives from first showing to gone. */
export const WIND_LIFETIME = WIND_FORM_SECONDS + WIND_ACTIVE_SECONDS + WIND_FADE_SECONDS;

/**
 * How many streams may be up at once after `elapsed` seconds: none on the
 * first game day, one on the second, one more each day after, up to
 * `WIND_MAX_STREAMS`.
 */
export function windLevel(elapsed: number): number {
  return Math.min(WIND_MAX_STREAMS, Math.max(0, Math.floor(elapsed / DAY_SECONDS)));
}

/** Where `stream` is in its life, or null once it is over. */
export function windPhase(stream: WindStream): WindPhase | null {
  if (stream.age < WIND_FORM_SECONDS) return "forming";
  if (stream.age < WIND_FORM_SECONDS + WIND_ACTIVE_SECONDS) return "active";
  if (stream.age < WIND_LIFETIME) return "fading";
  return null;
}

/** How hard the stream blows: 0 forming, 1 active, easing to 0 as it fades. */
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

/**
 * Put a new stream somewhere over the airspace, blowing in a random
 * direction. Runways are not avoided: the warning phase is what keeps it
 * fair.
 */
function spawnStream(state: GameState, rng: Rng): WindStream {
  const b = airspaceBounds(state.world);
  return {
    id: state.nextStreamId++,
    rect: {
      center: { x: lerp(b.minX, b.maxX, rng()), y: lerp(b.minY, b.maxY, rng()) },
      heading: rng() * Math.PI * 2,
      length: WIND_LENGTH,
      width: WIND_WIDTH,
    },
    age: 0,
  };
}

/**
 * Advance the streams by `dt` seconds (age them, start new ones, drop dead
 * ones) and apply them to the planes. Does nothing on the first game day.
 */
export function updateWind(state: GameState, dt: number, rng: Rng, events: SimEvent[]): void {
  const cap = windLevel(state.elapsed);

  // Age the streams and report the ones that just turned active.
  for (const stream of state.streams) {
    const before = windPhase(stream);
    stream.age += dt;
    if (before === "forming" && windPhase(stream) === "active") {
      events.push({ type: "windActive", streamId: stream.id });
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
      events.push({ type: "windForming", streamId: stream.id });
      state.windTimer = lerp(WIND_GAP_MIN, WIND_GAP_MAX, rng());
    }
  }

  for (const plane of state.planes) applyWind(plane, state, events);
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
