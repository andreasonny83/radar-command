/**
 * Reads the renderer's numbers for the "stats for nerds" panel (ui/stats.ts):
 * draw calls, active meshes, triangles, CPU render time, canvas size and the
 * GPU. All the Babylon calls live here so the HUD stays renderer-free.
 *
 * The per-frame timers of `SceneInstrumentation` cost a little, so they run
 * only while the panel is open (`setEnabled`).
 */
import type { Engine } from "@babylonjs/core/Engines/engine";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Scene } from "@babylonjs/core/scene";

export interface RenderReading {
  drawCalls: number;
  activeMeshes: number;
  triangles: number;
  /** CPU time Babylon spent in `scene.render` last frame (ms). */
  renderMs: number;
  /** Drawing buffer size in pixels (already includes hardware scaling). */
  width: number;
  height: number;
  /** Babylon's hardware scaling level (1 = one buffer pixel per device pixel). */
  scaling: number;
}

export interface GpuInfo {
  /** The unmasked GPU name when the browser exposes it, e.g. "Apple M2". */
  renderer: string;
  /** "WebGL 2", "WebGL 1". */
  api: string;
}

export interface SceneStats {
  /** Start or stop the timers behind `renderMs` (they read 0 while off). */
  setEnabled(enabled: boolean): void;
  read(): RenderReading;
  /** Static for the session; read it once. */
  gpu(): GpuInfo;
}

export function createSceneStats(engine: Engine, scene: Scene): SceneStats {
  const instrumentation = new SceneInstrumentation(scene);
  return {
    setEnabled(enabled) {
      instrumentation.captureRenderTime = enabled;
    },
    read: () => ({
      drawCalls: instrumentation.drawCallsCounter.current,
      activeMeshes: scene.getActiveMeshes().length,
      triangles: Math.round(scene.getActiveIndices() / 3),
      renderMs: instrumentation.renderTimeCounter.current,
      width: engine.getRenderWidth(),
      height: engine.getRenderHeight(),
      scaling: engine.getHardwareScalingLevel(),
    }),
    gpu: () => ({
      renderer: engine.getGlInfo().renderer || "unknown",
      api: `WebGL ${engine.webGLVersion}`,
    }),
  };
}
