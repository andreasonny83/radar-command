/**
 * Airfield layout: the taxiway, stands and hangars serving each runway.
 *
 * Everything is placed in the runway's own frame (see the diagram in
 * config.ts), then converted to sim coordinates, so it follows its runway
 * around on every screen size and orientation:
 *
 *   u: along the landing direction, from the runway centre;
 *   v: sideways, towards the side the apron is on (`apronSide`).
 */
import {
  DEPARTURE_ENTRY_U,
  HANGAR_DEPTH,
  HANGAR_DOOR_V,
  HANGAR_WIDTH,
  HOLD_U,
  RUNWAY_EXIT_U,
  RUNWAY_LENGTH,
  STAND_U,
  STAND_V,
  TAXIWAY_OFFSET,
  TAXIWAY_WIDTH,
} from "../config";
import { normalizeAngle } from "./math";
import type { Airfield, Runway, RunwayColor, Stand, Vec2 } from "./types";

/** Runway frame → sim coordinates. */
export interface RunwayFrame {
  (u: number, v: number): Vec2;
  /** Heading of the frame's +v axis (towards the apron). */
  sideHeading: number;
}

/**
 * Build the frame of a runway centred on `center`, landing along `heading`,
 * with its apron on `side` (+1 right, -1 left of the landing direction).
 */
export function runwayFrame(center: Vec2, heading: number, side: 1 | -1): RunwayFrame {
  const ux = Math.cos(heading);
  const uy = Math.sin(heading);
  // Right-hand normal (sim y points down, so +π/2 is a right turn).
  const vx = -uy * side;
  const vy = ux * side;
  const frame = ((u: number, v: number) => ({
    x: center.x + ux * u + vx * v,
    y: center.y + uy * u + vy * v,
  })) as RunwayFrame;
  frame.sideHeading = normalizeAngle(heading + (side * Math.PI) / 2);
  return frame;
}

/**
 * Taxiway, stands and hangars for one runway. Stand ids start at
 * `firstStandId` so they stay unique across the whole field.
 *
 * @param exitU  `u` of the turnoff (see `RUNWAY_EXIT_U`). A later exit, as
 *   on crossing runways (`CROSSING_EXIT_U`), slides the whole taxiway, hold
 *   point and stands along by the same amount, so their spacing is kept.
 */
export function layoutAirfield(
  color: RunwayColor,
  center: Vec2,
  heading: number,
  side: 1 | -1,
  firstStandId: number,
  exitU: number = RUNWAY_EXIT_U,
): Airfield {
  const at = runwayFrame(center, heading, side);
  const into = at.sideHeading; // parked planes face away from the runway
  const shift = exitU - RUNWAY_EXIT_U;
  const standU = STAND_U.map((u) => u + shift);

  const hangarCenterV = HANGAR_DOOR_V + HANGAR_DEPTH / 2;
  const stands: Stand[] = standU.map((u, i) => ({
    id: firstStandId + i,
    color,
    leadIn: at(u, TAXIWAY_OFFSET),
    pos: at(u, STAND_V),
    heading: into,
    // Come to rest in the middle of the hangar.
    hangarPos: at(u, hangarCenterV),
    hangar: {
      center: at(u, hangarCenterV),
      heading: into,
      length: HANGAR_DEPTH,
      width: HANGAR_WIDTH,
    },
  }));

  // Apron: paved from the taxiway's inner edge to the hangar doorways, spanning
  // every stand with a little margin either side.
  const firstU = Math.min(...standU) - HANGAR_WIDTH / 2 - 0.5;
  const lastU = Math.max(...standU) + HANGAR_WIDTH / 2 + 0.5;
  const apronInner = TAXIWAY_OFFSET - TAXIWAY_WIDTH / 2;
  const apronCenterU = (firstU + lastU) / 2;
  const apronCenterV = (apronInner + HANGAR_DOOR_V) / 2;

  // Footprint: runway plus everything beside it, out to the hangars' backs.
  const backV = HANGAR_DOOR_V + HANGAR_DEPTH;
  const footMinU = -RUNWAY_LENGTH / 2;
  const footMaxU = Math.max(RUNWAY_LENGTH / 2, lastU);
  const footMinV = -TAXIWAY_WIDTH; // just past the runway's far edge
  const footprint = {
    center: at((footMinU + footMaxU) / 2, (footMinV + backV) / 2),
    heading,
    length: footMaxU - footMinU,
    width: backV - footMinV,
  };

  return {
    exitU,
    exit: at(exitU, 0),
    // A 45° turnoff: as far along as it is sideways.
    turnoff: at(exitU + TAXIWAY_OFFSET, TAXIWAY_OFFSET),
    hold: at(HOLD_U + shift, TAXIWAY_OFFSET),
    taxiwayEnd: at(lastU, TAXIWAY_OFFSET),
    // Departures cross from the taxiway onto the runway's far end here.
    departureEntry: at(DEPARTURE_ENTRY_U, TAXIWAY_OFFSET),
    departureJoin: at(DEPARTURE_ENTRY_U, 0),
    stands,
    apron: {
      center: at(apronCenterU, apronCenterV),
      heading,
      length: lastU - firstU,
      width: HANGAR_DOOR_V - apronInner,
    },
    footprint,
  };
}

/** Every stand on the field, indexed by `Stand.id`. */
export function allStands(runways: readonly Runway[]): Stand[] {
  return runways.flatMap((r) => r.airfield.stands);
}
