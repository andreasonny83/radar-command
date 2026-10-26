/**
 * Season recolouring of a baked colour buffer (vertex or thin-instance
 * colours): `out = clamp(base × tint + lift × weight)` for the blend of two
 * seasons' looks (render/seasonTuning.ts).
 *
 * It has to happen on the colours themselves, not on the material: Babylon
 * multiplies a material's emissive colour by the vertex colour too, so a
 * "snow lift" set on the material would stay as green as the grass under it.
 * The buffers are small (a few thousand entries), and a season only slides
 * while it ends, so recolouring them on a change is cheap.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { SeasonPhase } from "../core/seasons";
import { SEASON_LOOKS, type SeasonLook, type SurfaceLook } from "./seasonTuning";

/** Steps the blend moves in (1/100): the buffer is rewritten at most that often. */
const BLEND_STEPS = 100;

export class SeasonalColors {
  private readonly out: Float32Array;
  /** Season, next season and blend step of the last recolouring. */
  private key = "";
  private readonly tint = new Color3();
  private readonly lift = new Color3();

  /**
   * @param base    the summer colours, RGBA per entry (alpha is kept).
   * @param weights per entry, how much of the lift it takes (0..1), or
   *                `null` for all 1: grass fading into the horizon takes
   *                none, so it still meets the edge of the map.
   * @param pick    which surface of a season's look recolours this buffer.
   * @param upload  hands the recoloured buffer back to its mesh.
   */
  constructor(
    private readonly base: Float32Array,
    private readonly weights: Float32Array | null,
    private readonly pick: (look: SeasonLook) => SurfaceLook,
    private readonly upload: (colors: Float32Array) => void,
  ) {
    this.out = new Float32Array(base);
  }

  /** Recolour for `phase`; nothing happens unless the season or blend step moved. */
  apply(phase: SeasonPhase): void {
    const step = Math.round(phase.blend * BLEND_STEPS);
    const key = `${phase.season}|${phase.next}|${step}`;
    if (key === this.key) return;
    this.key = key;

    const a = this.pick(SEASON_LOOKS[phase.season]);
    const b = this.pick(SEASON_LOOKS[phase.next]);
    const t = step / BLEND_STEPS;
    Color3.LerpToRef(Color3.FromHexString(a.tint), Color3.FromHexString(b.tint), t, this.tint);
    Color3.LerpToRef(Color3.FromHexString(a.lift), Color3.FromHexString(b.lift), t, this.lift);

    const { base, out, weights, tint, lift } = this;
    for (let i = 0; i < base.length; i += 4) {
      const w = weights ? weights[i / 4]! : 1;
      out[i] = Math.min(1, base[i]! * tint.r + lift.r * w);
      out[i + 1] = Math.min(1, base[i + 1]! * tint.g + lift.g * w);
      out[i + 2] = Math.min(1, base[i + 2]! * tint.b + lift.b * w);
    }
    this.upload(out);
  }
}
