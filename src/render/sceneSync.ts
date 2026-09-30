/**
 * Keeps Babylon meshes in step with the (read-only) game state.
 *
 * Meshes are matched to planes by id: new ids get meshes, missing ids have
 * theirs disposed. The simulation never touches Babylon objects.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Material } from "@babylonjs/core/Materials/material";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AudioCue } from "../audio/cues";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import {
  ALTITUDE_SCALE_PER_UNIT,
  APPROACH_DISTANCE,
  CLIMB_DISTANCE,
  COLOR_HEX,
  DEBUG_SHOW_AIRSPACE,
  DEPARTURE_ROUTE_SPACING,
  FLARE_DISTANCE,
  FLIGHT_ALTITUDE,
  LANDING_SPEED_START,
  MAX_TURN_RATE,
  PLANE_SPEED,
  ROTATE_SPEED,
  THRESHOLD_ALTITUDE,
} from "../config";
import { allStands } from "../core/airfield";
import { isInHangar } from "../core/ground";
import { cruiseAltitude } from "../core/layout";
import { openRunways } from "../core/progression";
import { angleDelta, distance, lerp, normalizeAngle } from "../core/math";
import type {
  GameState,
  Plane,
  PlaneColor,
  PlanePhase,
  Runway,
  RunwayColor,
  Vec2,
  WorldSize,
} from "../core/types";
import {
  aircraftKindFor,
  animateAircraft,
  setHeadlights,
  wheelDepth,
  type AircraftKind,
  type AircraftRig,
} from "./aircraft";
import { AirfieldFactory, type AirfieldView } from "./airfield";
import { AirspaceBoundary } from "./boundary";
import { CrashEffect, type WreckSource } from "./crash";
import { flightTuning } from "./flightTuning";
import { headingToRotationY, toScene } from "./coords";
import { Landscape } from "./landscape";
import type { MeshFactory } from "./meshes";
import { smoothTrack } from "./pathLine";
import { RejectMarks } from "./rejectMarks";
import { CloudsView } from "./clouds";
import { WindStreamsView } from "./windStreams";
import { RunwayFactory, type RunwayView } from "./runway";
import { fitShadowsToWorld, OVERLAY_GROUP } from "./scene";
import { createPoolMesh, poolMaterial, setNightLevel } from "./nightLights";
import { windEffect } from "./wind";

/**
 * Height of drawn path lines: just above the ground, where the pointer
 * projects to and the runways are. Planes are drawn over their ground track
 * (see `placeOverTrack`), so the line still runs right under each plane.
 */
const PATH_ALTITUDE = 0.15;
/**
 * Path line width in world units (not pixels: the line scales with zoom).
 * ~6 px at the default 720p view; thinner lines vanish against the grass.
 */
const PATH_WIDTH = 0.5;
/**
 * Path line opacity: a light wash of the plane's colour, enough to follow
 * the route without hiding the runways, traffic and scenery under it.
 */
const PATH_ALPHA = 0.45;
/** Departure routes (dotted) are the game's, not the player's: fainter still. */
const DEPARTURE_PATH_ALPHA = 0.35;
/**
 * Departures (core/departures.ts) draw their planned route as a dotted
 * line: one dot every `DEPARTURE_DOT_SPACING` world units, each dot
 * `DEPARTURE_DOT_RATIO` of that long, on a slightly thinner line. Dotted
 * reads as "the game is flying this one": the player's own paths are solid.
 * The spacing divides the route's point spacing (`DEPARTURE_ROUTE_SPACING`)
 * and the line starts at a route point, so the dots stay put on the ground
 * as the plane eats its way along the line.
 */
export const DEPARTURE_DOT_SPACING = DEPARTURE_ROUTE_SPACING / 2;
export const DEPARTURE_DOT_RATIO = 0.45;
const DEPARTURE_PATH_WIDTH = 0.45;
/**
 * Take-off attitude. The nose comes up by `ROTATION_PITCH` (radians) over
 * the last stretch of the take-off roll, from `ROTATION_START` × the
 * lift-off speed. Once airborne the nose holds that rotation attitude,
 * fading out over the climb, while the climb attitude rises to
 * `CLIMB_PITCH` (radians) midway, where the climb is steepest, and eases
 * level again as it flattens out (the shape of the climb profile's slope,
 * see `departureAltitude`, but a fixed angle whatever the cruise height:
 * the real slope would tip a high climb-out nearly vertical). The larger
 * of the two wins, so the nose never dips at lift-off. `PITCH_EASE`
 * (seconds) smooths every change.
 */
export const ROTATION_PITCH = 0.16;
export const ROTATION_START = 0.8;
export const CLIMB_PITCH = 0.22;
const PITCH_EASE = 0.25;
/**
 * A climbing departure moves back to the overlay rendering group (drawn
 * over trees, like every airborne plane) once this high: clear of the
 * hangar roofs it's hidden behind on the ground.
 */
const OVERLAY_ALTITUDE = 3;
/** Height of the green anchor ring: on the ground, just over the runway paint. */
const ANCHOR_RING_ALTITUDE = 0.2;
/**
 * The anchor ring confirms a locked path, then gets out of the way: fully
 * visible for `ANCHOR_RING_HOLD` seconds, then fading out over
 * `ANCHOR_RING_FADE` seconds. Redrawing and re-anchoring shows it again.
 */
export const ANCHOR_RING_HOLD = 2;
export const ANCHOR_RING_FADE = 0.8;
/**
 * A runway colour opening mid-shift (see `setRunwayProgression`) is laid
 * down over `RUNWAY_REVEAL_SECONDS`: the strip unrolls from its approach
 * end, eased out, while its taxiways and hangars fade in over the second
 * half. An airport's control tower and windsock grow up with its first
 * runway. A new shift (or a resize) just shows what's open, no animation.
 */
export const RUNWAY_REVEAL_SECONDS = 1.6;
/**
 * A runway that opens a new airport (the first of its colours to open
 * there) waits `AIRPORT_REVEAL_DELAY` seconds before it starts building:
 * until then the airport isn't there at all, neither grounds nor fence
 * (see render/airportGrounds.ts `AirportView.reveal`). The camera uses the
 * pause to pull back and frame it (core/airports.ts `openAirportsView`), so the
 * player sees it go up rather than finding it built.
 */
export const AIRPORT_REVEAL_DELAY = 0.9;
/**
 * Hover highlight (a plane under the mouse, or held by a pointer; see
 * input/pointer.ts `refreshHover`). It eases in and out over roughly
 * `HOVER_EASE` seconds: a white ring that grows into place under the plane
 * while the plane itself swells by up to `HOVER_SCALE` (0.1 = 10 %), as if
 * lifted towards the player's finger.
 */
export const HOVER_EASE = 0.08;
export const HOVER_SCALE = 0.1;
/** Hover ring opacity at full highlight, and how deep its slow pulse dips. */
const HOVER_RING_ALPHA = 0.85;
const HOVER_RING_PULSE = 0.2;
/**
 * Height of a plane of `kind` on the ground: its root sits its wheels'
 * depth (`wheelDepth`) up, scaled like the model is at that height (the
 * fake perspective below, which itself depends on the height: solved for
 * the fixed point h = d · (1 + (h − FLIGHT_ALTITUDE) · k)).
 */
function groundAltitude(kind: AircraftKind): number {
  const d = wheelDepth(kind);
  const k = ALTITUDE_SCALE_PER_UNIT;
  return (d * (1 - FLIGHT_ALTITUDE * k)) / (1 - d * k);
}
/**
 * Landing gear (see `AircraftMotion.gear`): it goes down once a plane on
 * an anchored approach is `GEAR_DOWN_DISTANCE` (path length) from the
 * threshold, stays down on the ground, and a departure raises it once
 * `GEAR_UP_CLIMB` past lift-off. The legs take `GEAR_TRAVEL` seconds to
 * swing, eased at both ends like a hydraulic ram.
 */
export const GEAR_DOWN_DISTANCE = APPROACH_DISTANCE;
export const GEAR_UP_CLIMB = 5;
export const GEAR_TRAVEL = 1.8;
/**
 * A plane rolling past this share of the maximum bank raises a
 * `bankWhoosh` cue, at most once every `WHOOSH_GAP` seconds.
 */
const WHOOSH_BANK = 0.7;
const WHOOSH_GAP = 2.5;
/**
 * Fastest a plane climbs or descends (scene units / second). Faster than the
 * glide slope and the climb out of the airspace, so those are followed
 * exactly; it only smooths sudden changes of target, e.g. a go-around when
 * an anchored path is redrawn low over the field.
 */
const MAX_VERTICAL_SPEED = 4;

/**
 * Landing lights at night: a pool of light on the ground ahead of each
 * plane below `BEAM_ALTITUDE` (on approach, on the ground, taking off).
 * It shrinks and fades as the plane climbs out of range.
 */
const BEAM_ALTITUDE = 6;
/** Pool height: over the runway paint (0.09), under a rolling plane (0.35). */
const BEAM_Y = 0.1;
const BEAM_LENGTH = 2.6;
const BEAM_WIDTH = 1.2;
const BEAM_STRENGTH = 0.6;
/**
 * Phases whose landing lights are on (not parked in a hangar or gone):
 * the pools on the ground and the lamps and beam on the plane itself.
 */
const BEAM_PHASES = new Set<PlanePhase>([
  "flying",
  "landing",
  "taxiing",
  "departing",
  "outbound",
  "takeoff",
  "climbout",
]);

/** Landing lights on: a lit phase, and not still inside the hangar. */
function landingLightsOn(view: PlaneView, plane: Plane): boolean {
  return BEAM_PHASES.has(plane.phase) && !view.inHangar;
}

/**
 * Height `plane` should be flying at now: its cruise altitude over the
 * current position (see `cruiseAltitude`), or, on an anchored path within
 * `APPROACH_DISTANCE` of the threshold, a straight glide slope from there
 * down to `THRESHOLD_ALTITUDE` on the threshold (the path's last point).
 */
function airborneAltitude(plane: Plane, world: WorldSize): number {
  const cruise = cruiseAltitude(plane.pos, world);
  const left = approachLeft(plane, APPROACH_DISTANCE);
  if (left === null) return cruise;
  return lerp(THRESHOLD_ALTITUDE, cruise, Math.min(1, left / APPROACH_DISTANCE));
}

/**
 * Path length `plane` has left to fly to its threshold, on an anchored
 * path; null otherwise. Summed back from the threshold and stopped once
 * past `limit` (only the last stretch ever matters), so long paths stay
 * cheap.
 */
function approachLeft(plane: Plane, limit: number): number | null {
  const path = plane.path;
  if (!plane.pathAnchored || path.length === 0) return null;
  let left = 0;
  for (let i = path.length - 1; i >= 0 && left < limit; i--) {
    left += distance(path[i]!, i > 0 ? path[i - 1]! : plane.pos);
  }
  return left;
}

/** Should `plane`'s landing gear be down now? (See `GEAR_DOWN_DISTANCE`.) */
function wantsGearDown(plane: Plane): boolean {
  if (plane.ground) return true;
  if (plane.phase === "climbout") return (plane.departure?.climbed ?? Infinity) < GEAR_UP_CLIMB;
  if (plane.phase !== "flying") return false;
  const left = approachLeft(plane, GEAR_DOWN_DISTANCE);
  return left !== null && left < GEAR_DOWN_DISTANCE;
}

/**
 * Climb profile of a departure after lift-off (see core/departures.ts):
 * from the runway up to the cruise altitude over its position, along a
 * smoothstep of the distance flown (`CLIMB_DISTANCE` to the top). The
 * smoothstep starts and ends flat, so the plane rotates gently off the
 * runway, climbs steepest midway, then levels off smoothly.
 *
 * @param runway  the plane's height on the ground (see `groundAltitude`)
 * @returns the height.
 */
export function departureAltitude(plane: Plane, world: WorldSize, runway: number): number {
  const climbed = plane.departure?.climbed ?? CLIMB_DISTANCE;
  const t = Math.min(1, climbed / CLIMB_DISTANCE);
  const rise = cruiseAltitude(plane.pos, world) - runway;
  return runway + rise * t * t * (3 - 2 * t);
}

/**
 * Planes whose path is drawn: flying ones (the player's path) and
 * departures until they leave (their planned route).
 */
function hasPathLine(plane: Plane): boolean {
  switch (plane.phase) {
    case "flying":
    case "outbound":
    case "takeoff":
    case "climbout":
      return true;
    default:
      return false;
  }
}

/**
 * Rendering group for a plane's path line: the plane's own. Airborne, both
 * sit in the overlay group, visible over trees, and the plane (above the
 * line) still hides the bit under it. A departure on the ground or just
 * off it is in the scenery group, and the overlay group clears depth, so a
 * line left there would draw its dots straight over the plane.
 */
function pathGroup(view: PlaneView): number {
  return view.grounded ? 0 : OVERLAY_GROUP;
}

/** Fraction of the way to a target that exponential easing covers in `dt`. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

interface PlaneView {
  /** The plane's model: root mesh plus its animated parts. */
  aircraft: AircraftRig;
  color: PlaneColor;
  ring: Mesh;
  /** White ring around the plane while it's hovered or held. */
  hoverRing: Mesh;
  /** Eased hover highlight, 0 (none) to 1 (full). */
  hover: number;
  /** Green ring on the threshold, briefly, once this plane's path anchors. */
  anchorRing: Mesh;
  /** Seconds since the path anchored (ring's age), or null while unanchored. */
  anchorAge: number | null;
  path: Mesh | null;
  /** `plane.pathVersion` the current path line was built from. */
  pathVersion: number;
  /** Displayed yaw, eased towards heading + wind crab (null until first sync). */
  yaw: number | null;
  /** Displayed bank angle (radians, positive = right wing down). */
  bank: number;
  /** Displayed nose-up pitch (radians), for the take-off and climb. */
  pitch: number;
  /** Its model, and the height it sits at on the ground (see `groundAltitude`). */
  kind: AircraftKind;
  groundAltitude: number;
  /** Landing gear travel, 0 = up to 1 = down (linear; eased when drawn). */
  gear: number;
  /** Where the gear is heading (null until the first sync sets it). */
  gearDown: boolean | null;
  /** True once the wheels have touched the runway (the `touchdown` cue). */
  touchedDown: boolean;
  /** Seconds since the last `bankWhoosh` cue. */
  sinceWhoosh: number;
  /** Warning ring shown last frame (the `warning` cue fires as it comes on). */
  warned: boolean;
  /** Stereo position on screen, -1 to 1 (see `panFor`). */
  pan: number;
  /** True once moved to the default rendering group on touchdown. */
  grounded: boolean;
  /** Displayed height while airborne (null until first sync). */
  altitude: number | null;
  /** Height at touchdown, where the flare starts (null while airborne). */
  touchdownAltitude: number | null;
  /**
   * Inside its hangar (core/ground.ts `isInHangar`): every light off, the
   * landing-light pool included, as the glow would show through the roof.
   */
  inHangar: boolean;
  /** Eased 0 (clear air) to 1 (in a wind stream): how much extra it is shaken. */
  streamShake: number;
}

/** Extra turbulence (× the usual) a plane in a wind stream gets, and how fast it eases. */
export const STREAM_SHAKE = 2;
export const STREAM_SHAKE_EASE = 4;

export class SceneSync {
  private readonly views = new Map<number, PlaneView>();
  private runwayViews: RunwayView[] = [];
  private airfieldViews: AirfieldView[] = [];
  /**
   * Hide runways whose colour isn't open yet (see `setRunwayProgression`).
   * Off by default, so stories show the whole field.
   */
  private runwayProgression = false;
  /** Colours drawn right now, in `state.runways` order (e.g. "red,blue"). */
  private shownKey = "";
  /** Runway colours still being revealed, and the sync `time` each began. */
  private readonly reveals = new Map<RunwayColor, number>();
  private readonly landscape: Landscape;
  private readonly runwayFactory: RunwayFactory;
  private readonly airfieldFactory: AirfieldFactory;
  private readonly boundary: AirspaceBoundary;
  /** Which airspace the outline shows (`WorldSize.compactAirspace`); redrawn when it changes. */
  private boundaryCompact = false;
  /** Camera view direction, refreshed every sync (see `placeOverTrack`). */
  private readonly viewDir = new Vector3(0, -1, 0);
  /** `time` of the previous sync, for frame-to-frame easing. */
  private lastTime: number | null = null;
  /**
   * The crash in progress, and the ids of the planes it owns. Their meshes
   * are moved by the effect, not by `updateView`, until they leave state.
   */
  private crashEffect: CrashEffect | null = null;
  private readonly wreckIds = new Set<number>();
  /** Ids of planes to highlight as interactive (see `setHighlighted`). */
  private highlighted: ReadonlySet<number> = new Set();
  /** Sound cues raised since the last `takeAudioCues` (see audio/cues.ts). */
  private cues: AudioCue[] = [];
  /** Red "no landing" X marks (see `showRejectMark`). */
  private readonly rejectMarks: RejectMarks;
  private readonly windStreams: WindStreamsView;
  private readonly clouds: CloudsView;
  private readonly scratch = new Vector3();
  /** 0 day … 1 night (see `setNight`). */
  private night = 0;
  /** Landing-light pools, one thin instance per plane in range (night only). */
  private readonly beams: Mesh;
  private readonly beamMat: StandardMaterial;
  private beamMatrices = new Float32Array(16 * 8);
  private readonly beamM = new Matrix();
  private readonly beamRot = new Quaternion();
  private readonly beamScale = new Vector3();
  private readonly beamPos = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly factory: MeshFactory,
    private readonly shadows: ShadowGenerator,
  ) {
    this.landscape = new Landscape(scene, shadows);
    this.runwayFactory = new RunwayFactory(scene, (color) => factory.material(color));
    this.airfieldFactory = new AirfieldFactory(scene, (color) => factory.material(color), shadows);
    // Players never see the airspace edge; it's drawn for tuning only.
    this.boundary = new AirspaceBoundary(scene);
    this.boundary.setVisible(DEBUG_SHOW_AIRSPACE);
    this.rejectMarks = new RejectMarks(factory);
    this.windStreams = new WindStreamsView(scene);
    this.clouds = new CloudsView(scene);
    this.beamMat = poolMaterial("landingLights", "#fff6e0", scene);
    this.beams = createPoolMesh("landingLights", scene);
    this.beams.material = this.beamMat;
    this.beams.alwaysSelectAsActiveMesh = true;
    this.beams.isVisible = false;
    this.beams.thinInstanceSetBuffer("matrix", this.beamMatrices, 16, false);
    this.beams.thinInstanceCount = 0;
    // Disabled while there are no instances: see `syncBeams`.
    this.beams.setEnabled(false);
  }

  /**
   * Flash the red "no landing" X at `at` (sim coordinates): where a path
   * ends on a runway without locking on, or a threshold where a plane had
   * to go around (see render/rejectMarks.ts). Animated by `syncPlanes`.
   */
  showRejectMark(at: Vec2, world: WorldSize): void {
    this.rejectMarks.show(at, world);
  }

  /**
   * Show or hide the airspace edge (a development aid; see
   * `DEBUG_SHOW_AIRSPACE`, which sets the starting state).
   */
  setAirspaceVisible(visible: boolean): void {
    this.boundary.setVisible(visible);
  }

  /**
   * Planes to highlight as interactive: hovered or held by a pointer (see
   * input/pointer.ts `refreshHover`). Applied on the next `syncPlanes`.
   */
  setHighlighted(ids: ReadonlySet<number>): void {
    this.highlighted = ids;
  }

  /**
   * How dark it is, 0 day … 1 night (render/dayCycle.ts): passed on to
   * everything with night lights. Cheap to call every frame: nothing
   * happens unless it changed.
   */
  setNight(n: number): void {
    if (n === this.night) return;
    this.night = n;
    this.factory.setNight(n);
    this.landscape.setNight(n);
    this.airfieldFactory.setNight(n);
    this.clouds.setNight(n);
    setNightLevel(this.beamMat, n * BEAM_STRENGTH);
  }

  /**
   * Night only: a landing-light pool on the ground ahead of every plane
   * low enough to light it. New planes need nothing special: each frame
   * rewrites the whole set.
   */
  private syncBeams(state: GameState): void {
    if (this.night <= 0) return;
    if (this.beamMatrices.length < state.planes.length * 16) {
      this.beamMatrices = new Float32Array(state.planes.length * 32);
      this.beams.thinInstanceSetBuffer("matrix", this.beamMatrices, 16, false);
    }
    let count = 0;
    for (const plane of state.planes) {
      const view = this.views.get(plane.id);
      if (!view || this.wreckIds.has(plane.id) || !landingLightsOn(view, plane)) continue;
      const height = view.aircraft.root.position.y;
      if (height >= BEAM_ALTITUDE) continue;
      const fade = 1 - height / BEAM_ALTITUDE;
      const ahead = 1.6 + height * 0.6;
      toScene(
        {
          x: plane.pos.x + Math.cos(plane.heading) * ahead,
          y: plane.pos.y + Math.sin(plane.heading) * ahead,
        },
        state.world,
        BEAM_Y,
        this.beamPos,
      );
      Quaternion.RotationYawPitchRollToRef(headingToRotationY(plane.heading), 0, 0, this.beamRot);
      this.beamScale.set(BEAM_LENGTH * fade, 1, BEAM_WIDTH * fade);
      Matrix.ComposeToRef(this.beamScale, this.beamRot, this.beamPos, this.beamM);
      this.beamM.copyToArray(this.beamMatrices, count * 16);
      count++;
    }
    this.beams.thinInstanceCount = count;
    this.beams.thinInstanceBufferUpdated("matrix");
    // With no instances Babylon draws the mesh itself, once, at its own
    // transform: a stray pool of light on the grass at the map's centre.
    this.beams.setEnabled(count > 0);
  }

  /**
   * Sound cues raised by the last `syncPlanes` (gear, touchdown, bank
   * whoosh, warning), in the order they happened; the queue is emptied.
   * main.ts hands them to the audio mixer every frame, right after the
   * sync. Each sync starts a fresh queue, so a caller without sound (most
   * stories) never has to drain it.
   */
  takeAudioCues(): AudioCue[] {
    const cues = this.cues;
    this.cues = [];
    return cues;
  }

  /**
   * Where plane `planeId` is across the screen, -1 (left edge) to 1 (right
   * edge), as drawn last frame; 0 if it has no mesh. For stereo panning.
   */
  panFor(planeId: number): number {
    return this.views.get(planeId)?.pan ?? 0;
  }

  /**
   * Incremental progression: draw only the runways whose colour is open at
   * the current landing count (core/progression.ts `unlockedColors`). A shift
   * starts with red alone; each colour that opens is laid down in front of
   * the player (see `RUNWAY_REVEAL_SECONDS`), and a new shift closes them
   * again. Off, every runway is drawn (stories). Applied on the next
   * `rebuildWorld` or `syncPlanes`.
   */
  setRunwayProgression(on: boolean): void {
    this.runwayProgression = on;
  }

  /** Build static geometry (landscape, runways, taxiways, hangars) for the world. */
  rebuildWorld(state: GameState): void {
    fitShadowsToWorld(this.shadows, state.world);
    // Airport grounds are built for every runway, open or not; an airport
    // with no runway open is kept hidden until its first one is built (see
    // `syncRunways`). Its terminal and car park stay: the roads lead there.
    this.landscape.setWorld(state.world, state.runways);
    this.reveals.clear();
    this.buildRunways(this.shownRunways(state), state);
    this.boundary.setWorld(state.world);
    this.boundaryCompact = state.world.compactAirspace === true;
    // Path lines were built with the old world→scene mapping; force a rebuild.
    for (const view of this.views.values()) view.pathVersion = -1;
  }

  /** The runways to draw now: every one, or only the open colours. */
  private shownRunways(state: GameState): Runway[] {
    if (!this.runwayProgression) return [...state.runways];
    return openRunways(state.landed, state.runways);
  }

  /**
   * (Re)build the runway and airfield meshes for `shown`. Crossing runways
   * cut their markings round each other, so the whole set is rebuilt: blue
   * alone is a plain strip, and gets its X only once yellow opens.
   */
  private buildRunways(shown: readonly Runway[], state: GameState): void {
    for (const view of this.runwayViews) view.dispose();
    for (const view of this.airfieldViews) view.dispose();
    this.runwayViews = shown.map((r) => this.runwayFactory.create(r, state.world, shown));
    this.airfieldViews = shown.map((r) => this.airfieldFactory.create(r, state.world));
    this.shownKey = shown.map((r) => r.color).join();
  }

  /**
   * Follow the runway progression: rebuild when the open colours change
   * (a colour opened, or a new shift closed them), start the reveal of any
   * colour that just opened, and advance the reveals under way.
   */
  private syncRunways(state: GameState, time: number): void {
    const shown = this.shownRunways(state);
    const key = shown.map((r) => r.color).join();
    if (key !== this.shownKey) {
      const before = new Set(this.shownKey.split(","));
      this.buildRunways(shown, state);
      for (const color of this.reveals.keys()) {
        if (!shown.some((r) => r.color === color)) this.reveals.delete(color);
      }
      for (const r of shown) {
        if (before.has(r.color)) continue;
        // First runway open at its airport: wait for the camera to get there.
        const opensAirport = !this.landscape.airportColors(r.color).some((c) => before.has(c));
        this.reveals.set(r.color, time + (opensAirport ? AIRPORT_REVEAL_DELAY : 0));
      }
    }
    // How far each colour's runway is built: 0 closed, 1 open.
    const built = new Map<RunwayColor, number>();
    shown.forEach((r, i) => {
      const start = this.reveals.get(r.color);
      if (start === undefined) {
        built.set(r.color, 1);
        return;
      }
      const t = Math.min(1, Math.max(0, (time - start) / RUNWAY_REVEAL_SECONDS));
      // Strip: ease-out cubic over the whole reveal. Airfield: second half.
      const strip = 1 - (1 - t) ** 3;
      built.set(r.color, strip);
      this.runwayViews[i]?.reveal(strip);
      this.airfieldViews[i]?.reveal(Math.max(0, t * 2 - 1));
      if (t >= 1) this.reveals.delete(r.color);
    });
    // An airport with no runway open yet isn't there either (no grounds,
    // fence, tower or windsock): it goes up with its first runway.
    this.landscape.revealAirports((color) => built.get(color) ?? 0);
  }

  /** Create/update/dispose plane meshes to match `state.planes`. */
  syncPlanes(state: GameState, time: number): void {
    this.cues = [];
    // The airspace grows when the second runway opens (and shrinks on a new shift).
    if (this.boundaryCompact !== (state.world.compactAirspace === true)) {
      this.boundary.setWorld(state.world);
      this.boundaryCompact = state.world.compactAirspace === true;
    }
    this.landscape.update(time);
    this.windStreams.sync(state.streams, state.world, time);
    this.clouds.sync(state.elapsed, state.world);
    this.syncRunways(state, time);
    for (const runway of this.runwayViews) runway.update(time);
    this.scene.activeCamera?.getDirectionToRef(Axis.Z, this.viewDir);
    // `time` stands still while paused, so the easing freezes along with it.
    const dt = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    const alive = new Set<number>();
    const stands = allStands(state.runways);
    for (const plane of state.planes) {
      alive.add(plane.id);
      // Wreckage is animated by the crash effect instead (see `crash`).
      if (this.wreckIds.has(plane.id)) continue;
      let view = this.views.get(plane.id);
      if (!view) {
        const kind = aircraftKindFor(plane.id);
        const aircraft = this.factory.createAircraft(
          kind,
          plane.color,
          plane.id,
          `plane-${plane.id}`,
        );
        view = {
          aircraft,
          color: plane.color,
          ring: this.factory.createWarningRing(`ring-${plane.id}`),
          hoverRing: this.factory.createHoverRing(`hover-${plane.id}`),
          hover: 0,
          anchorRing: this.factory.createAnchorRing(`anchor-${plane.id}`),
          anchorAge: null,
          path: null,
          pathVersion: -1,
          yaw: null,
          bank: 0,
          pitch: 0,
          kind,
          groundAltitude: groundAltitude(kind),
          gear: 0,
          gearDown: null,
          // Already down (a departure starts on its wheels): no touchdown.
          touchedDown: plane.ground !== null,
          sinceWhoosh: Infinity,
          warned: false,
          pan: 0,
          grounded: false,
          altitude: null,
          touchdownAltitude: null,
          inHangar: false,
          streamShake: 0,
        };
        this.views.set(plane.id, view);
        // Solid parts only: prop blur discs and lights cast no shadow.
        for (const mesh of aircraft.shadowCasters) this.shadows.addShadowCaster(mesh, false);
      }
      view.inHangar = isInHangar(plane, stands);
      this.updateView(view, plane, state.world, time, dt);
    }

    this.syncBeams(state);
    this.crashEffect?.update(dt);
    this.rejectMarks.update(dt);

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.wreckIds.delete(id);
      for (const mesh of view.aircraft.shadowCasters) this.shadows.removeShadowCaster(mesh, false);
      this.factory.disposeAircraft(view.aircraft);
      view.ring.dispose();
      view.hoverRing.dispose();
      view.anchorRing.dispose();
      view.path?.dispose(false, true);
      this.views.delete(id);
    }
    // The wrecks were cleared away (a new shift): the fire goes out with them.
    if (this.crashEffect && this.wreckIds.size === 0) {
      this.crashEffect.dispose();
      this.crashEffect = null;
    }
  }

  /**
   * Two planes collided: turn them into wrecks. Each plane's mesh freezes
   * where it's drawn right now and a `CrashEffect` takes over (fireball,
   * falling wrecks, debris, fire and smoke) until the planes leave state.
   *
   * Planes are drawn slid towards the camera (see `placeOverTrack`), which
   * depends on the view direction; freezing the meshes in 3D is what keeps
   * the wreckage steady while the camera orbits the site.
   *
   * @returns the ground point under the wreckage (scene coordinates), for
   *          the camera to orbit. It is live: it follows the wrecks as they
   *          fall and slide. Null if neither plane has a mesh yet.
   */
  crash(planeIds: readonly number[]): Vector3 | null {
    this.crashEffect?.dispose();
    this.wreckIds.clear();
    const sources: WreckSource[] = [];
    for (const id of planeIds) {
      const view = this.views.get(id);
      if (!view) continue;
      this.wreckIds.add(id);
      view.ring.setEnabled(false);
      view.hoverRing.setEnabled(false);
      view.anchorRing.setEnabled(false);
      view.path?.dispose(false, true);
      view.path = null;
      sources.push({ rig: view.aircraft, color: view.color });
    }
    if (sources.length === 0) return null;
    const seed = planeIds.reduce((acc, id) => acc * 31 + id, 7);
    this.crashEffect = new CrashEffect(this.scene, sources, seed, this.shadows);
    return this.crashEffect.focus;
  }

  private updateView(
    view: PlaneView,
    plane: Plane,
    world: WorldSize,
    time: number,
    dt: number,
  ): void {
    const ground = plane.ground;
    const departure = plane.departure;

    // Altitude: cruise (higher outside the airspace) and glide down an
    // anchored approach, rate-limited so a new target never makes the plane
    // jump. After touchdown, settle onto the runway over the first few units
    // rolled. Departures sit on the runway until lift-off, then follow
    // their climb profile (see `departureAltitude`).
    const descent = ground ? Math.min(1, ground.travelled / FLARE_DISTANCE) : 0;
    let altitude: number;
    if (departure) {
      altitude = ground
        ? view.groundAltitude
        : departureAltitude(plane, world, view.groundAltitude);
      view.altitude = altitude;
    } else if (ground) {
      view.touchdownAltitude ??= view.altitude ?? view.groundAltitude;
      altitude = lerp(view.touchdownAltitude, view.groundAltitude, descent);
    } else {
      const target = airborneAltitude(plane, world);
      const step = MAX_VERTICAL_SPEED * dt;
      view.altitude =
        view.altitude === null
          ? target
          : view.altitude + Math.max(-step, Math.min(step, target - view.altitude));
      altitude = view.altitude;
    }

    // On the ground, draw with the scenery (depth-tested) rather than on top
    // of it, so a plane rolling into its hangar disappears behind the walls.
    // A departure's route line moves with it (see `pathGroup`).
    if (ground && !view.grounded) {
      view.grounded = true;
      for (const mesh of view.aircraft.all) mesh.renderingGroupId = 0;
      if (view.path) view.path.renderingGroupId = pathGroup(view);
    }
    // A departure climbing clear of the rooftops draws over the scenery again.
    if (!ground && view.grounded && altitude > OVERLAY_ALTITUDE) {
      view.grounded = false;
      for (const mesh of view.aircraft.all) mesh.renderingGroupId = OVERLAY_GROUP;
      if (view.path) view.path.renderingGroupId = pathGroup(view);
    }

    // Visual-only wind, fading out as the wheels touch the runway (and in
    // again as a departure climbs away). The offset is applied to the mesh
    // only: the sim position never moves.
    const windAmount = departure
      ? ground
        ? 0
        : Math.min(1, departure.climbed / CLIMB_DISTANCE)
      : 1 - descent;
    // In a wind stream (core/windStreams.ts) the plane is shaken much harder,
    // eased in and out so crossing the edge doesn't make it jump.
    const inStream = plane.windStreamId !== null ? 1 : 0;
    view.streamShake += (inStream - view.streamShake) * Math.min(1, dt * STREAM_SHAKE_EASE);
    const wind = windEffect(
      time,
      plane.id,
      plane.heading,
      windAmount * (1 + STREAM_SHAKE * view.streamShake),
    );
    const root = view.aircraft.root;
    this.placeOverTrack(plane, world, altitude, root.position);
    // Fake perspective (the camera is orthographic): higher planes look a
    // little bigger, planes on the ground a little smaller. Driven by the
    // eased altitude, so the size changes as smoothly as the height. The
    // warning ring keeps its size: it marks the real collision distance.
    // Hover: ease the highlight towards on/off. `dt` is 0 while paused, and
    // nothing can be grabbed then, so snap instead of freezing half-lit.
    const hoverTarget = this.highlighted.has(plane.id) && plane.phase === "flying" ? 1 : 0;
    view.hover =
      dt > 0 ? view.hover + (hoverTarget - view.hover) * ease(dt, HOVER_EASE) : hoverTarget;
    const perspective = 1 + (altitude - FLIGHT_ALTITUDE) * ALTITUDE_SCALE_PER_UNIT;
    root.scaling.setAll(perspective * (1 + view.hover * HOVER_SCALE));
    root.position.x += wind.drift.x;
    root.position.z -= wind.drift.y; // sim +y is scene -z (see coords.ts)
    root.position.y += wind.lift;

    // Yaw: heading plus crab into the wind, eased the short way round.
    const targetYaw = plane.heading + wind.crab;
    view.yaw =
      view.yaw === null
        ? targetYaw
        : normalizeAngle(
            view.yaw + angleDelta(view.yaw, targetYaw) * ease(dt, flightTuning.yawEase),
          );
    // Bank into turns in proportion to the sim turn rate. A positive turn
    // rate turns the nose to the plane's right, and rolling the right wing
    // down is a negative rotation about the nose (+x) axis.
    const targetBank = (plane.turnRate / MAX_TURN_RATE) * flightTuning.maxBank;
    view.bank += (targetBank - view.bank) * ease(dt, flightTuning.bankEase);
    // Pitch: nose up for the rotation at the end of a take-off roll, then
    // the climb attitude, levelling off as the climb flattens.
    let targetPitch = 0;
    if (departure && ground && plane.phase === "takeoff") {
      const from = ROTATE_SPEED * ROTATION_START;
      targetPitch =
        ROTATION_PITCH * Math.max(0, Math.min(1, (ground.speed - from) / (ROTATE_SPEED - from)));
    } else if (departure && !ground) {
      const t = Math.min(1, departure.climbed / CLIMB_DISTANCE);
      targetPitch = Math.max(ROTATION_PITCH * (1 - t), CLIMB_PITCH * 4 * t * (1 - t));
    }
    view.pitch += (targetPitch - view.pitch) * ease(dt, PITCH_EASE);
    root.rotation.set(
      -(view.bank + wind.roll), // roll about the nose
      headingToRotationY(view.yaw),
      wind.pitch + view.pitch, // positive: nose (+x) up
    );
    // Moving parts: wing flex, prop spin, strobes. Props wind down as the
    // plane slows, to an idle on the stand.
    const touchdownSpeed = PLANE_SPEED * LANDING_SPEED_START;
    animateAircraft(view.aircraft, {
      time,
      dt,
      bank: view.bank,
      chop: wind.chop,
      rollout: ground ? 1 - Math.min(1, ground.speed / touchdownSpeed) : 0,
      gear: this.updateGear(view, plane, dt),
      lights: !view.inHangar,
    });
    setHeadlights(view.aircraft, landingLightsOn(view, plane));

    // Sound cues timed to what's drawn (see audio/cues.ts).
    view.pan = this.screenPan(root.position);
    if (ground && !view.touchedDown && descent >= 1) {
      view.touchedDown = true;
      this.cues.push({ type: "touchdown", planeId: plane.id, pan: view.pan });
    }
    view.sinceWhoosh += dt;
    const bankShare = Math.abs(view.bank) / flightTuning.maxBank;
    if (!ground && bankShare > WHOOSH_BANK && view.sinceWhoosh > WHOOSH_GAP && dt > 0) {
      view.sinceWhoosh = 0;
      this.cues.push({ type: "bankWhoosh", planeId: plane.id, strength: bankShare, pan: view.pan });
    }

    // Proximity warning ring, pulsing.
    const warn = plane.warning && (plane.phase === "flying" || plane.phase === "climbout");
    if (warn && !view.warned) this.cues.push({ type: "warning", planeId: plane.id, pan: view.pan });
    view.warned = warn;
    view.ring.setEnabled(warn);
    if (warn) {
      this.placeOverTrack(plane, world, altitude, view.ring.position);
      // Follow the plane's wind drift, so the ring stays centred on it.
      view.ring.position.x += wind.drift.x;
      view.ring.position.z -= wind.drift.y;
      view.ring.visibility = 0.55 + 0.45 * Math.sin(time * 12);
    }

    // Hover ring: centred on the plane like the warning ring, growing from
    // 80 % to full size as it fades in, with a slow breath while held.
    const showHover = view.hover > 0.01;
    view.hoverRing.setEnabled(showHover);
    if (showHover) {
      this.placeOverTrack(plane, world, altitude, view.hoverRing.position);
      view.hoverRing.position.x += wind.drift.x;
      view.hoverRing.position.z -= wind.drift.y;
      view.hoverRing.scaling.setAll(0.8 + 0.2 * view.hover);
      const pulse = 1 - HOVER_RING_PULSE * (0.5 + 0.5 * Math.sin(time * 5));
      view.hoverRing.visibility = view.hover * HOVER_RING_ALPHA * pulse;
    }

    // Anchor ring: sits on the threshold (the anchored path's last point)
    // as a short-lived confirmation, see ANCHOR_RING_HOLD. The age restarts
    // whenever the path (re-)anchors; `dt` is 0 while paused, so a paused
    // ring holds its fade.
    const anchorEnd = plane.pathAnchored ? plane.path[plane.path.length - 1] : undefined;
    view.anchorAge = anchorEnd ? (view.anchorAge ?? -dt) + dt : null;
    const fade =
      view.anchorAge === null
        ? 0
        : 1 - Math.min(1, Math.max(0, view.anchorAge - ANCHOR_RING_HOLD) / ANCHOR_RING_FADE);
    view.anchorRing.setEnabled(anchorEnd !== undefined && fade > 0);
    if (anchorEnd && fade > 0) {
      toScene(anchorEnd, world, ANCHOR_RING_ALTITUDE, view.anchorRing.position);
      // Gentle breathing so it reads as "live" without competing with warnings.
      const s = 1 + 0.06 * Math.sin(time * 4);
      view.anchorRing.scaling.set(s, 1, s);
      // Ease out (quadratic): the ring dims quickly at first, then lingers.
      view.anchorRing.visibility = fade * fade;
    }

    if (view.pathVersion !== plane.pathVersion) this.rebuildPath(view, plane, world);
  }

  /**
   * Move the landing gear towards up or down (see `wantsGearDown`) and
   * return the drawn position, 0 (up) to 1 (down), smoothstepped so the
   * legs start and stop gently. Raises `gearMove` as the legs set off and
   * `gearLocked` as they arrive. Fixed gear is always down, silently.
   */
  private updateGear(view: PlaneView, plane: Plane, dt: number): number {
    if (view.kind === "light") return 1;
    const down = wantsGearDown(plane);
    if (view.gearDown === null) {
      // First sight of this plane: already where it should be.
      view.gearDown = down;
      view.gear = down ? 1 : 0;
    } else if (down !== view.gearDown) {
      view.gearDown = down;
      const seconds = GEAR_TRAVEL * (down ? 1 - view.gear : view.gear);
      this.cues.push({ type: "gearMove", planeId: plane.id, down, seconds, pan: view.pan });
    }
    const target = down ? 1 : 0;
    if (view.gear !== target && dt > 0) {
      const step = dt / GEAR_TRAVEL;
      view.gear = down ? Math.min(1, view.gear + step) : Math.max(0, view.gear - step);
      if (view.gear === target) {
        this.cues.push({ type: "gearLocked", planeId: plane.id, down, pan: view.pan });
      }
    }
    const g = view.gear;
    return g * g * (3 - 2 * g);
  }

  /** Screen position of a scene point across the view, -1 (left) to 1 (right). */
  private screenPan(p: Vector3): number {
    Vector3.TransformCoordinatesToRef(p, this.scene.getTransformMatrix(), this.scratch);
    return Math.max(-1, Math.min(1, this.scratch.x));
  }

  /**
   * Scene position for something flying `altitude` above `plane.pos` that
   * still appears on screen exactly over its ground track.
   *
   * The camera is orthographic and tilted, so a mesh straight above its sim
   * position would show up `altitude · sin(tilt)` further up the screen than
   * the ground point: away from the finger drawing its path and from the
   * path line itself. In an orthographic view, sliding a point along the view
   * direction doesn't move it on screen, so we start on the ground and slide
   * towards the camera until we reach `altitude`. The plane keeps its height
   * (shadows and depth still read as airborne) but lines up with the ground,
   * where input, paths and runway thresholds all live.
   */
  private placeOverTrack(plane: Plane, world: WorldSize, altitude: number, ref: Vector3): void {
    toScene(plane.pos, world, 0, ref);
    const dir = this.viewDir;
    // A camera looking at the ground has dir.y < 0; guard against a
    // horizontal view (no ground intersection) just in case.
    if (dir.y > -1e-3) {
      ref.y = altitude;
      return;
    }
    const t = altitude / dir.y; // negative: back towards the camera
    ref.set(ref.x + dir.x * t, altitude, ref.z + dir.z * t);
  }

  /**
   * Rebuild the path line. Only runs when the path changes (point added or
   * waypoint consumed), not every frame. The line starts at the plane's
   * position at rebuild time, which is at most one path spacing stale.
   *
   * A departure's planned route is dotted (see `DEPARTURE_DOT_SPACING`),
   * and shows from the moment it rolls out of its hangar. It starts at the
   * next route point rather than at the plane (on the ground, that's the
   * line-up point), so the dots don't crawl as it's rebuilt.
   */
  private rebuildPath(view: PlaneView, plane: Plane, world: WorldSize): void {
    // Each greased line gets its own material: dispose it too, or every
    // path point drawn leaks one.
    view.path?.dispose(false, true);
    view.path = null;
    view.pathVersion = plane.pathVersion;
    if (plane.path.length === 0 || !hasPathLine(plane)) return;

    const dotted = plane.departure !== null;
    // The player's path is drawn as a smooth curve through its points (see
    // render/pathLine.ts). A departure's route is left as is: it's already
    // smooth, and its dots must stay in step with the route points.
    const track = dotted ? plane.path : smoothTrack([plane.pos, ...plane.path]);
    const points = track.map((p) => toScene(p, world, PATH_ALTITUDE));
    let length = 0;
    for (let i = 1; i < track.length; i++) length += distance(track[i - 1]!, track[i]!);
    const line = CreateGreasedLine(
      `path-${plane.id}`,
      { points, updatable: true },
      {
        color: Color3.FromHexString(COLOR_HEX[plane.color]),
        width: dotted ? DEPARTURE_PATH_WIDTH : PATH_WIDTH,
        useDash: dotted,
        dashCount: dotted ? Math.max(1, Math.round(length / DEPARTURE_DOT_SPACING)) : 1,
        dashRatio: dotted ? DEPARTURE_DOT_RATIO : 0.5,
      },
      this.scene,
    );
    line.material!.alpha = dotted ? DEPARTURE_PATH_ALPHA : PATH_ALPHA;
    line.material!.transparencyMode = Material.MATERIAL_ALPHABLEND;

    line.isPickable = false;
    line.renderingGroupId = pathGroup(view);
    view.path = line;
  }
}
