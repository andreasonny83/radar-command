/**
 * Radar: a small scope in the bottom-left corner showing every plane in
 * the air, including the ground beyond the map edge, so a new arrival shows
 * up here seconds before it flies into view (and before its edge arrow).
 *
 * The scope is a circle round the map's centre, wide enough to hold the
 * whole map plus `RADAR_MARGIN` on its left and right.
 *
 * Canvas 2D, no Babylon: it reads the sim state (north-up in sim
 * coordinates, so it does not turn with the camera) and only draws.
 * Markup lives in hudMarkup.ts (`radarMarkup`); `RADAR_MARGIN` in config.ts
 * sets how far past the map it sees.
 */
import { COLOR_HEX, RADAR_MARGIN } from "../config";
import { headingVector } from "../core/math";
import type { Plane, PlanePhase, Runway, WorldSize } from "../core/types";

/** What the radar reads: a slice of `GameState`, so stories need not build a whole one. */
export interface RadarSnapshot {
  world: WorldSize;
  runways: readonly Pick<Runway, "color" | "center" | "heading" | "length">[];
  planes: readonly Pick<Plane, "id" | "color" | "pos" | "heading" | "phase" | "warning">[];
}

export interface Radar {
  /** Redraw. `now` is a millisecond clock (drives the sweep). Cheap enough for every frame. */
  update(snapshot: RadarSnapshot, now: number): void;
}

/** Planes in these phases are on the ground and left off the scope. */
const HIDDEN: ReadonlySet<PlanePhase> = new Set(["taxiing", "stowing", "landed", "departed"]);

/** Seconds per sweep of the scope. */
const SWEEP_SECONDS = 4;
/** Angular length of the sweep's fading tail (radians). */
const SWEEP_TAIL = 1.1;
/** Blip size (CSS px) and length of its heading tick. */
const BLIP_RADIUS = 3;
const BLIP_TICK = 6;

/** Drive the radar drawn on `canvas` (the `#radar` element). */
export function createRadar(canvas: HTMLCanvasElement): Radar {
  const ctx = canvas.getContext("2d");
  let sizeKey = "";
  let cssW = 0;
  let cssH = 0;

  /** Make the canvas square at the screen's pixel density. */
  const fit = () => {
    const key = `${canvas.clientWidth}@${devicePixelRatio}`;
    if (key === sizeKey) return;
    sizeKey = key;
    cssW = canvas.clientWidth || 160;
    cssH = cssW;
    canvas.width = Math.round(cssW * devicePixelRatio);
    canvas.height = Math.round(cssH * devicePixelRatio);
  };

  return {
    update(snap, now) {
      if (!ctx) return;
      fit();
      const { world } = snap;
      // Scope radius in world units; the circle is centred on the map.
      const range = world.width / 2 + RADAR_MARGIN;
      const scale = cssW / 2 / range;
      const mapCx = world.width / 2;
      const mapCy = world.height / 2;
      // Sim → canvas CSS pixels.
      const px = (x: number) => cssW / 2 + (x - mapCx) * scale;
      const py = (y: number) => cssH / 2 + (y - mapCy) * scale;

      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cssW / 2, cssH / 2, cssW / 2 - 0.5, 0, Math.PI * 2);
      ctx.clip();

      // Range rings and crosshair round the map centre.
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(74, 222, 128, 0.18)";
      const cx = cssW / 2;
      const cy = cssH / 2;
      for (let r = range / 3; r < range; r += range / 3) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * scale, r * scale, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, cssH);
      ctx.moveTo(0, cy);
      ctx.lineTo(cssW, cy);
      ctx.stroke();

      // Sweep: a fading wedge behind a bright leading line.
      const angle = ((now / 1000 / SWEEP_SECONDS) % 1) * Math.PI * 2;
      const reach = Math.hypot(cssW, cssH);
      ctx.save();
      const wedge = ctx.createConicGradient(angle - SWEEP_TAIL, cx, cy);
      wedge.addColorStop(0, "rgba(74, 222, 128, 0)");
      wedge.addColorStop(SWEEP_TAIL / (Math.PI * 2), "rgba(74, 222, 128, 0.22)");
      wedge.addColorStop(SWEEP_TAIL / (Math.PI * 2) + 0.0001, "rgba(74, 222, 128, 0)");
      ctx.fillStyle = wedge;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.strokeStyle = "rgba(74, 222, 128, 0.7)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
      ctx.stroke();
      ctx.restore();

      // Runways, as short strips in their colour.
      ctx.lineCap = "round";
      ctx.lineWidth = 2.5;
      for (const rw of snap.runways) {
        const d = headingVector(rw.heading);
        const h = rw.length / 2;
        ctx.strokeStyle = COLOR_HEX[rw.color];
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(px(rw.center.x - d.x * h), py(rw.center.y - d.y * h));
        ctx.lineTo(px(rw.center.x + d.x * h), py(rw.center.y + d.y * h));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";

      // Planes. One beyond the scope's edge is pinned to it and drawn hollow.
      const pulse = 0.5 + 0.5 * Math.sin(now / 150);
      for (const p of snap.planes) {
        if (HIDDEN.has(p.phase)) continue;
        let x = px(p.pos.x);
        let y = py(p.pos.y);
        const rim = cssW / 2 - BLIP_RADIUS - 1;
        const off = Math.hypot(x - cssW / 2, y - cssH / 2);
        const pinned = off > rim;
        if (pinned) {
          x = cssW / 2 + ((x - cssW / 2) * rim) / off;
          y = cssH / 2 + ((y - cssH / 2) * rim) / off;
        }
        const d = headingVector(p.heading);
        ctx.strokeStyle = COLOR_HEX[p.color];
        ctx.fillStyle = COLOR_HEX[p.color];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + d.x * (BLIP_RADIUS + BLIP_TICK), y + d.y * (BLIP_RADIUS + BLIP_TICK));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, BLIP_RADIUS, 0, Math.PI * 2);
        if (pinned) ctx.stroke();
        else ctx.fill();
        if (p.warning) {
          ctx.strokeStyle = `rgba(255, 48, 72, ${0.4 + 0.6 * pulse})`;
          ctx.beginPath();
          ctx.arc(x, y, BLIP_RADIUS + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
      // Bezel.
      ctx.strokeStyle = "rgba(74, 222, 128, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cssW / 2, cssH / 2, cssW / 2 - 0.5, 0, Math.PI * 2);
      ctx.stroke();
    },
  };
}
