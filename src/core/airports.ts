/**
 * Airport grounds: groups the runways into airports and lays out what
 * surrounds them. Decoration only (like core/scenery.ts): the simulation
 * never reads it.
 *
 * For each airport:
 *   - airside: the fenced, mown area round its runways, taxiways, aprons,
 *     approach lights, control tower and windsock (`perimeter`);
 *   - landside: a terminal with its car park, just outside the fence, where
 *     the access road arrives (`landside`, may be null if nothing fits).
 *
 * Runways sharing a centre are one airport (blue and yellow's X). Its
 * landside sits in the open wedge between the two runways' far arms, along
 * the bisector. A single runway puts its landside on the side away from its
 * apron, or failing that past its far end.
 */
import {
  CAR_BAY_DEPTH,
  CAR_BAY_WIDTH,
  CAR_PARK_DEPTH,
  CAR_PARK_LENGTH,
  OPENING_VIEW_MARGIN,
  PERIMETER_MARGIN,
  TERMINAL_DEPTH,
  TERMINAL_GAP,
  TERMINAL_LENGTH,
  TOWER_SETBACK,
} from "../config";
import { convexHull, convexPolygonsNear, rectCorners, roundedHull } from "./geometry";
import { frameView, isInViewFrame } from "./layout";
import { headingVector } from "./math";
import type { OrientedRect, Runway, RunwayColor, Vec2, WorldSize } from "./types";

/** A parking bay: cars drive in nose first and back out. */
export interface Bay {
  /** Where a parked car stands (the bay's middle). */
  pos: Vec2;
  /** Heading of a parked car: facing into the bay, away from the aisle. */
  heading: number;
  /** Point on the aisle's centreline right in front of the bay. */
  front: Vec2;
}

/** Terminal, car park and road access of one airport. */
export interface Landside {
  /** Heading from the airport out towards its landside. */
  direction: number;
  terminal: OrientedRect;
  carPark: OrientedRect;
  /** Middle of the car park's outer edge: the access road starts here. */
  entrance: Vec2;
  /**
   * Where the entry lane from `entrance` meets the aisle running the length
   * of the car park (the car park's centre).
   */
  gate: Vec2;
  /** Two rows of bays either side of the aisle (none across the entry lane). */
  bays: Bay[];
}

export interface Airport {
  runways: Runway[];
  /** Shared runway centre. */
  center: Vec2;
  /** Airside boundary, a convex polygon: mown grass inside, fence along it. */
  perimeter: Vec2[];
  /** Foot of the control tower. */
  tower: Vec2;
  windsock: Vec2;
  landside: Landside | null;
}

/** Approach lights reach this far past the runway's start (see render/runway.ts). */
const APPROACH_LIGHTS_REACH = 7.5;

/** Keep landside buildings at least this far from any other airport's fence. */
const LANDSIDE_CLEARANCE = 4;

/**
 * Where the camera frames the airports open so far (those with a runway of
 * an `open` colour): a shift opens over the first airport alone (the others
 * aren't built yet), and pulls back over the middle of them as each further
 * one opens. Their fences, with `OPENING_VIEW_MARGIN` spare round them
 * (see `frameView`). Once every airport is open the whole field is in
 * play: never tighter than the default view (zoom 1).
 *
 * @returns the view's centre and zoom, and how many airports it frames
 *          (so a caller can move the camera only when that grows).
 */
export function openAirportsView(
  airports: readonly Airport[],
  open: readonly RunwayColor[],
  world: WorldSize,
  aspect: number,
): { center: Vec2; zoom: number; count: number } {
  const shown = airports.filter((a) => a.runways.some((r) => open.includes(r.color)));
  const frame = frameView(
    shown.flatMap((a) => a.perimeter),
    OPENING_VIEW_MARGIN,
    world,
    aspect,
  );
  const zoom = shown.length === airports.length ? Math.min(1, frame.zoom) : frame.zoom;
  return { center: frame.center, zoom, count: shown.length };
}

/** Group the runways into airports and lay out each airport's grounds. */
export function layoutAirports(runways: readonly Runway[], world: WorldSize): Airport[] {
  const groups = new Map<string, Runway[]>();
  for (const r of runways) {
    const key = `${r.center.x},${r.center.y}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // First pass: airside of every airport, without tower, to check the
  // landside candidates against.
  const drafts = [...groups.values()].map((group) => {
    const center = group[0]!.center;
    const windsock = windsockSpot(group);
    const points = [...group.flatMap(airsidePoints), windsock];
    return { group, center, windsock, points, hull: convexHull(points) };
  });

  const placed: Vec2[][] = [];
  return drafts.map((draft, i) => {
    const others = drafts.filter((_, j) => j !== i).map((d) => d.hull);
    const candidates = landsideDirections(draft.group);
    let landside: Landside | null = null;
    for (const dir of candidates) {
      const option = placeLandside(draft.center, dir, draft.points, world);
      const shapes = [rectCorners(option.terminal), rectCorners(option.carPark)];
      const fits =
        shapes.every((s) => s.every((p) => isInViewFrame(p, world))) &&
        shapes.every((s) =>
          [...others, ...placed].every((o) => !convexPolygonsNear(s, o, LANDSIDE_CLEARANCE)),
        );
      if (fits) {
        landside = option;
        placed.push(...shapes);
        break;
      }
    }

    // The tower stands just inside the fence in front of the terminal, with a
    // clear view of the runways; with no terminal, where it would have been.
    const towerDir = headingVector(landside?.direction ?? candidates[0]!);
    const tower = landside
      ? {
          x: landside.terminal.center.x - towerDir.x * (TERMINAL_DEPTH / 2 + TOWER_SETBACK),
          y: landside.terminal.center.y - towerDir.y * (TERMINAL_DEPTH / 2 + TOWER_SETBACK),
        }
      : along(draft.center, towerDir, support(draft.points, draft.center, towerDir) + 1);

    return {
      runways: draft.group,
      center: draft.center,
      perimeter: roundedHull([...draft.points, tower], PERIMETER_MARGIN),
      tower,
      windsock: draft.windsock,
      landside,
    };
  });
}

/** Points the airside fence must enclose for one runway. */
function airsidePoints(r: Runway): Vec2[] {
  const d = headingVector(r.heading);
  const n = { x: -d.y, y: d.x };
  const back = r.length / 2 + APPROACH_LIGHTS_REACH;
  const half = r.width / 2 + 0.6;
  const start = along(r.center, d, -back);
  return [
    ...rectCorners(r.airfield.footprint),
    { x: start.x + n.x * half, y: start.y + n.y * half },
    { x: start.x - n.x * half, y: start.y - n.y * half },
  ];
}

/**
 * Windsock spot. A single runway: beside the threshold, on the side away
 * from its apron. Crossing runways: between the two thresholds, where the
 * approach ends of the X open out.
 */
function windsockSpot(group: readonly Runway[]): Vec2 {
  const r = group[0]!;
  const d = headingVector(r.heading);
  if (group.length > 1) {
    const b = bisector(group);
    return along(r.center, b, -r.length * 0.42);
  }
  // Right-hand normal points to the apron when apronSide is +1.
  const side = sideOfApron(r);
  const away = { x: d.y * side, y: -d.x * side };
  const base = along(r.threshold, d, 3);
  return along(base, away, r.width / 2 + 5);
}

/** +1 if the runway's apron is on its right (looking along the heading), else -1. */
function sideOfApron(r: Runway): 1 | -1 {
  const d = headingVector(r.heading);
  const right = { x: -d.y, y: d.x };
  const toApron = {
    x: r.airfield.apron.center.x - r.center.x,
    y: r.airfield.apron.center.y - r.center.y,
  };
  return toApron.x * right.x + toApron.y * right.y >= 0 ? 1 : -1;
}

/** Unit vector halfway between the landing directions of `group`. */
function bisector(group: readonly Runway[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const r of group) {
    const d = headingVector(r.heading);
    x += d.x;
    y += d.y;
  }
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Landside directions to try, best first (headings). */
function landsideDirections(group: readonly Runway[]): number[] {
  if (group.length > 1) {
    const b = bisector(group);
    return [Math.atan2(b.y, b.x)];
  }
  const r = group[0]!;
  const side = sideOfApron(r);
  // Opposite the apron: turn left of the heading for a right-hand apron.
  return [r.heading - (side * Math.PI) / 2, r.heading];
}

/** Terminal and car park out along `heading` from `center`, clear of `points`. */
function placeLandside(
  center: Vec2,
  heading: number,
  points: readonly Vec2[],
  world: WorldSize,
): Landside {
  const L = headingVector(heading);
  const perp = { x: -L.y, y: L.x };
  const front = support(points, center, L) + PERIMETER_MARGIN + TERMINAL_GAP;
  const terminalCenter = along(center, L, front + TERMINAL_DEPTH / 2);

  // Car park beside the terminal, on the side facing the middle of the
  // field, fronts lined up.
  const toMiddle = { x: world.width / 2 - center.x, y: world.height / 2 - center.y };
  const s = toMiddle.x * perp.x + toMiddle.y * perp.y >= 0 ? 1 : -1;
  const sideways = (TERMINAL_LENGTH + CAR_PARK_LENGTH) / 2 + 1.5;
  const carCenter = along(
    along(terminalCenter, perp, s * sideways),
    L,
    (CAR_PARK_DEPTH - TERMINAL_DEPTH) / 2,
  );

  return {
    direction: heading,
    terminal: {
      center: terminalCenter,
      heading: heading + Math.PI / 2,
      length: TERMINAL_LENGTH,
      width: TERMINAL_DEPTH,
    },
    carPark: {
      center: carCenter,
      heading: heading + Math.PI / 2,
      length: CAR_PARK_LENGTH,
      width: CAR_PARK_DEPTH,
    },
    entrance: along(carCenter, L, CAR_PARK_DEPTH / 2),
    gate: carCenter,
    bays: carParkBays(carCenter, heading),
  };
}

/**
 * Bays in a car park centred on `center` whose entrance faces `heading`:
 * one row along each long side, facing the aisle down the middle, leaving
 * room in the outer row (towards the entrance) for the entry lane.
 */
function carParkBays(center: Vec2, heading: number): Bay[] {
  const L = headingVector(heading); // across the car park, towards the entrance
  const A = { x: -L.y, y: L.x }; // along the aisle
  const count = Math.floor((CAR_PARK_LENGTH - 0.6) / CAR_BAY_WIDTH);
  const u0 = (-count * CAR_BAY_WIDTH) / 2;
  const rowV = CAR_PARK_DEPTH / 2 - 0.2 - CAR_BAY_DEPTH / 2;
  const bays: Bay[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const u = u0 + (i + 0.5) * CAR_BAY_WIDTH;
      // The entry lane crosses the outer row in the middle.
      if (side > 0 && Math.abs(u) < 1.5) continue;
      const front = along(center, A, u);
      bays.push({
        pos: along(front, L, side * rowV),
        heading: Math.atan2(L.y * side, L.x * side),
        front,
      });
    }
  }
  return bays;
}

/** Farthest any of `points` reaches from `center` along the unit vector `dir`. */
function support(points: readonly Vec2[], center: Vec2, dir: Vec2): number {
  let best = -Infinity;
  for (const p of points) {
    best = Math.max(best, (p.x - center.x) * dir.x + (p.y - center.y) * dir.y);
  }
  return best;
}

function along(p: Vec2, dir: Vec2, dist: number): Vec2 {
  return { x: p.x + dir.x * dist, y: p.y + dir.y * dist };
}
