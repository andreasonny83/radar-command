/**
 * Sound cues the renderer raises the frame an animation reaches the moment
 * a sound belongs to, so what's heard lines up with what's seen:
 *
 * - `gearMove`:   landing gear starts to extend or retract (the hydraulic
 *                 whine runs for `seconds`, the time the legs take);
 * - `gearLocked`: the legs reach the end of their travel (the clunk);
 * - `touchdown`:  the wheels meet the runway at the end of the flare;
 * - `bankWhoosh`: a plane rolls into a hard turn;
 * - `warning`:    a plane's proximity warning ring comes on.
 *
 * `pan` is where the plane is across the screen, -1 (left edge) to 1
 * (right edge), for stereo placement.
 *
 * Type-only module: render/sceneSync.ts raises cues, audio/mixer.ts plays
 * them (via main.ts), and neither layer depends on the other's code.
 */
export type AudioCue =
  | { type: "gearMove"; planeId: number; down: boolean; seconds: number; pan: number }
  | { type: "gearLocked"; planeId: number; down: boolean; pan: number }
  | { type: "touchdown"; planeId: number; pan: number }
  | { type: "bankWhoosh"; planeId: number; strength: number; pan: number }
  | { type: "warning"; planeId: number; pan: number };

/** Stereo position of a plane, -1 (left) to 1 (right), or 0 if unknown. */
export type PanLookup = (planeId: number) => number;
