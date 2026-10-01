/**
 * The toast (see `Hud.showToast`) each simulation event shows, if any.
 * Shared by the game (main.ts) and the Storybook stories that run the sim,
 * so both word every notice the same way.
 */
import { COLOR_HEX, WARNING_HEX } from "../config";
import type { SimEvent } from "../core/types";

export interface Toast {
  text: string;
  /** CSS colour to tint it with. */
  color: string;
}

/** The notice for `event`, or null for events that don't show one. */
export function toastFor(event: SimEvent): Toast | null {
  switch (event.type) {
    case "unlocked":
      return { text: `${event.color.toUpperCase()} runway open`, color: COLOR_HEX[event.color] };
    case "goAround":
      return {
        text: `${event.color.toUpperCase()} runway busy — go around`,
        color: COLOR_HEX[event.color],
      };
    // Departures (core/departures.ts) are violet; the runway they close
    // and reopen is named in its own colour.
    case "departureAnnounced":
      return { text: `Departure — ${event.color.toUpperCase()} runway`, color: COLOR_HEX.violet };
    case "runwayClosed":
      return {
        text: `${event.color.toUpperCase()} runway closed — departure`,
        color: COLOR_HEX.violet,
      };
    case "liftoff":
      return { text: `${event.color.toUpperCase()} runway open`, color: COLOR_HEX[event.color] };
    // The build-up to the lethal peak of an extreme (red-warning) wind stream
    // (core/windStreams.ts). "Black" is an internal name: never shown.
    case "blackWindPeak":
      return { text: "Extreme wind peaking — get clear", color: WARNING_HEX.red };
    default:
      return null;
  }
}
