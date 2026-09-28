/**
 * Arrival arrows: before a plane flies into view (a new arrival, or any
 * plane approaching from outside the current view), an arrow on the screen
 * edge shows where it will come in and which way it's heading.
 *
 * This module only draws. The render layer works out where each arrow goes
 * (render/arrivals.ts projects approaching planes onto the screen), so the
 * UI stays free of Babylon. Markup lives in hudMarkup.ts (`arrivalArrowMarkup`).
 */
import { arrivalArrowMarkup } from "./hudMarkup";

/** One arrow to draw, in CSS pixels relative to the arrivals layer. */
export interface ArrivalMarker {
  /** Plane id: keeps each arrow's element (and its pulse) stable across frames. */
  id: number;
  /** CSS colour, the plane's runway colour. */
  color: string;
  /** Arrow centre, already pinned inside the screen edge. */
  x: number;
  y: number;
  /** Screen-space direction of travel (radians, 0 = right, +y down). */
  angle: number;
}

export interface ArrivalArrows {
  /** Show exactly `markers`: add, move and remove arrows to match. */
  update(markers: readonly ArrivalMarker[]): void;
}

/** Clearance (CSS px) kept between an arrow's centre and a HUD panel: its radius plus a gap. */
const AVOID_RADIUS = 28;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Drive the arrows inside `layer` (the `#arrivals` element). Arrows that
 * would sit under one of `obstacles` (HUD panels in the screen corners) are
 * slid out from under it.
 */
export function createArrivalArrows(
  layer: HTMLElement,
  obstacles: readonly HTMLElement[] = [],
): ArrivalArrows {
  const arrows = new Map<number, { el: HTMLElement; svg: SVGElement }>();

  return {
    update(markers) {
      const bounds = markers.length > 0 ? layer.getBoundingClientRect() : null;
      const blocked = bounds ? obstacleRects(obstacles, bounds) : [];
      const seen = new Set<number>();
      for (const m of markers) {
        seen.add(m.id);
        let arrow = arrows.get(m.id);
        if (!arrow) {
          layer.insertAdjacentHTML("beforeend", arrivalArrowMarkup());
          const el = layer.lastElementChild as HTMLElement;
          arrow = { el, svg: el.querySelector("svg")! };
          arrows.set(m.id, arrow);
        }
        const at = avoid(m.x, m.y, blocked, bounds!);
        // translate (not left/top) so moving an arrow never triggers layout.
        arrow.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
        arrow.el.style.color = m.color;
        arrow.svg.style.transform = `rotate(${m.angle}rad)`;
      }
      for (const [id, arrow] of arrows) {
        if (seen.has(id)) continue;
        arrow.el.remove();
        arrows.delete(id);
      }
    },
  };
}

/** Visible obstacles, relative to the layer and grown by `AVOID_RADIUS`. */
function obstacleRects(obstacles: readonly HTMLElement[], layer: DOMRect): Rect[] {
  const rects: Rect[] = [];
  for (const el of obstacles) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; // hidden (e.g. pause before a shift)
    rects.push({
      left: r.left - layer.left - AVOID_RADIUS,
      top: r.top - layer.top - AVOID_RADIUS,
      right: r.right - layer.left + AVOID_RADIUS,
      bottom: r.bottom - layer.top + AVOID_RADIUS,
    });
  }
  return rects;
}

/**
 * If (x, y) falls inside an obstacle, move it the shortest way out that
 * stays on screen. Obstacles sit in corners, so that's a slide along the
 * screen edge the arrow is pinned to.
 */
function avoid(
  x: number,
  y: number,
  rects: readonly Rect[],
  layer: DOMRect,
): { x: number; y: number } {
  for (const r of rects) {
    if (x <= r.left || x >= r.right || y <= r.top || y >= r.bottom) continue;
    const exits = [
      { x: r.left, y },
      { x: r.right, y },
      { x, y: r.top },
      { x, y: r.bottom },
    ].filter((p) => p.x >= 0 && p.x <= layer.width && p.y >= 0 && p.y <= layer.height);
    let best = exits[0];
    for (const p of exits) {
      if (Math.hypot(p.x - x, p.y - y) < Math.hypot(best!.x - x, best!.y - y)) best = p;
    }
    if (best) return best;
  }
  return { x, y };
}
