/**
 * The fleet: which aircraft type each plane is. Pure (no rendering, no
 * audio), so both the renderer (render/aircraft.ts, the models) and the
 * sound (audio/sfx.ts, each type's engines) agree on it.
 *
 * - `airliner`:  twin-jet, swept low wing, underwing engines (largest);
 * - `turboprop`: regional twin, straight high wing, T-tail, 4-blade props;
 * - `light`:     single-engine trainer, high wing, 2-blade nose prop (smallest).
 */
export type AircraftKind = "airliner" | "turboprop" | "light";

/**
 * Which model a plane gets, from its id alone (stable for the plane's life,
 * and no extra RNG draw in the sim, so seeded tests stay deterministic).
 *
 * TODO(you): decide the fleet mix. This placeholder cycles evenly through
 * the three types. See the notes in the hand-off for trade-offs.
 */
export function aircraftKindFor(id: number): AircraftKind {
  const FLEET: readonly AircraftKind[] = ["airliner", "turboprop", "light"];
  return FLEET[id % FLEET.length] ?? "airliner";
}
