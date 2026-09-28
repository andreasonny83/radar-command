/**
 * Display smoothing for player-drawn path lines.
 *
 * A drawn path is the raw pointer samples, at least `PATH_MIN_SPACING`
 * apart (see core/path.ts). Joined with straight segments they read as a
 * jagged polyline, with corners the plane never flies: its limited turn
 * rate rounds every one of them off. So the renderer draws a smooth curve
 * through the same points instead. The sim path itself is untouched (the
 * anchoring and landing checks judge the recorded points), and the curve
 * passes through every one of them, so the line still runs under the
 * player's finger.
 */
import { distance } from "../core/math";
import type { Vec2 } from "../core/types";

/** Target length (world units) of each drawn sub-segment of the curve. */
export const PATH_SMOOTH_STEP = 0.3;
/** Cap on sub-segments per recorded segment, so a long jump stays cheap. */
const MAX_SUBDIVISIONS = 24;

/**
 * `track` as a smooth curve: a centripetal Catmull-Rom spline through every
 * point, sampled roughly every `step` world units.
 *
 * Centripetal (knot spacing √distance) rather than uniform, so unevenly
 * spaced points (a quick flick after a slow drag, or the short hop from
 * the plane to its first path point) never make the curve loop or cusp.
 * The ends are extended by reflection, so the curve starts and ends
 * heading along the first and last segments.
 */
export function smoothTrack(track: readonly Vec2[], step: number = PATH_SMOOTH_STEP): Vec2[] {
  if (track.length < 3) return track.map((p) => ({ ...p }));

  const n = track.length;
  const at = (i: number): Vec2 => {
    // Phantom end points, mirrored through the real ones.
    if (i < 0) return reflect(track[0]!, track[1]!);
    if (i >= n) return reflect(track[n - 1]!, track[n - 2]!);
    return track[i]!;
  };

  const out: Vec2[] = [{ ...track[0]! }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const pieces = Math.min(MAX_SUBDIVISIONS, Math.max(1, Math.ceil(distance(p1, p2) / step)));
    for (let k = 1; k <= pieces; k++) out.push(catmullRom(p0, p1, p2, p3, k / pieces));
  }
  return out;
}

/** `p` mirrored through `about`. */
function reflect(about: Vec2, p: Vec2): Vec2 {
  return { x: 2 * about.x - p.x, y: 2 * about.y - p.y };
}

/**
 * Point `u` (0 = `p1`, 1 = `p2`) along the centripetal Catmull-Rom segment
 * between `p1` and `p2`, evaluated with the Barry-Goldman pyramid.
 */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, u: number): Vec2 {
  // Knot intervals: √distance, floored so coincident points can't divide by 0.
  const knot = (a: Vec2, b: Vec2) => Math.max(1e-4, Math.sqrt(distance(a, b)));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;

  // Blend of `a` (weight at ta) and `b` (weight at tb) at parameter t.
  const mix = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}
