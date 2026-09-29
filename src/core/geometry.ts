/**
 * 2D geometry helpers for laying out decorative scenery (airport grounds,
 * fields, roads): polygons, oriented rectangles and distances between them.
 * Pure functions in sim coordinates.
 */
import { headingVector } from "./math";
import type { OrientedRect, Vec2 } from "./types";

/** The four corners of an oriented rectangle, in order round its edge. */
export function rectCorners(r: OrientedRect): Vec2[] {
  const d = headingVector(r.heading);
  const hl = r.length / 2;
  const hw = r.width / 2;
  return [
    [hl, hw],
    [hl, -hw],
    [-hl, -hw],
    [-hl, hw],
  ].map(([u, v]) => ({
    x: r.center.x + d.x * u! - d.y * v!,
    y: r.center.y + d.y * u! + d.x * v!,
  }));
}

/** Cross product of (a - o) × (b - o): > 0 when o → a → b turns clockwise on screen. */
function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Convex hull of `points` (Andrew's monotone chain), without repeated end point. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Convex hull of `points` grown by `margin`, with rounded corners: every
 * point is replaced by a small ring of `segments` points around it first.
 */
export function roundedHull(points: readonly Vec2[], margin: number, segments = 12): Vec2[] {
  const ring: Vec2[] = [];
  for (const p of points) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push({ x: p.x + Math.cos(a) * margin, y: p.y + Math.sin(a) * margin });
    }
  }
  return convexHull(ring);
}

/** True if `p` is inside the polygon (edges count as inside). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** True if `p` is inside the oriented rectangle (edges count as inside). */
export function pointInRect(p: Vec2, r: OrientedRect): boolean {
  // Project onto the rectangle's own axes: along `heading` and across it.
  const d = headingVector(r.heading);
  const dx = p.x - r.center.x;
  const dy = p.y - r.center.y;
  const along = dx * d.x + dy * d.y;
  const across = -dx * d.y + dy * d.x;
  return Math.abs(along) <= r.length / 2 && Math.abs(across) <= r.width / 2;
}

/** Distance from `p` to the segment `a`–`b`. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Distance from `p` to a polygon's area: 0 inside, else to the nearest edge. */
export function distanceToPolygon(p: Vec2, poly: readonly Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, poly[j]!, poly[i]!));
  }
  return best;
}

/** Projections of `poly` onto the unit axis `d`: [min, max]. */
function project(poly: readonly Vec2[], d: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const t = p.x * d.x + p.y * d.y;
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return [min, max];
}

/**
 * True if two convex polygons come within `gap` of each other (separating
 * axis test on every edge normal of both).
 */
export function convexPolygonsNear(a: readonly Vec2[], b: readonly Vec2[], gap = 0): boolean {
  for (const poly of [a, b]) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ex = poly[i]!.x - poly[j]!.x;
      const ey = poly[i]!.y - poly[j]!.y;
      const len = Math.hypot(ex, ey);
      if (len === 0) continue;
      const n = { x: -ey / len, y: ex / len };
      const [amin, amax] = project(a, n);
      const [bmin, bmax] = project(b, n);
      if (amax + gap < bmin || bmax + gap < amin) return false;
    }
  }
  return true;
}

/** Polygon centroid (area-weighted). */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const f = a.x * b.y - b.x * a.y;
    area += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  if (area === 0) return { ...poly[0]! };
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/**
 * Clip a convex polygon to the half-plane `n · p >= c` (Sutherland–Hodgman
 * against one edge). Returns the part of `poly` on that side, possibly empty.
 */
export function clipHalfPlane(poly: readonly Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = a.x * n.x + a.y * n.y - c;
    const db = b.x * n.x + b.y * n.y - c;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Polylines
// ---------------------------------------------------------------------------

/** Cumulative distance along `line` at each of its points. */
export function arcLengths(line: readonly Vec2[]): number[] {
  const along = [0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    along.push(along[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return along;
}

/** Points every `step` along a polyline (both ends kept). */
export function resamplePolyline(points: readonly Vec2[], step: number): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out: Vec2[] = [{ ...points[0]! }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = step - carry;
    while (t < len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > step * 0.25) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  return out;
}

/**
 * Round a polyline's corners by corner cutting (Chaikin), `iterations`
 * times. The two end points stay put.
 */
export function roundCorners(points: readonly Vec2[], iterations: number): Vec2[] {
  let pts = [...points];
  for (let k = 0; k < iterations && pts.length >= 3; k++) {
    const out: Vec2[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

/**
 * The polyline shifted `offset` to the right of its direction of travel
 * (sim +y is down the screen, so (-dy, dx) is to the right). Each point
 * moves along the average of its neighbouring segments' normals.
 */
export function offsetPolyline(points: readonly Vec2[], offset: number): Vec2[] {
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
    return {
      x: p.x - ((next.y - prev.y) / len) * offset,
      y: p.y + ((next.x - prev.x) / len) * offset,
    };
  });
}

/** Nearest point to `p` on a polyline: the point, its segment index and distance along. */
export function nearestOnPolyline(
  p: Vec2,
  line: readonly Vec2[],
): { point: Vec2; segment: number; along: number; distance: number } {
  let best = { point: { ...line[0]! }, segment: 0, along: 0, distance: Infinity };
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const len = Math.sqrt(lenSq);
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
    const q = { x: a.x + abx * t, y: a.y + aby * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.distance)
      best = { point: q, segment: i - 1, along: walked + len * t, distance: d };
    walked += len;
  }
  return best;
}
