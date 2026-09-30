/**
 * Mid-air collision and proximity detection.
 *
 * Only the airspace (see `airspaceBounds` in core/layout.ts), the area round
 * the airports, is controlled airspace. Paths may be drawn anywhere on the
 * map, so the player can park planes out past its edge or swing them wide
 * round the field; out there planes are deconflicted by the game itself
 * (see core/avoidance.ts) and never collide or warn, however close they
 * get. Separation is the player's job only inside the edge, and on any
 * plane flying a path they drew: the game doesn't steer those (see
 * `isPlayerRouted`), so they stay collidable wherever the path takes them.
 */
import { COLLISION_DISTANCE, WARNING_DISTANCE } from "../config";
import { isPlayerRouted } from "./avoidance";
import { isInAirspace } from "./layout";
import { distance } from "./math";
import type { Plane, WorldSize } from "./types";

export interface CollisionResult {
  /** First pair of planes found overlapping, or null. */
  crash: [Plane, Plane] | null;
  /** Ids of flying planes that are uncomfortably close to another. */
  warnings: Set<number>;
}

/**
 * True if `plane` takes part in collision checks: airborne, flying under
 * player control, and either inside the airspace or flying a player-drawn
 * path.
 *
 * - Planes on the ground (landing, taxiing, stowing) are ignored: aircraft
 *   overhead never collide with them, and they keep their own spacing
 *   (core/ground.ts).
 * - Departing planes are ignored: they are on their way off the world.
 *   Departures climbing out from the field (`climbout`) are not: they're
 *   airborne in the airspace, and the player has to keep arrivals clear of
 *   them (see core/departures.ts).
 * - Planes outside the airspace are ignored unless the player has routed
 *   them: that covers inbound planes still flying in (they only stop being
 *   inbound once they cross the edge, see core/plane.ts) and planes the
 *   game steers itself. A plane on a drawn path is the player's
 *   responsibility even past the edge, since nothing swerves it away.
 *
 * A pair only collides if *both* planes are in play, so an unrouted plane
 * just outside the edge can't crash into one just inside it (it swerves
 * round routed traffic instead, see core/avoidance.ts).
 */
function isInPlay(plane: Plane, world: WorldSize): boolean {
  if (plane.phase !== "flying" && plane.phase !== "climbout") return false;
  return isInAirspace(plane.pos, world) || isPlayerRouted(plane);
}

/**
 * Pairwise check of every plane in play (see `isInPlay`). O(n²), which is
 * fine for the handful of planes on screen.
 */
export function detectCollisions(planes: readonly Plane[], world: WorldSize): CollisionResult {
  const inPlay = planes.filter((p) => isInPlay(p, world));
  const warnings = new Set<number>();
  let crash: [Plane, Plane] | null = null;

  for (let i = 0; i < inPlay.length; i++) {
    const a = inPlay[i]!;
    for (let j = i + 1; j < inPlay.length; j++) {
      const b = inPlay[j]!;
      const d = distance(a.pos, b.pos);
      if (d < COLLISION_DISTANCE) {
        crash ??= [a, b];
      } else if (d < WARNING_DISTANCE) {
        warnings.add(a.id);
        warnings.add(b.id);
      }
    }
  }
  return { crash, warnings };
}
