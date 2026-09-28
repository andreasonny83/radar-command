/**
 * Screen placement for arrival arrows (drawn by ui/arrivalArrows.ts).
 *
 * Every airborne plane that is off-screen and approaching gets an arrow
 * where its course crosses the screen edge, i.e. where it will fly into
 * view, pointing along that course. "Approaching" means its course runs
 * into the view, or it's a new arrival (`Plane.inbound`), which always
 * is. That covers any plane the current view leaves outside: arrivals
 * still flying in, planes zoomed or panned out of sight, ones the player
 * sent round outside the screen, departures climbing back across it.
 * Planes flying away get none.
 *
 * The course runs towards an arrival's `entry` point while it still steers
 * for it, straight ahead otherwise. (Pinning the plane's own position to
 * the nearest edge instead would put the arrow beside the plane, not where
 * it comes in: tens of pixels off at the default view, far more zoomed in
 * or for a diagonal approach.) The camera is orthographic, so a straight
 * course on the ground stays straight on screen, and working in screen
 * space keeps the arrows right at any zoom, pan or rotation. Once the
 * plane itself is on screen the arrow goes, since the plane now speaks for
 * itself.
 */
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX } from "../config";
import { headingVector } from "../core/math";
import type { GameState, PlanePhase, Vec2 } from "../core/types";
import type { ArrivalMarker } from "../ui/arrivalArrows";
import { toScene } from "./coords";

/** Arrow centre's distance from the screen edge (CSS px): half an arrow plus a gap. */
const EDGE_INSET = 34;
/**
 * A plane counts as on screen once its centre is this far inside the edge
 * (CSS px), i.e. most of the model is visible.
 */
const VISIBLE_INSET = 12;
/** Look-ahead (world units) used to find the on-screen direction of travel. */
const DIRECTION_PROBE = 5;

/** Phases in which a plane is in the air (the rest are on the ground or gone). */
const AIRBORNE: ReadonlySet<PlanePhase> = new Set(["flying", "departing", "climbout"]);

const scratchWorld = new Vector3();
const scratchA = new Vector3();
const scratchB = new Vector3();

/** Screen rectangle in CSS pixels. */
interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Arrows for the current frame. Call after `scene.render()`, so the view
 * matrices match what's on screen. `canvas` sizes the CSS pixel space.
 */
export function arrivalMarkers(
  state: GameState,
  scene: Scene,
  canvas: HTMLCanvasElement,
): ArrivalMarker[] {
  const camera = scene.activeCamera;
  if (!camera) return [];
  const engine = scene.getEngine();
  const renderW = engine.getRenderWidth();
  const renderH = engine.getRenderHeight();
  if (renderW === 0 || renderH === 0) return [];
  const viewport = camera.viewport.toGlobal(renderW, renderH);
  const transform = scene.getTransformMatrix();
  // Render pixels → CSS pixels (they differ with devicePixelRatio / hardware scaling).
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const sx = cssW / renderW;
  const sy = cssH / renderH;

  const project = (p: Vec2, out: Vector3): Vector3 => {
    // On the ground: planes are drawn over their ground track, whatever
    // their height (see `placeOverTrack` in sceneSync.ts).
    toScene(p, state.world, 0, scratchWorld);
    Vector3.ProjectToRef(scratchWorld, Matrix.IdentityReadOnly, transform, viewport, out);
    out.x *= sx;
    out.y *= sy;
    return out;
  };

  /** Where a plane counts as on screen: inset by `VISIBLE_INSET`. */
  const visible: Rect = {
    minX: VISIBLE_INSET,
    minY: VISIBLE_INSET,
    maxX: cssW - VISIBLE_INSET,
    maxY: cssH - VISIBLE_INSET,
  };
  /** Where arrow centres may sit: the screen, inset by `EDGE_INSET`. */
  const inner: Rect = {
    minX: EDGE_INSET,
    minY: EDGE_INSET,
    maxX: cssW - EDGE_INSET,
    maxY: cssH - EDGE_INSET,
  };

  const markers: ArrivalMarker[] = [];
  for (const plane of state.planes) {
    if (!AIRBORNE.has(plane.phase)) continue;
    const at = project(plane.pos, scratchA);
    const onScreen =
      at.x >= visible.minX && at.x <= visible.maxX && at.y >= visible.minY && at.y <= visible.maxY;
    if (onScreen) continue;

    // The course on screen: straight ahead, or towards the entry point
    // while that is still ahead (the plane steers for it, see
    // `desiredHeading` in core/plane.ts; mid-swerve it heads back to it).
    const dir = headingVector(plane.heading);
    let aim = project(
      { x: plane.pos.x + dir.x * DIRECTION_PROBE, y: plane.pos.y + dir.y * DIRECTION_PROBE },
      scratchB,
    );
    let dx = aim.x - at.x;
    let dy = aim.y - at.y;
    if (plane.entry) {
      aim = project(plane.entry, scratchB);
      const ex = aim.x - at.x;
      const ey = aim.y - at.y;
      if (ex * dx + ey * dy > 0) {
        dx = ex;
        dy = ey;
      }
    }

    // Approaching: the course comes into view, by the same measure as
    // "on screen" above, so a plane gliding in along the screen edge counts
    // too. A new arrival always is (only briefly off course, e.g.
    // mid-swerve). Anything else is flying away or past: no arrow.
    if (!plane.inbound && !rayEntry(at.x, at.y, dx, dy, visible)) continue;
    // The arrow sits where the course crosses the arrows' own inset edge,
    // or at the nearest edge point if it only grazes the screen's rim.
    const hit = rayEntry(at.x, at.y, dx, dy, inner);
    markers.push({
      id: plane.id,
      color: COLOR_HEX[plane.color],
      x: hit ? hit.x : clamp(at.x, inner.minX, inner.maxX),
      y: hit ? hit.y : clamp(at.y, inner.minY, inner.maxY),
      angle: Math.atan2(dy, dx),
    });
  }
  return markers;
}

/**
 * Where the ray from (x, y) along (dx, dy) first enters `r` (slab method:
 * the latest of the per-axis entry times, if it comes before the earliest
 * exit), or null if it misses. (x, y) is outside `r`: off-screen planes
 * are outside both rectangles used, since `VISIBLE_INSET` < `EDGE_INSET`.
 */
function rayEntry(
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: Rect,
): { x: number; y: number } | null {
  let tIn = 0;
  let tOut = Infinity;
  for (const [p, d, lo, hi] of [
    [x, dx, r.minX, r.maxX],
    [y, dy, r.minY, r.maxY],
  ] as const) {
    if (d === 0) {
      // Parallel to this pair of edges: inside the slab or never in.
      if (p < lo || p > hi) return null;
      continue;
    }
    const t1 = (lo - p) / d;
    const t2 = (hi - p) / d;
    tIn = Math.max(tIn, Math.min(t1, t2));
    tOut = Math.min(tOut, Math.max(t1, t2));
  }
  if (tIn > tOut) return null;
  return { x: x + dx * tIn, y: y + dy * tIn };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
