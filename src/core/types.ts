/**
 * Core simulation types.
 *
 * Everything in `src/core` is pure TypeScript: no DOM, no Babylon.js. The sim
 * lives on a flat 2D ground plane measured in "world units". The render layer
 * maps sim `(x, y)` onto Babylon's `(x, z)` ground axes.
 *
 * Conventions:
 * - Origin is the top-left corner of the playfield; `x` grows right, `y` grows
 *   "down" (towards the player), matching the original 2D prototype.
 * - Headings are radians measured with `Math.atan2(dy, dx)`, so `0` points
 *   along +x and `Math.PI / 2` points along +y.
 */

/** A point or vector on the ground plane, in world units. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Colours shared by runways and the planes that must land on them. */
export type RunwayColor = "red" | "blue" | "yellow";

/**
 * A plane's livery: a runway colour for arrivals, or violet for departures
 * taking off from the field (see core/departures.ts). Violet matches no
 * runway, so a departure can never land.
 */
export type PlaneColor = RunwayColor | "violet";

/**
 * Lifecycle of a single plane:
 * - `flying`   : airborne, follows its path, can collide.
 * - `landing`  : touched down, rolling out along the runway centreline.
 * - `taxiing`  : off the runway, following the taxiway to its stand (or
 *                waiting at the hold point for one to free up).
 * - `stowing`  : past its stand, rolling slowly on into the hangar without
 *                stopping.
 * - `landed`   : inside the hangar; pruned from state at the end of the step.
 * - `departing`: sent off the field by the player; flies straight on out of
 *                view and can't collide. Still steerable: a new path calls
 *                it back into play (see `isSteerable` in core/path.ts).
 * - `departed` : past the scenery map edge; pruned like `landed`, no score.
 *
 * Departures (planes taking off from the field, see core/departures.ts)
 * have phases of their own. The game flies them; the player can't steer
 * them:
 * - `outbound` : out of a hangar, along the taxiway, onto the runway's far
 *                end, back down the runway and round to line up.
 * - `takeoff`  : the take-off roll, accelerating down the runway until it
 *                lifts off.
 * - `climbout` : airborne on its planned route, climbing and speeding up;
 *                collides like a `flying` plane inside the airspace. Ends
 *                as `departed` past the map edge.
 *
 * Every phase from `landing` to `landed` is "on the ground" (see
 * `isOnGround`): no collisions, no player control, and movement is driven
 * by `Plane.ground` instead of the drawn path.
 */
export type PlanePhase =
  | "flying"
  | "landing"
  | "taxiing"
  | "stowing"
  | "landed"
  | "departing"
  | "departed"
  | "outbound"
  | "takeoff"
  | "climbout";

/**
 * Top-level game phase, drives which overlay the UI shows. `step` only
 * advances the sim while `playing`, so `paused` freezes everything in place.
 */
export type GamePhase = "start" | "playing" | "paused" | "gameover";

/** Size of the playfield in world units (fixed, see `WORLD_ASPECT`). */
export interface WorldSize {
  width: number;
  height: number;
}

export interface Plane {
  /** Stable id, used by the render layer to match meshes to planes. */
  id: number;
  color: PlaneColor;
  pos: Vec2;
  /** Direction of travel in radians (see file header for convention). */
  heading: number;
  /**
   * Current rate of heading change (rad/s, positive = heading increasing).
   * Heading only ever changes through this, so turns are always smooth arcs.
   * The renderer also uses it to bank the plane into turns.
   */
  turnRate: number;
  /** Remaining waypoints drawn by the player, consumed front-to-back. */
  path: Vec2[];
  /**
   * Bumped every time `path` changes (point added, waypoint consumed, path
   * cleared). Lets the renderer rebuild the path line only when needed.
   */
  pathVersion: number;
  phase: PlanePhase;
  /** Ground movement state, from touchdown until stowed; null while airborne. */
  ground: GroundState | null;
  /** True while another flying plane is dangerously close. */
  warning: boolean;
  /**
   * True once the drawn path has been snapped onto this plane's runway
   * threshold (see `anchorPath`). The path then ends exactly on the
   * threshold, and further drag points are ignored until a new path starts.
   */
  pathAnchored: boolean;
  /**
   * Whether the player may send this plane off the world (see `departing`).
   * False for a shift's opening plane, which must be landed.
   */
  canDepart: boolean;
  /**
   * True from the spawn until the plane first crosses into the airspace.
   * New planes start off-screen and fly in towards `entry` (see
   * core/spawner.ts); until they appear the HUD shows an arrow on the
   * screen edge. Like every plane outside the airspace it can't collide
   * (see core/collision.ts), but the player may already grab it and give
   * it a path.
   */
  inbound: boolean;
  /**
   * Where an inbound plane's track crosses into the airspace. It steers
   * back towards it after swerving round other traffic (see `avoidTurn`),
   * so it still arrives where its arrow promised. Null for planes that
   * weren't spawned inbound.
   */
  entry: Vec2 | null;
  /**
   * Heading offset (radians, positive = turn right) the automatic
   * collision avoidance adds to this plane's course this step. Only planes
   * outside the airspace get one (see core/avoidance.ts); 0 otherwise.
   */
  avoidTurn: number;
  /** Take-off state for departures (see core/departures.ts); null for arrivals. */
  departure: DepartureState | null;
}

/**
 * Per-plane state of a departure, from leaving its hangar until it flies
 * off the map. On the ground the plane moves along `Plane.ground` like any
 * taxiing plane; these fields add the take-off rules on top.
 */
export interface DepartureState {
  /** Runway it takes off from (the plane itself is violet). */
  runway: RunwayColor;
  /** Hangar stand it rolled out of; kept reserved until it's clear of it. */
  standId: number;
  /** Route distance where the plane leaves the stand for the taxiway. */
  leaveStandS: number;
  /** Route distance of the hold-short point: no further until `cleared`. */
  holdS: number;
  /** Route distance where the line-up U-turn starts (slow down for it). */
  uTurnS: number;
  /**
   * Cleared onto the runway. From then until lift-off the runway is
   * closed to arrivals (they go around, see `isTouchdownZoneClear`).
   */
  cleared: boolean;
  /** Seconds spent waiting on the stand for clearance. */
  waited: number;
  /** Seconds spent lined up at the end of the runway, spooling up. */
  lineupTime: number;
  /** Airspeed after lift-off (units / second); 0 on the ground. */
  speed: number;
  /** Distance flown since lift-off; drives the climb profile (render). */
  climbed: number;
}

/**
 * A densely sampled centreline the plane follows on the ground. Corners are
 * already rounded into arcs (see core/route.ts), so following it point by
 * point gives smooth, continuous turns.
 */
export interface GroundRoute {
  points: Vec2[];
  /** Direction of travel at each point (radians). */
  headings: number[];
  /** Distance along the route from its start to each point. */
  dist: number[];
}

/**
 * What waits at the end of a plane's current ground route: the hold point
 * (arrivals waiting for a stand), a hangar (arrivals parking), or the
 * runway (departures lining up, see core/departures.ts).
 */
export type RouteEnd = "hold" | "hangar" | "runway";

/** Per-plane ground movement, see core/ground.ts. */
export interface GroundState {
  route: GroundRoute;
  /** Distance travelled along `route`. */
  s: number;
  /** Current ground speed (units / second). */
  speed: number;
  /** Route distance where the runway turnoff begins (rollout → taxi). */
  exitS: number;
  /** What the plane does on reaching the end of `route`. */
  routeEnd: RouteEnd;
  /** Total distance rolled since touchdown; drives the flare and descent. */
  travelled: number;
  /** Stand this plane is cleared to, or null while still waiting for one. */
  standId: number | null;
  /** Touchdown order across the whole shift. Stands go first-come, first-served. */
  seq: number;
  /**
   * Route distance of the plane's stand, where it slows to hangar speed and
   * rolls straight on inside. Infinity until a stand is assigned.
   */
  stowS: number;
}

/**
 * A rectangle on the ground, rotated to `heading`: `length` along the
 * heading, `width` across it. Runways are one; so are aprons.
 */
export interface OrientedRect {
  center: Vec2;
  heading: number;
  length: number;
  width: number;
}

/** A parking spot in front of a hangar doorway. */
export interface Stand {
  /** Unique across the whole field (index into `allStands`). */
  id: number;
  color: RunwayColor;
  /** Point on the taxiway centreline where the turn into the stand is made. */
  leadIn: Vec2;
  /** Where the plane slows to hangar speed, nose towards the doorway. */
  pos: Vec2;
  /** Direction the plane faces when parked (towards the hangar doorway). */
  heading: number;
  /** Where the plane comes to rest inside the hangar. */
  hangarPos: Vec2;
  /** The hangar building behind the stand; `heading` points into it. */
  hangar: OrientedRect;
}

/**
 * Taxi layout serving one runway: a turnoff from the runway centreline onto
 * a parallel taxiway, and a row of hangar stands beside it. All points are
 * sim coordinates, computed from the runway (see core/airfield.ts).
 */
export interface Airfield {
  /** Distance along the runway (from its centre) of `exit`. */
  exitU: number;
  /** Point on the runway centreline where the turnoff leaves it. */
  exit: Vec2;
  /** Where the turnoff joins the parallel taxiway. */
  turnoff: Vec2;
  /** Waiting spot on the taxiway for planes with no free stand yet. */
  hold: Vec2;
  /** Far end of the parallel taxiway. */
  taxiwayEnd: Vec2;
  /**
   * Where departures leave the taxiway for the runway (on the taxiway
   * centreline), and where they join the runway centreline, near its far
   * end: a U-shaped connector between the two (see core/departures.ts).
   */
  departureEntry: Vec2;
  departureJoin: Vec2;
  stands: Stand[];
  /** Paved area holding the stands (drawn, and kept clear of trees). */
  apron: OrientedRect;
  /** Everything built for this runway, runway included (tree clearance). */
  footprint: OrientedRect;
}

export interface Runway {
  color: RunwayColor;
  /** Centre of the runway strip. */
  center: Vec2;
  /** Direction a plane must be travelling to land (radians). */
  heading: number;
  /** Strip length along `heading` (world units). */
  length: number;
  /** Strip width across `heading` (world units). */
  width: number;
  /** Touchdown point: planes must pass over this point to land. */
  threshold: Vec2;
  /** Taxiway, stands and hangars serving this runway. */
  airfield: Airfield;
}

export interface GameState {
  phase: GamePhase;
  /** Number of planes landed this shift. */
  score: number;
  /** Seconds since the current shift started. */
  elapsed: number;
  /** Seconds accumulated towards the next spawn. */
  spawnTimer: number;
  /** Seconds between spawns; shrinks as difficulty ramps up. */
  spawnInterval: number;
  /** Seconds accumulated towards the next departure (see core/departures.ts). */
  departureTimer: number;
  /** Seconds until the next departure is due, once departures have begun. */
  departureInterval: number;
  /** Next id handed out by `createPlane`. */
  nextPlaneId: number;
  /** Next touchdown sequence number (see `GroundState.seq`). */
  nextGroundSeq: number;
  /** Fixed playfield size: never changes, whatever the window does. */
  world: WorldSize;
  /**
   * Window width / height. Doesn't touch the world; only decides how much
   * ground the camera shows round it, so arrivals start out of sight.
   */
  viewAspect: number;
  /**
   * The ground the camera shows right now (sim coordinates): a rectangle,
   * `length` across the screen and `width` up it, turned with the view.
   * Reported by the renderer every frame; null until it has. Zoomed out,
   * rotated or panned, this reaches past the default view, and arrivals
   * must start beyond it too or they'd pop up on screen (see
   * core/spawner.ts `pickSpawn`).
   */
  liveView: OrientedRect | null;
  runways: Runway[];
  planes: Plane[];
}

/** Things that happened during a `step`, for the UI/renderer to react to. */
export type SimEvent =
  | { type: "spawned"; planeId: number }
  | { type: "landed"; planeId: number; color: RunwayColor }
  | { type: "crash"; planeIds: [number, number]; at: Vec2 }
  /** A landing pushed the score far enough to open another runway colour. */
  | { type: "unlocked"; color: RunwayColor }
  /** A plane reached its threshold with the runway blocked, and flew on. */
  | { type: "goAround"; planeId: number; color: RunwayColor }
  /** A departure rolled out of its hangar, bound for `color`'s runway. */
  | { type: "departureAnnounced"; planeId: number; color: RunwayColor }
  /** A departure was cleared onto `color`'s runway: closed to arrivals. */
  | { type: "runwayClosed"; planeId: number; color: RunwayColor }
  /** A departure started its take-off roll. */
  | { type: "takeoffRoll"; planeId: number; color: RunwayColor }
  /** A departure lifted off: `color`'s runway is open to arrivals again. */
  | { type: "liftoff"; planeId: number; color: RunwayColor };

/** Random source in `[0, 1)`. Injected so tests can be deterministic. */
export type Rng = () => number;
