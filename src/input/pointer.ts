/**
 * Pointer input: drag from a plane to draw its flight path; drag anywhere
 * else to grab and move the map.
 *
 * Uses DOM Pointer Events, which unify mouse, touch and pen — so this one
 * code path covers mousedown/move/up and touchstart/move/end. Each pointer is
 * tracked separately, so on touch screens several fingers can route several
 * planes at once. Grabbing a plane always wins over panning: a press only
 * pans when no plane is in grab range (or when paths can't be drawn, e.g.
 * while paused), so routing is never stolen by the camera.
 *
 * Right-click: picks a plane for the camera to follow (see `onFollow`); the
 * browser's context menu is suppressed on the canvas.
 *
 * Hover: a mouse or pen resting over a grabbable plane turns the cursor into
 * a pointer and reports the plane (see `refreshHover`), so the scene can
 * light it up as "you can drag this".
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import "@babylonjs/core/Culling/ray"; // side effect: adds scene.createPickingRay
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PLANE_GRAB_RADIUS } from "../config";
import { distance } from "../core/math";
import { anchorPath, appendPathPoint, clampPathPoint, isSteerable, startPath } from "../core/path";
import type { GameState, Plane, Vec2 } from "../core/types";
import { fromScene } from "../render/coords";

/**
 * Cast a ray from a screen point and intersect it with the ground (y = 0).
 * Returns the hit in sim coordinates, or null if the ray is parallel to it.
 *
 * Everything the player aims at shares this one mapping: planes are drawn
 * over their ground track (see render/sceneSync.ts), and paths and runways
 * lie on the ground. So the plane under the finger is the one grabbed, and
 * the path point lands exactly under the finger.
 *
 * Analytic plane intersection is cheaper than mesh picking and works even
 * when the pointer is off the playfield.
 */
function screenToWorld(
  scene: Scene,
  camera: Camera,
  state: GameState,
  screenX: number,
  screenY: number,
): Vec2 | null {
  const ray = scene.createPickingRay(screenX, screenY, Matrix.Identity(), camera);
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  return fromScene(ray.origin.add(ray.direction.scale(t)), state.world);
}

/**
 * Closest plane passing `accept` (default: steerable, see `isSteerable`)
 * within grab range of `point`, if any.
 */
function findPlaneNear(
  planes: readonly Plane[],
  point: Vec2,
  accept: (plane: Plane) => boolean = isSteerable,
): Plane | null {
  let best: Plane | null = null;
  let bestDist = PLANE_GRAB_RADIUS;
  for (const plane of planes) {
    if (!accept(plane)) continue;
    const d = distance(plane.pos, point);
    if (d < bestDist) {
      best = plane;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Hooks out of pointer input. Paths may be drawn anywhere on the map, past
 * the airspace edge included: outside it the game keeps planes apart on its
 * own (see core/avoidance.ts), so the edge needs no on-screen marker.
 */
export interface PointerFeedback {
  /**
   * Empty ground was dragged by (dx, dy), in canvas heights with +y down.
   * Without this hook, drags that miss a plane do nothing.
   */
  onPan?: (dx: number, dy: number) => void;
  /**
   * Right-click: the id of the plane under the pointer (any plane still in
   * the game: flying, departing, or rolling/taxiing on the ground), or null
   * when it missed every plane. Works while playing or paused.
   */
  onFollow?: (planeId: number | null) => void;
  /**
   * The player finished giving `planeId` a path: the drag ended with a
   * path drawn, or the path locked onto the plane's runway (`anchored`),
   * which ends the drag by itself. For the tower's radio readback.
   */
  onPathDrawn?: (planeId: number, anchored: boolean) => void;
}

/** Planes a right-click may pick to follow: any still visible in the game. */
function isFollowable(plane: Plane): boolean {
  return plane.phase !== "landed" && plane.phase !== "departed";
}

/** Handle on attached pointer input. */
export interface PointerInput {
  /**
   * Planes to highlight as interactive this frame: the steerable plane under
   * an idle mouse/pen (if any) plus every plane a pointer is routing right
   * now. Also sets the canvas cursor to match. Call once per frame: planes
   * fly under a cursor that isn't moving, so pointer events alone would go
   * stale. The returned set is reused between calls.
   */
  refreshHover(): ReadonlySet<number>;
  /** Remove all listeners. */
  dispose(): void;
}

/** Wire pointer events on `canvas` to path drawing and map panning. */
export function attachPointerInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  camera: Camera,
  getState: () => GameState,
  feedback: PointerFeedback = {},
): PointerInput {
  /** pointerId → id of the plane that pointer is routing. */
  const active = new Map<number, number>();
  /**
   * The one pointer dragging the map, and where it was last seen (canvas
   * pixels). Only one at a time: two fingers panning together would move
   * the map twice as fast as either finger.
   */
  let pan: { pointerId: number; x: number; y: number } | null = null;
  /**
   * Where a mouse or pen was last seen over the canvas (canvas pixels), or
   * null once it leaves. Touch never hovers, so it's never recorded: a
   * finger lifted off the screen mustn't leave a plane lit up.
   */
  let hoverAt: { x: number; y: number } | null = null;
  /** Reused result of `refreshHover`. */
  const highlighted = new Set<number>();

  /** Stop routing: forget the pointer. */
  const release = (pointerId: number) => {
    active.delete(pointerId);
  };

  const toCanvas = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: PointerEvent) => {
    // Secondary (right) button: pick a plane for the camera to follow.
    if (e.button === 2) {
      const state = getState();
      if (!feedback.onFollow || (state.phase !== "playing" && state.phase !== "paused")) return;
      const { x, y } = toCanvas(e);
      const hit = screenToWorld(scene, camera, state, x, y);
      const plane = hit && findPlaneNear(state.planes, hit, isFollowable);
      feedback.onFollow(plane ? plane.id : null);
      e.preventDefault();
      return;
    }
    // Only the primary (left) mouse button draws or pans; touch/pen report 0.
    if (e.button !== 0) return;
    const state = getState();
    const { x, y } = toCanvas(e);
    const hit = state.phase === "playing" ? screenToWorld(scene, camera, state, x, y) : null;
    const plane = hit && findPlaneNear(state.planes, hit);

    if (plane) {
      startPath(plane);
      active.set(e.pointerId, plane.id);
    } else if (feedback.onPan && pan === null) {
      pan = { pointerId: e.pointerId, x, y };
      canvas.style.cursor = "grabbing";
    } else {
      return;
    }
    // Keep receiving move/up for this pointer even if it leaves the canvas.
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch") hoverAt = toCanvas(e);
    if (pan && pan.pointerId === e.pointerId) {
      const { x, y } = toCanvas(e);
      const h = canvas.clientHeight || 1;
      feedback.onPan?.((x - pan.x) / h, (y - pan.y) / h);
      pan.x = x;
      pan.y = y;
      return;
    }
    const planeId = active.get(e.pointerId);
    if (planeId === undefined) return;
    const state = getState();
    const plane = state.planes.find((p) => p.id === planeId);
    // Plane landed/crashed/removed mid-drag: stop routing it.
    if (!plane || !isSteerable(plane) || state.phase !== "playing") {
      release(e.pointerId);
      return;
    }
    const { x, y } = toCanvas(e);
    const hit = screenToWorld(scene, camera, state, x, y);
    if (!hit) return;

    // Anywhere on the map is fair game; only the map's own edge clamps.
    const point = clampPathPoint(hit, state.world);
    if (!appendPathPoint(plane, point)) return;
    // Reached the runway from the right direction: the path snaps onto the
    // threshold and is finished, so this pointer stops routing the plane.
    if (anchorPath(plane, state.runways, state.world)) {
      release(e.pointerId);
      feedback.onPathDrawn?.(plane.id, true);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (pan && pan.pointerId === e.pointerId) {
      pan = null;
      canvas.style.cursor = "";
    }
    // Let go of a plane with a path drawn: the route is given. (A tap with
    // no drag leaves no path, and gets no readback.)
    const planeId = active.get(e.pointerId);
    const plane =
      planeId === undefined ? undefined : getState().planes.find((p) => p.id === planeId);
    release(e.pointerId);
    if (plane && isSteerable(plane) && plane.path.length > 0) {
      feedback.onPathDrawn?.(plane.id, plane.pathAnchored);
    }
  };

  const onLeave = () => {
    hoverAt = null;
  };

  // Right-click belongs to the follow camera, not the browser's menu.
  const onContextMenu = (e: Event) => e.preventDefault();

  const refreshHover = (): ReadonlySet<number> => {
    highlighted.clear();
    // A plane being routed stays lit for as long as it's held.
    for (const planeId of active.values()) highlighted.add(planeId);
    // Hover only while nothing is held: mid-drag the cursor is out drawing
    // a path, and planes it passes over aren't about to be grabbed.
    const state = getState();
    let overPlane = false;
    if (hoverAt && !pan && active.size === 0 && state.phase === "playing") {
      const hit = screenToWorld(scene, camera, state, hoverAt.x, hoverAt.y);
      const plane = hit && findPlaneNear(state.planes, hit);
      if (plane) {
        highlighted.add(plane.id);
        overPlane = true;
      }
    }
    // Panning owns the cursor ("grabbing") until it ends. Only write on
    // change: this runs every frame.
    if (!pan) {
      const cursor = overPlane || active.size > 0 ? "pointer" : "";
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
    return highlighted;
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("contextmenu", onContextMenu);

  return {
    refreshHover,
    dispose: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
