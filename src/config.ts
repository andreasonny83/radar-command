/**
 * Game tuning constants.
 *
 * All distances are in world units and all times in seconds. The world is a
 * fixed 100 units tall (see `WORLD_HEIGHT`), so e.g. a speed of 8 means a
 * plane crosses the full height of the screen in ~12.5 seconds regardless of
 * the device resolution.
 */
import type { PlaneColor, RunwayColor } from "./core/types";

/** Available simulation speed multipliers. */
export const GAME_SPEEDS = [1, 1.5, 2, 3] as const;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Fixed playfield height (world units). */
export const WORLD_HEIGHT = 100;

/**
 * Fixed playfield width / height. The world (runways, scenery, airspace) is
 * the same size and shape on every screen and never changes on a window
 * resize: the camera fits it to the window instead (see render/camera.ts),
 * showing extra countryside on whichever axis the window has room to spare.
 */
export const WORLD_ASPECT = 16 / 9;

/**
 * Window shapes (width / height) the scenery map is sized to fill at any
 * zoom, pan or heading (see core/scenery.ts `mapBounds`). Outside this range
 * the zoomed-out view can reach past the landscape, where the clear colour
 * (dark grass) takes over. Wider range = bigger map = slower landscape build.
 */
export const VIEW_ASPECT_MIN = 4 / 3;
export const VIEW_ASPECT_MAX = 21 / 9;

/**
 * Tilt of the camera from straight down (radians). 0 = top-down radar view;
 * 0.9 ≈ 52°. Lives here (not in render/camera.ts) because the sim needs it
 * to work out what the default view shows (see core/layout.ts).
 */
export const CAMERA_TILT = 0.9;

/** Extra margin around the view frame when fitting the default view. */
export const CAMERA_FIT_PADDING = 1.04;

/**
 * The default camera view frames the whole world grown by this much on
 * every side (see `viewFrameBounds` in core/layout.ts). Measured as seen on
 * screen: the far and near sides get `VIEW_MARGIN / cos(CAMERA_TILT)` of
 * ground, which the tilt foreshortens back to the same on-screen gap as the
 * left and right.
 */
export const VIEW_MARGIN = 10;

/**
 * The airspace (where the player routes planes and planes can collide) is
 * the airports' area, runways, taxiways and hangars, grown by this much on
 * every side (see `airspaceBounds` in core/layout.ts). Measured on screen
 * like `VIEW_MARGIN`. Outside it planes cruise higher and keep clear of
 * each other on their own (see core/avoidance.ts). Flip
 * `DEBUG_SHOW_AIRSPACE` on to see the edge while tuning this.
 */
export const AIRSPACE_MARGIN = 24;

/** Lowest zoom (fully zoomed out). The scenery map is sized to cover it. */
export const ZOOM_MIN = 0.6;

/** Highest zoom (fully zoomed in). */
export const ZOOM_MAX = 6;

/**
 * Minimum world width required before the third (yellow) runway is added.
 * Yellow crosses blue, and the X plus red need about 4:3 of room, so a
 * square or portrait `WORLD_ASPECT` would only get two runways.
 */
export const YELLOW_RUNWAY_MIN_WIDTH = 125;

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

/** Collision/visual radius of a plane. */
export const PLANE_RADIUS = 2.2;

/** Cruise speed (units / second). */
export const PLANE_SPEED = 7;

/** Two flying planes closer than this crash. */
export const COLLISION_DISTANCE = PLANE_RADIUS * 2.2;

/** Two flying planes closer than this show a proximity warning. */
export const WARNING_DISTANCE = COLLISION_DISTANCE * 2.5;

/**
 * Automatic collision avoidance outside the airspace (see
 * core/avoidance.ts). A plane out there that is predicted to pass within
 * `AVOID_SEPARATION` of other traffic in the next `AVOID_LOOKAHEAD`
 * seconds turns away by up to `AVOID_MAX_TURN` radians off its course,
 * harder the closer and sooner the conflict. The separation is a little
 * over the collision distance so models never visibly overlap.
 */
export const AVOID_SEPARATION = COLLISION_DISTANCE * 1.8;
export const AVOID_LOOKAHEAD = 4;
export const AVOID_MAX_TURN = 0.9;

/** Pointer must go down within this distance of a plane to grab it. */
export const PLANE_GRAB_RADIUS = PLANE_RADIUS * 3;

/**
 * Height planes fly at inside the airspace (3D scene units, purely visual).
 * Clears the tallest scenery round the field: trees reach ~5.5 and the
 * control tower's antenna ~8.5 (render/airportGrounds.ts). Planes are drawn
 * over their ground track (render/sceneSync.ts `placeOverTrack`), so height
 * only shows as the gap to their shadow and in the crash camera's orbit.
 */
export const FLIGHT_ALTITUDE = 9;

/**
 * Height of planes well outside the airspace: arrivals descend from it as
 * they approach, departures climb back to it as they leave.
 */
export const OUTER_FLIGHT_ALTITUDE = 16;

/**
 * Distance past the airspace edge over which planes climb from
 * `FLIGHT_ALTITUDE` to `OUTER_FLIGHT_ALTITUDE` (world units).
 */
export const ALTITUDE_TRANSITION = 14;

/**
 * Glide slope: on an anchored path (see `Plane.pathAnchored`), a plane
 * starts descending this far (path length, world units) before the
 * threshold and crosses it at `THRESHOLD_ALTITUDE`, then flares onto the
 * runway over `FLARE_DISTANCE`.
 */
export const APPROACH_DISTANCE = 22;
export const THRESHOLD_ALTITUDE = 1.2;

/**
 * Fake perspective: the camera is orthographic, so a plane's size wouldn't
 * change with height. Its model grows by this fraction per unit above
 * `FLIGHT_ALTITUDE` and shrinks by it per unit below: ~0.83× on the ground,
 * ~1.14× at `OUTER_FLIGHT_ALTITUDE`. Exactly 1 at `FLIGHT_ALTITUDE`, where
 * every collision happens, so the model still matches `COLLISION_DISTANCE`.
 */
export const ALTITUDE_SCALE_PER_UNIT = 0.02;

// ---------------------------------------------------------------------------
// Steering (see core/plane.ts)
// ---------------------------------------------------------------------------

/**
 * Fastest a plane can change heading (rad / second, ~110°/s). Together with
 * `PLANE_SPEED` this sets the tightest possible turn radius:
 * `PLANE_SPEED / MAX_TURN_RATE` ≈ 3.7 units. A U-turn is a smooth arc, never
 * an instant flip.
 */
export const MAX_TURN_RATE = 1.9;

/**
 * How hard a plane steers towards its target heading: commanded turn rate
 * (rad/s) per radian of heading error, before `MAX_TURN_RATE` caps it.
 * Small errors get gentle corrections, so the plane eases onto its heading
 * instead of snapping.
 */
export const TURN_RESPONSE = 2.5;

/**
 * Time constant (seconds) for the actual turn rate to catch up with the
 * commanded one: the plane has to roll into and out of a bank. With
 * `TURN_RESPONSE` this gives a well-damped response (damping ratio ≈ 0.8),
 * so planes settle onto a heading without visible wobble.
 */
export const TURN_LAG = 0.15;

/** A waypoint within this distance of the plane counts as reached. */
export const WAYPOINT_CAPTURE_RADIUS = 1.5;

/**
 * When a drawn path runs out, look this far ahead along the heading: if that
 * point is off the field, the player was steering the plane out of the world
 * and it departs instead of turning back.
 */
export const EXIT_LOOKAHEAD = 8;

/**
 * Fixed sub-step (seconds) for flight integration. Steering is a feedback
 * loop, so a frame's dt is split into slices this size. That way 30, 60 and
 * 144 Hz displays fly the same curves.
 */
export const FLIGHT_SUBSTEP = 1 / 120;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Minimum spacing between recorded path points (keeps arrays small). */
export const PATH_MIN_SPACING = 1.2;

// ---------------------------------------------------------------------------
// Runways & landing
// ---------------------------------------------------------------------------

/** Strip size. Long and narrow-ish so it reads as a real runway. */
export const RUNWAY_LENGTH = 50;
export const RUNWAY_WIDTH = 5;

/** Distance from the runway end to the threshold marker. */
export const RUNWAY_THRESHOLD_INSET = 1.5;

/** A plane within this distance of a threshold is "over" it. */
export const LANDING_RADIUS = PLANE_RADIUS * 2;

/** Max difference between plane heading and runway heading (±60°). */
export const LANDING_ANGLE_TOLERANCE = Math.PI / 3;

/**
 * A path dragged to within this distance of its runway's threshold snaps
 * onto it and locks ("anchors"), if it arrives from the landing direction.
 * Generous (a runway width) so the player doesn't have to be pixel-perfect.
 */
export const ANCHOR_RADIUS = RUNWAY_WIDTH;

/**
 * Before anchoring, the plane's flight along the snapped path is dry-run
 * (see `anchorPath`). It must land with this much to spare, in distance
 * (units) and heading (radians), inside `LANDING_RADIUS` and
 * `LANDING_ANGLE_TOLERANCE`. The margin covers the small differences
 * between the dry run and the real, frame-by-frame flight.
 */
export const ANCHOR_LANDING_MARGIN = 0.8;
export const ANCHOR_HEADING_MARGIN = (8 * Math.PI) / 180;

/** Touchdown speed as a fraction of cruise. */
export const LANDING_SPEED_START = 0.8;

/** Angle between the blue and yellow runways, which cross (40°). */
export const CROSSING_ANGLE = (40 * Math.PI) / 180;
/** Heading halfway between blue's and yellow's landing directions (NNE). */
export const CROSSING_BISECTOR = (-60 * Math.PI) / 180;

/**
 * Runway layout as fractions of the world size (CLAUDE.md responsiveness
 * rule). `heading` is the landing direction. `apronSide` puts the taxiway
 * and hangars on the runway's right (+1) or left (-1), looking along the
 * landing direction.
 *
 * Red has an airfield of its own. Blue and yellow share one airport, like
 * a real field with two intersecting runways: same centre, headings
 * `CROSSING_ANGLE` apart, so the strips cross in a narrow X and both land
 * roughly the same way (into the prevailing wind). Runways with the same
 * centre are "crossing" runways (see `layoutRunways`). Each apron sits on
 * its runway's outer side, where the other strip falls away behind the
 * turnoff; the narrow wedge between the two far ends stays open grass:
 *
 *              blue ↗   ↗ yellow        (landing directions)
 *        [B]      ╲   ╱                 [B] blue apron, NW of its strip
 *                  ╲ ╱
 *                   X
 *                  ╱ ╲        [Y]       [Y] yellow apron, SE of its strip
 *
 * Red's apron faces the middle of the field.
 *
 * `narrow` overrides the position and apron side on screens too narrow for
 * yellow (see `YELLOW_RUNWAY_MIN_WIDTH`). Red and blue's headings are
 * almost exactly opposite, so there they become a pair of parallel runways
 * side by side, aprons facing outwards: red lands south on the left, blue
 * lands north on the right, and the approaches come from opposite ends.
 */
export const RUNWAY_LAYOUT: ReadonlyArray<{
  color: RunwayColor;
  fx: number;
  fy: number;
  heading: number;
  apronSide: 1 | -1;
  narrow?: { fx: number; fy: number; apronSide?: 1 | -1 };
}> = [
  // Lands a little west of south, on approach from the NNE over the open
  // top-middle of the field: clear of the X's approaches from the SW, and
  // the same room to approach on every screen width.
  {
    color: "red",
    fx: 0.25,
    fy: 0.6,
    narrow: { fx: 0.3, fy: 0.55, apronSide: 1 },
    heading: (100 * Math.PI) / 180,
    apronSide: -1,
  },
  {
    color: "blue",
    fx: 0.71,
    fy: 0.57,
    narrow: { fx: 0.7, fy: 0.5, apronSide: 1 },
    heading: CROSSING_BISECTOR - CROSSING_ANGLE / 2,
    apronSide: -1,
  },
  {
    color: "yellow",
    fx: 0.71,
    fy: 0.57,
    heading: CROSSING_BISECTOR + CROSSING_ANGLE / 2,
    apronSide: 1,
  },
];

// ---------------------------------------------------------------------------
// Airfield: taxiways, stands and hangars (see core/airfield.ts)
// ---------------------------------------------------------------------------
//
// Laid out in each runway's own frame: `u` runs along the landing direction
// from the runway centre (the far end is at +RUNWAY_LENGTH / 2), `v` runs
// sideways towards the apron (see `apronSide`).
//
//        hangar      hangar          v = HANGAR_DOOR_V … + HANGAR_DEPTH
//        [stand]     [stand]         v = STAND_V
//   ======H=====leadIn======leadIn=== v = TAXIWAY_OFFSET  (parallel taxiway)
//        /                            45° turnoff
//   ----X---------------------------  v = 0  (runway centreline)

/** `u` where the turnoff leaves the runway centreline. */
export const RUNWAY_EXIT_U = -3;

/**
 * `RUNWAY_EXIT_U` for crossing runways (see `RUNWAY_LAYOUT`): just past the
 * intersection, so the turnoff (on the outer side) clears the other strip
 * and its shoulder. Hold point and stands move along by the same amount.
 */
export const CROSSING_EXIT_U = 2;

/** Distance from the runway centreline to the parallel taxiway. */
export const TAXIWAY_OFFSET = 6.5;

/** `u` of each stand (one hangar per stand), nearest the turnoff first. */
export const STAND_U: readonly number[] = [10, 18.5];

/** `v` of each stand, where a plane slows to hangar speed and rolls on in. */
export const STAND_V = 12;

/** `v` of the hangar doorway (its open front), and the hangar's size. */
export const HANGAR_DOOR_V = 14.8;
export const HANGAR_DEPTH = 6.2;
export const HANGAR_WIDTH = 7;

/** `u` of the hold point on the taxiway, where planes wait for a free stand. */
export const HOLD_U = 6.5;

/** Paved taxiway width. */
export const TAXIWAY_WIDTH = 3.2;

/**
 * Corner radius of taxi routes. The planner rounds every corner into an arc
 * (shrinking it where segments are short), so turns are always smooth.
 */
export const TAXI_TURN_RADIUS = 6;
/** Tighter radius for the 90° turn off the taxiway into a stand. */
export const STAND_TURN_RADIUS = 3;

/**
 * After touchdown the plane curves onto the runway centreline over this
 * distance, whatever its lateral offset or heading error at the threshold.
 */
export const CENTERLINE_MERGE_DISTANCE = 8;

// ---------------------------------------------------------------------------
// Ground movement (see core/ground.ts)
// ---------------------------------------------------------------------------

/** Speed through the runway turnoff (units / second). */
export const TURNOFF_SPEED = 3.5;

/** Cruising speed along the taxiway. */
export const TAXI_SPEED = 3;

/** Speed rolling from the stand into the hangar. */
export const STOW_SPEED = 1.4;

/** Gentle braking along the runway, from touchdown down to `TURNOFF_SPEED`. */
export const ROLLOUT_BRAKE = 0.6;

/** Braking used to stop at the end of a route (stand, hold point, hangar). */
export const TAXI_BRAKE = 0.9;

/** Braking used to stop behind another plane. */
export const TRAFFIC_BRAKE = 1.6;

/** Firmest braking ever applied, when a stop is needed sooner than planned. */
export const MAX_GROUND_BRAKE = 4;

/** Acceleration when pulling away (units / second²). */
export const GROUND_ACCEL = 1.2;

/**
 * A plane on the ground won't move onto a point of its route that is closer
 * than this to another plane on the ground. It stops `GROUND_STOP_BUFFER`
 * short of the first such point, so queued planes sit nose to tail with a
 * small gap and never overlap.
 */
export const GROUND_SEPARATION = PLANE_RADIUS * 1.9;
export const GROUND_STOP_BUFFER = 1;

/** How far ahead along its route each plane looks for traffic. */
export const GROUND_LOOKAHEAD = 18;

/** Distance rolled after touchdown while the plane settles onto its wheels. */
export const FLARE_DISTANCE = 4.5;

// ---------------------------------------------------------------------------
// Spawning & difficulty
// ---------------------------------------------------------------------------

/** Seconds between spawns at the start of a shift. */
export const SPAWN_INTERVAL_START = 4;

/** Spawns never get more frequent than this. */
export const SPAWN_INTERVAL_MIN = 1;

/** Max random deviation from "straight inward" for a spawn heading (±0.5 rad). */
export const SPAWN_HEADING_JITTER = 0.5;

/**
 * New planes don't pop into view: each one starts off-screen and flies in
 * across the airspace edge, while an arrow on the screen edge shows where
 * it's coming from and which way it's heading (see ui/arrivalArrows.ts).
 * This is how long (seconds) the arrow shows at the default view before
 * the plane itself flies onto the screen.
 */
export const ARRIVAL_WARNING = 2.5;

// ---------------------------------------------------------------------------
// Departures (planes taking off from the field — see core/departures.ts)
// ---------------------------------------------------------------------------
//
//   hangar ─► taxiway ─► connector ─► backtrack ─► U-turn ─► line up ─► roll ─► climb out
//
// A departure rolls out of a hangar, taxis the same way as arrivals to the
// far end of the taxiway, crosses a short U-shaped connector onto the far
// end of the runway, backtracks down it, turns round at the threshold and
// takes off in the landing direction (into the prevailing wind), over the
// whole length of the strip.

/** Departures begin once this many planes have landed this shift. */
export const DEPARTURE_START_LANDINGS = 4;

/**
 * Seconds between departures (a random pick in this range each time). The
 * first one is due `DEPARTURE_INTERVAL_MIN` after the start count is reached.
 */
export const DEPARTURE_INTERVAL_MIN = 22;
export const DEPARTURE_INTERVAL_MAX = 38;

/**
 * `u` (runway frame, see the airfield diagram above) of the connector
 * from the taxiway onto the runway: near the far end, leaving the paved
 * turn inside the strip.
 */
export const DEPARTURE_ENTRY_U = RUNWAY_LENGTH / 2 - 2.5;

/**
 * A departure waits short of the runway until no plane of the runway's
 * colour is rolling out on it, and no arrival on an anchored approach is
 * within this distance of the threshold.
 */
export const DEPARTURE_ARRIVAL_CLEARANCE = 30;

/** Speed backtracking down the runway (units / second). */
export const BACKTRACK_SPEED = 4.5;

/** Speed through the U-turn that lines the plane up. */
export const LINEUP_TURN_SPEED = 2.6;

/** Radius of the line-up U-turn (fits inside the runway's paved width). */
export const LINEUP_TURN_RADIUS = 2.2;

/** Seconds lined up, engines spooling up, before the take-off roll. */
export const LINEUP_HOLD = 2;

/** Acceleration down the runway on the take-off roll (units / second²). */
export const TAKEOFF_ACCEL = 1.0;

/** Lift-off ("rotate") speed: the plane leaves the ground at this speed. */
export const ROTATE_SPEED = PLANE_SPEED * 0.85;

/** After lift-off the plane keeps accelerating, up to cruise speed. */
export const CLIMB_ACCEL = 0.35;

/**
 * Distance flown after lift-off to reach cruise altitude. The climb follows
 * a smoothstep: a gentle rotation, the steepest climb midway, then a
 * gradual level-off (see `departureAltitude` in render/sceneSync.ts).
 */
export const CLIMB_DISTANCE = 34;

/** Departures fly straight out along the runway this far before turning. */
export const DEPARTURE_STRAIGHT_OUT = 18;

/** Largest turn off the runway heading on the way out (radians, either side). */
export const DEPARTURE_MAX_TURN = (60 * Math.PI) / 180;

/** Spacing of the points on a departure's planned route (its dotted line). */
export const DEPARTURE_ROUTE_SPACING = 2;

// ---------------------------------------------------------------------------
// Progression (onboarding ramp — see core/progression.ts)
// ---------------------------------------------------------------------------

/** Hard ceiling on simultaneously flying planes, however far the shift goes. */
export const MAX_AIRBORNE = 8;

/** Each this-many landings allows one more plane in the air. */
export const LANDINGS_PER_EXTRA_PLANE = 2;

/** Each this-many seconds allows one more plane, so an idle player can't stall. */
export const SECONDS_PER_EXTRA_PLANE = 45;

/**
 * Landings after which each runway colour starts receiving planes. Runways open in
 * `RUNWAY_LAYOUT` order; the first one must be 0 so a new shift has a target.
 */
export const COLOR_UNLOCK_LANDINGS: Record<RunwayColor, number> = {
  red: 0,
  blue: 3,
  yellow: 7,
};

// ---------------------------------------------------------------------------
// Landscape (purely decorative — the sim never reads any of this)
// ---------------------------------------------------------------------------

/**
 * Extra ground beyond the farthest point the camera can ever show (see
 * core/scenery.ts `mapBounds`). Covers the frame or two the pan clamp lags
 * behind a zoom-out.
 */
export const MAP_MARGIN = 12;

// Airport grounds (see core/airports.ts) -----------------------------------

/** The airside fence runs this far outside everything it encloses. */
export const PERIMETER_MARGIN = 3;

/** Terminal building footprint: length along its frontage, depth. */
export const TERMINAL_LENGTH = 14;
export const TERMINAL_DEPTH = 5;

/** Gap from the fence to the terminal's airside front. */
export const TERMINAL_GAP = 3;

/** Control tower distance in front of the terminal (airside). */
export const TOWER_SETBACK = 4;

/** Car park beside the terminal: length along the frontage, depth. */
export const CAR_PARK_LENGTH = 11;
export const CAR_PARK_DEPTH = 8;

/** One parking bay: width along the row, depth into the row. */
export const CAR_BAY_WIDTH = 1.1;
export const CAR_BAY_DEPTH = 2.3;

// Countryside (see core/countryside.ts) -------------------------------------

/**
 * Fields, roads and woods cover this fraction of the scenery map (from its
 * centre); past it the grass fades into the horizon on its own.
 */
export const COUNTRYSIDE_REACH = 0.62;

/** Patchwork grid: rotation, and the range of field sizes. */
export const FIELD_ANGLE = 0.21;
export const FIELD_SIZE_MIN = 15;
export const FIELD_SIZE_MAX = 27;

/** Gap between neighbouring fields, where the hedgerows grow. */
export const HEDGE_GAP = 1.4;

/** Paved width of the country roads. */
export const ROAD_WIDTH = 2.2;

/** Roads keep at least this far from any airport's fence, terminal or car park. */
export const ROAD_CLEARANCE = 4;

/** Houses line the roads within this distance of the village centre. */
export const VILLAGE_RADIUS = 17;

// Road traffic (see core/cars.ts) ------------------------------------------

/** Most cars driving at once (some are always out in the haze); parked ones don't count. */
export const CAR_MAX = 20;

/** Share of car park bays with a car in them when the world is built. */
export const CAR_PARK_FILL = 0.55;

/** How long a car stays parked before it backs out and leaves (seconds). */
export const CAR_PARK_TIME_MIN = 30;
export const CAR_PARK_TIME_MAX = 90;

/** Speed limit in the car parks, and while backing out of a bay. */
export const CAR_PARK_SPEED = 1.2;

/** Seconds for a drawbridge's leaves to lift fully (or come back down). */
export const BRIDGE_LIFT_TIME = 3;

/** Seconds between new cars setting off (random in this range). */
export const CAR_SPAWN_MIN = 1.5;
export const CAR_SPAWN_MAX = 4;

/** Typical cruising speed (units / second; planes fly at `PLANE_SPEED`). */
export const CAR_SPEED = 3.4;

/** Cars keep this far behind the car ahead in their lane. */
export const CAR_FOLLOW_GAP = 2.2;

/** Distance from the road's centre line to the middle of each lane. */
export const CAR_LANE_OFFSET = 0.5;

/** Fixed seed: the stream and trees look the same on every load and resize. */
export const SCENERY_SEED = 0x5eed_a1e;

/** Average width of the water surface (world units). */
export const STREAM_WIDTH = 7;

/** Water width wanders ±this fraction around `STREAM_WIDTH` along the river. */
export const STREAM_WIDTH_VARIATION = 0.15;

/**
 * Peak angle (radians) between the river's flow and its general direction.
 * The direction is steered by smooth noise, so most of the river swings
 * less than this; ~0.6 gives lazy curves, past ~1.3 bends loop back.
 */
export const STREAM_MEANDER_ANGLE = 1.1;

/** Typical river length of one meander (two opposite bends). */
export const STREAM_WAVELENGTH = 90;

/**
 * Preferred base line of the stream as a fraction of the world height:
 * 0.05 is just inside the top of the field. `placeStream` then pushes the
 * river away from it only as far as `STREAM_AIRFIELD_CLEARANCE` requires,
 * so it ends up skirting the yellow airfield (0.5 would thread it between
 * the yellow runway and the red/blue pair, if there's room).
 */
export const STREAM_BASE_FY = 0.05;

/** Minimum gap between the river's outer bank and any airport fence, terminal or car park. */
export const STREAM_AIRFIELD_CLEARANCE = 4;

/** Sandy bank either side of the water, beyond the water's edge. */
export const STREAM_BANK_WIDTH = 1.2;

/** Candidate trees per 1000 units² (before rejection / density thinning). */
export const TREE_DENSITY = 0.8;

/**
 * No tree closer than this to any airport: its fence (which already runs
 * `PERIMETER_MARGIN` outside the runways, taxiways and hangars), terminal or
 * car park.
 */
export const TREE_RUNWAY_CLEARANCE = 2.5;

/** No tree closer than this to the stream's outer bank (≥ canopy radius). */
export const TREE_STREAM_CLEARANCE = 3.5;

/**
 * Tree size range. A scale-1 tree is ~3.5 units tall and ~2.5 wide (so up
 * to ~5.5 × 4 here, deliberately oversized to read at game zoom), still
 * under `FLIGHT_ALTITUDE`. Planes, paths and warning rings also draw in a
 * later rendering group (see render/scene.ts), so they always show on top
 * of the scenery anyway (e.g. a plane gliding down over the trees).
 */
export const TREE_SCALE_MIN = 1.0;
export const TREE_SCALE_MAX = 2.5;

/** Fraction of trees that are conifers; the rest are broadleaf. */
export const TREE_CONIFER_SHARE = 0.35;

// ---------------------------------------------------------------------------
// River boats (decorative, see core/boats.ts)
// ---------------------------------------------------------------------------

/**
 * Per boat type: cruising `speed` (units / second; planes fly at 7) and
 * `lane`, the sideways offset from the river's centre as a fraction of its
 * half-width. Different lanes let a fast motorboat overtake a sailboat.
 */
export const BOAT_TYPES = {
  sailboat: { speed: 1.8, lane: 0.3 },
  motorboat: { speed: 3.4, lane: 0.55 },
} as const;

/**
 * Seconds between boat launches from the river's ends (far out in the
 * haze), picked at random in this range.
 */
export const BOAT_SPAWN_MIN = 10;
export const BOAT_SPAWN_MAX = 22;

/** Most boats on the river at once (the river runs the whole map width). */
export const BOAT_MAX = 7;

/** Boats also fade in/out over this distance at the river's very ends. */
export const BOAT_FADE_DISTANCE = 8;

// ---------------------------------------------------------------------------
// Camera buttons
// ---------------------------------------------------------------------------

/** One press of a rotate button turns the view by 15°; presses accumulate. */
export const ROTATE_STEP = Math.PI / 12;

/** One press of a zoom button scales the view by 25%. */
export const ZOOM_STEP = 1.25;

/**
 * Arrow-key pan speed, in view half-heights per second. Scaling by the view
 * (not world units) keeps the on-screen speed the same at every zoom level.
 */
export const PAN_SPEED = 1.2;

// ---------------------------------------------------------------------------
// Follow camera (render/camera.ts, input/pointer.ts)
// ---------------------------------------------------------------------------

/**
 * Zoom the camera eases to when following a plane (right-click it; 1 =
 * default view). A player already zoomed in closer keeps their zoom.
 */
export const FOLLOW_ZOOM = 2.6;

// ---------------------------------------------------------------------------
// Opening view (main.ts, render/camera.ts)
// ---------------------------------------------------------------------------

/**
 * A shift opens with the camera over the first airport alone: the other
 * airports aren't there yet (no runway, grounds or fence until their first
 * runway opens; see render/sceneSync.ts `AIRPORT_REVEAL_DELAY`). This much
 * ground (world units) stays in view round the airport's fence, for planes
 * on approach. When a runway opens a new airport, the camera glides out to
 * frame every open airport (see core/airports.ts `openAirportsView`).
 */
export const OPENING_VIEW_MARGIN = 14;

// ---------------------------------------------------------------------------
// Crash cinematic (render/camera.ts, render/crash.ts, main.ts)
// ---------------------------------------------------------------------------

/** Zoom the camera eases to over a crash site (1 = default view). */
export const CRASH_ZOOM = 3.2;

/**
 * How far above the centre of the screen the crash site is framed, as a
 * fraction of the view's half-height: the game-over panel covers the lower
 * part of the screen, so the wreckage sits in the clear space above it.
 */
export const CRASH_FRAME_LIFT = 0.22;

/**
 * Seconds per full 360° turn of the slow orbit round a crash site. The orbit
 * speeds up gently from standstill over `CRASH_ORBIT_RAMP` seconds, so the
 * zoom-in lands first and the turn never starts with a jolt.
 */
export const CRASH_ORBIT_PERIOD = 28;
export const CRASH_ORBIT_RAMP = 2.5;

/**
 * Seconds between the crash and the game-over panel, so the player sees the
 * fireball and the wrecks hit the ground before anything covers the view.
 */
export const CRASH_OVERLAY_DELAY = 2.4;

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

/** Largest dt fed to the sim; avoids tunnelling after a tab switch. */
export const MAX_DT = 0.1;

// ---------------------------------------------------------------------------
// Colours (render + UI)
// ---------------------------------------------------------------------------

export const COLOR_HEX: Record<PlaneColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#eab308",
  // Departures: matches no runway, and stays clear of the green anchor ring.
  violet: "#a855f7",
};

// ---------------------------------------------------------------------------
// Development aids (leave off in a shipped build)
// ---------------------------------------------------------------------------

/**
 * Draw the airspace edge (see `airspaceBounds` in core/layout.ts) as a
 * dashed outline in the game. Players never see it; turn it on only while
 * tuning `AIRSPACE_MARGIN` to decide where the controlled area should end.
 */
export const DEBUG_SHOW_AIRSPACE = false;
