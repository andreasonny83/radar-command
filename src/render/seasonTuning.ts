/**
 * Season palette: how each season recolours the ground, trees and fields.
 * Purely visual (render/landscape.ts applies it); the sim only supplies
 * the season (core/seasons.ts).
 *
 * The scenery's own colours live in vertex / instance colours. A season
 * recolours them as `colour × tint + lift` (render/seasonColors.ts), a pair
 * per surface. Summer is the identity (the classic look); autumn pushes
 * green to gold and orange, winter drains it and lifts it towards snow. The
 * result is still lit by the scene, so snow goes dark with the night.
 * Colours are "#rrggbb".
 */
import type { Season } from "../core/seasons";

/** What one surface does in one season. */
export interface SurfaceLook {
  /** Multiplies the surface's own colour. */
  tint: string;
  /** Added on top: this is what makes snow white. */
  lift: string;
}

/** How a season recolours every seasonal surface. */
export interface SeasonLook {
  grass: SurfaceLook;
  /** Deciduous canopies: fresh, green, orange, bare. */
  broadleaf: SurfaceLook;
  /** Firs stay green; winter only dusts them. */
  conifer: SurfaceLook;
  fields: SurfaceLook;
}

export const SEASON_LOOKS: Record<Season, SeasonLook> = {
  spring: {
    grass: { tint: "#f2ffe0", lift: "#0a1a04" },
    broadleaf: { tint: "#e8ffc8", lift: "#1c2c00" },
    conifer: { tint: "#ffffff", lift: "#000000" },
    fields: { tint: "#e8ffd8", lift: "#06120a" },
  },
  summer: {
    grass: { tint: "#ffffff", lift: "#000000" },
    broadleaf: { tint: "#ffffff", lift: "#000000" },
    conifer: { tint: "#ffffff", lift: "#000000" },
    fields: { tint: "#ffffff", lift: "#000000" },
  },
  autumn: {
    grass: { tint: "#c8a860", lift: "#301800" },
    broadleaf: { tint: "#b06020", lift: "#5a2200" },
    conifer: { tint: "#e8f0e0", lift: "#000000" },
    fields: { tint: "#d8b070", lift: "#2a1400" },
  },
  winter: {
    grass: { tint: "#1c2026", lift: "#c4ccd8" },
    broadleaf: { tint: "#4a3f38", lift: "#2a2420" },
    conifer: { tint: "#b8ccc4", lift: "#3a4850" },
    fields: { tint: "#24282e", lift: "#bcc4d0" },
  },
};
