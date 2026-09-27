/**
 * Crash effects: what the scene shows once two planes collide.
 *
 *   - fireball: a bright flash sphere plus a burst of fire and dark smoke
 *     at the point of impact, up at flight altitude;
 *   - wrecks:   both planes tumble out of the sky, trailing fire and smoke,
 *               hit the ground and slide to rest on their belly (or back);
 *   - debris:   small painted fragments flung out ballistically, bouncing
 *               once or twice before they settle;
 *   - on the ground, each wreck leaves a scorch mark, a second fire burst,
 *     and keeps burning with a thick smoke column drifting downwind.
 *
 * Everything here is render-only: the sim just stops (phase "gameover") and
 * leaves both planes in state. `SceneSync.crash` hands the planes' meshes to
 * a `CrashEffect` and stops driving them; the effect is disposed along with
 * the planes when the next shift starts.
 *
 * Particle systems run on Babylon's own frame clock (`updateSpeed` is set so
 * lifetimes, speeds and gravity are all per second); the wreck and debris
 * physics step on the `dt` passed to `update`.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent"; // side effect: particle rendering
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX } from "../config";
import { lerp, mulberry32 } from "../core/math";
import type { PlaneColor, Rng } from "../core/types";
import type { AircraftRig } from "./aircraft";
import { OVERLAY_GROUP } from "./scene";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Downward acceleration on falling wrecks (scene units / s²). */
export const WRECK_GRAVITY = 14;
/** Speed a wreck keeps along its old heading as it starts to fall. */
const WRECK_FORWARD_SPEED = 4;
/** Extra speed pushing the two wrecks apart (they just bounced off each other). */
const WRECK_SEPARATION_SPEED = 2.5;
/** Small upward kick from the impact, so the fall starts with a hop. */
const WRECK_HOP_SPEED = 1.5;
/** Height a wreck comes to rest at (roughly its belly on the grass). */
const WRECK_REST_ALTITUDE = 0.35;
/** How fast a wreck's slide along the ground dies away (1 / seconds). */
const WRECK_FRICTION = 3.5;
/** Seconds for a landed wreck to settle from mid-tumble into its rest pose. */
const WRECK_SETTLE_TIME = 0.35;

/** Fragments thrown out by the collision. */
export const DEBRIS_COUNT = 18;
const DEBRIS_GRAVITY = 24;
/** Fraction of vertical speed kept on each bounce; below 1.2 u/s it stops. */
const DEBRIS_BOUNCE = 0.35;

/** Seconds the flash sphere takes to swell and fade. */
const FLASH_TIME = 0.45;
/** Final diameter of the flash sphere (scene units). */
const FLASH_SIZE = 7;

/** Radius of the scorch mark left under each wreck. */
const SCORCH_RADIUS = 2.6;
/** Seconds for a scorch mark to darken in after the impact. */
const SCORCH_FADE_IN = 0.6;

/**
 * Steady wind pushing the smoke (scene units / s², applied as particle
 * gravity, so older smoke has drifted further). Mostly sideways, a little
 * up: columns lean over rather than rising straight.
 */
export const SMOKE_DRIFT = new Vector3(1.2, 0.5, 0.7);

// ---------------------------------------------------------------------------

/** One plane caught in the crash. */
export interface WreckSource {
  rig: AircraftRig;
  color: PlaneColor;
}

interface Wreck {
  rig: AircraftRig;
  vel: Vector3;
  /** Tumble rates (rad/s) about the nose (x), vertical (y) and wing (z) axes. */
  spin: Vector3;
  /** Seconds since touching down, or null while still falling. */
  groundAge: number | null;
  /** Pose the wreck settles into after touchdown (rotation x / z). */
  restRoll: number;
  restPitch: number;
  /** Rotation at touchdown, eased from towards the rest pose. */
  landedRoll: number;
  landedPitch: number;
  /** Where the fire and smoke come from: follows the wreck, no rotation. */
  emitter: Vector3;
  fire: ParticleSystem;
  smoke: ParticleSystem;
  scorch: Mesh | null;
}

interface Debris {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  /** Half the fragment's height: how far above the ground it rests. */
  rest: number;
  settled: boolean;
}

/** Random number in [lo, hi). */
function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export class CrashEffect {
  /** Scene position of the collision (up at flight altitude). */
  readonly site: Vector3;
  /**
   * Ground point (y = 0) under the middle of the wreckage, kept up to date
   * as the wrecks fall and slide: what the crash camera orbits.
   */
  readonly focus: Vector3;

  private readonly rng: Rng;
  private readonly puff: DynamicTexture;
  private readonly wrecks: Wreck[] = [];
  private readonly debris: Debris[] = [];
  /** One-shot particle bursts (fireball, impacts); kept for disposal. */
  private readonly bursts: ParticleSystem[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly flash: Mesh;
  private age = 0;

  /**
   * @param sources the colliding planes. Their meshes must already be frozen
   *                where they were drawn at the moment of the crash: from
   *                now on this effect moves them.
   * @param seed    fixes the debris/tumble randomness (same crash, same show).
   */
  constructor(
    private readonly scene: Scene,
    sources: readonly WreckSource[],
    seed: number,
    private readonly shadows?: ShadowGenerator,
  ) {
    this.rng = mulberry32(seed);
    this.puff = makePuffTexture(scene);

    // The crash site is the midpoint of the two planes as drawn.
    this.site = Vector3.Zero();
    for (const s of sources) this.site.addInPlace(s.rig.root.position);
    this.site.scaleInPlace(1 / Math.max(1, sources.length));
    this.focus = new Vector3(this.site.x, 0, this.site.z);

    this.flash = this.makeFlash();
    this.fireBurst(this.site, 90, 1);
    this.smokeBurst(this.site, 30);
    for (const s of sources) this.wrecks.push(this.makeWreck(s));
    const colors = sources.map((s) => COLOR_HEX[s.color]);
    this.makeDebris([...colors, ...colors, "#f1f5f9", "#475569", "#1f2937"]);
  }

  /** Advance wrecks, debris, flash and scorch marks by `dt` seconds. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.age += dt;

    // Flash: swells fast, fades with an ease-out.
    const f = Math.min(1, this.age / FLASH_TIME);
    this.flash.setEnabled(f < 1);
    this.flash.scaling.setAll(lerp(1, FLASH_SIZE, 1 - (1 - f) * (1 - f)));
    this.flash.visibility = (1 - f) * (1 - f);

    for (const w of this.wrecks) this.updateWreck(w, dt);
    if (this.wrecks.length > 0) {
      this.focus.setAll(0);
      for (const w of this.wrecks) this.focus.addInPlace(w.rig.root.position);
      this.focus.scaleInPlace(1 / this.wrecks.length);
      this.focus.y = 0;
    }
    for (const d of this.debris) if (!d.settled) this.updateDebris(d, dt);
  }

  dispose(): void {
    for (const w of this.wrecks) {
      w.fire.dispose(false);
      w.smoke.dispose(false);
      w.scorch?.dispose();
    }
    for (const b of this.bursts) b.dispose(false);
    for (const d of this.debris) {
      this.shadows?.removeShadowCaster(d.mesh, false);
      d.mesh.dispose();
    }
    for (const m of this.materials) m.dispose();
    this.flash.dispose();
    this.puff.dispose();
  }

  // --- Wrecks ----------------------------------------------------------------

  private makeWreck(source: WreckSource): Wreck {
    const { rig } = source;
    const root = rig.root;
    // Moving parts stop: no spinning props or flashing lights on a wreck.
    for (const m of [...rig.props, ...rig.strobes, ...rig.beacons]) m.setEnabled(false);

    // Carry on along the old heading (nose is +x, rotated by rotation.y:
    // see coords.ts), pushed away from the other plane, with a small hop.
    const yaw = root.rotation.y;
    const vel = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).scaleInPlace(WRECK_FORWARD_SPEED);
    const away = root.position.subtract(this.site);
    away.y = 0;
    if (away.lengthSquared() > 1e-6)
      vel.addInPlace(away.normalize().scaleInPlace(WRECK_SEPARATION_SPEED));
    vel.y = WRECK_HOP_SPEED;

    // Roll hard one way or the other; the nose drops (negative z rotation
    // pitches the +x nose down).
    const side = this.rng() < 0.5 ? -1 : 1;
    const spin = new Vector3(side * range(this.rng, 3, 5), range(this.rng, -0.8, 0.8), -1.4);

    const emitter = root.position.clone();
    return {
      rig,
      vel,
      spin,
      groundAge: null,
      restRoll: 0,
      restPitch: 0,
      landedRoll: 0,
      landedPitch: 0,
      emitter,
      fire: this.makeFire(emitter),
      smoke: this.makeSmoke(emitter),
      scorch: null,
    };
  }

  private updateWreck(w: Wreck, dt: number): void {
    const root = w.rig.root;
    if (w.groundAge === null) {
      // Falling: ballistic flight plus a tumble.
      w.vel.y -= WRECK_GRAVITY * dt;
      root.position.addInPlace(w.vel.scale(dt));
      root.rotation.addInPlace(w.spin.scale(dt));
      if (root.position.y <= WRECK_REST_ALTITUDE) this.touchDown(w);
    } else {
      // On the ground: slide to a stop and settle into the rest pose.
      w.groundAge += dt;
      w.vel.scaleInPlace(Math.exp(-WRECK_FRICTION * dt));
      root.position.x += w.vel.x * dt;
      root.position.z += w.vel.z * dt;
      const s = Math.min(1, w.groundAge / WRECK_SETTLE_TIME);
      const e = s * s * (3 - 2 * s);
      root.rotation.x = lerp(w.landedRoll, w.restRoll, e);
      root.rotation.z = lerp(w.landedPitch, w.restPitch, e);
      if (w.scorch) {
        w.scorch.position.x = root.position.x;
        w.scorch.position.z = root.position.z;
        w.scorch.visibility = Math.min(1, w.groundAge / SCORCH_FADE_IN);
      }
    }
    w.emitter.copyFrom(root.position);
  }

  private touchDown(w: Wreck): void {
    const root = w.rig.root;
    root.position.y = WRECK_REST_ALTITUDE;
    w.groundAge = 0;
    w.vel.y = 0;
    w.vel.scaleInPlace(0.6);
    // Settle onto whichever side is nearer (belly or back), leaning on a
    // wing, nose slightly dug in.
    w.landedRoll = root.rotation.x;
    w.landedPitch = root.rotation.z;
    const flat = Math.round(w.landedRoll / Math.PI) * Math.PI;
    w.restRoll = flat + Math.sign(w.spin.x) * 0.3;
    w.restPitch = -0.12;

    // Impact: a second fireball, then a bigger, steadier fire and smoke.
    const ground = new Vector3(root.position.x, 0.5, root.position.z);
    this.fireBurst(ground, 45, 0.7);
    this.smokeBurst(ground, 16);
    w.fire.emitRate = 150;
    w.smoke.emitRate = 34;
    w.scorch = this.makeScorch(root.position);
  }

  // --- Debris ----------------------------------------------------------------

  private makeDebris(hexes: readonly string[]): void {
    const mats = hexes.map((hex, i) => {
      const mat = new StandardMaterial(`debris-${i}`, this.scene);
      mat.diffuseColor = Color3.FromHexString(hex);
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      this.materials.push(mat);
      return mat;
    });
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const mesh = CreateBox(`debris-${i}`, { size: 1 }, this.scene);
      // Flat, irregular plates: torn skin panels rather than cubes.
      mesh.scaling.set(
        range(this.rng, 0.25, 0.6),
        range(this.rng, 0.06, 0.16),
        range(this.rng, 0.2, 0.45),
      );
      mesh.material = mats[i % mats.length]!;
      mesh.position.copyFrom(this.site);
      mesh.rotation.set(range(this.rng, 0, 6.3), range(this.rng, 0, 6.3), range(this.rng, 0, 6.3));
      mesh.renderingGroupId = OVERLAY_GROUP;
      mesh.isPickable = false;
      this.shadows?.addShadowCaster(mesh, false);

      const a = range(this.rng, 0, Math.PI * 2);
      const speed = range(this.rng, 4, 11);
      this.debris.push({
        mesh,
        vel: new Vector3(Math.cos(a) * speed, range(this.rng, 3, 10), Math.sin(a) * speed),
        spin: new Vector3(range(this.rng, -9, 9), range(this.rng, -9, 9), range(this.rng, -9, 9)),
        rest: mesh.scaling.y / 2,
        settled: false,
      });
    }
  }

  private updateDebris(d: Debris, dt: number): void {
    d.vel.y -= DEBRIS_GRAVITY * dt;
    d.mesh.position.addInPlace(d.vel.scale(dt));
    d.mesh.rotation.addInPlace(d.spin.scale(dt));
    if (d.mesh.position.y > d.rest) return;
    // Bounce: lose most of the speed, and settle once it's barely moving.
    d.mesh.position.y = d.rest;
    d.vel.set(d.vel.x * 0.55, -d.vel.y * DEBRIS_BOUNCE, d.vel.z * 0.55);
    d.spin.scaleInPlace(0.5);
    if (d.vel.y < 1.2) {
      d.settled = true;
      // Lie flat on the ground, keeping only the random heading.
      d.mesh.rotation.x = 0;
      d.mesh.rotation.z = 0;
    }
  }

  // --- Flash and scorch ------------------------------------------------------

  private makeFlash(): Mesh {
    const flash = CreateSphere("crash-flash", { diameter: 1, segments: 12 }, this.scene);
    const mat = new StandardMaterial("crash-flash", this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(1, 0.78, 0.4);
    this.materials.push(mat);
    flash.material = mat;
    flash.position.copyFrom(this.site);
    flash.renderingGroupId = OVERLAY_GROUP;
    flash.isPickable = false;
    return flash;
  }

  private makeScorch(at: Vector3): Mesh {
    const disc = CreateDisc(
      "crash-scorch",
      { radius: SCORCH_RADIUS, tessellation: 24 },
      this.scene,
    );
    const mat = new StandardMaterial("crash-scorch", this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0.07, 0.06, 0.05);
    mat.alpha = 0.7;
    // Pull towards the camera in the depth test, so it wins over runway paint.
    mat.zOffset = -2;
    this.materials.push(mat);
    disc.material = mat;
    // Discs are built in the XY plane, facing -z: lay it flat, facing up.
    disc.rotation.x = Math.PI / 2;
    disc.position.set(at.x, 0.12, at.z);
    disc.visibility = 0;
    disc.isPickable = false;
    return disc;
  }

  // --- Particles -------------------------------------------------------------

  /** Common set-up: soft puff texture, per-second timing, drawn over the scenery. */
  private particles(name: string, capacity: number, emitter: Vector3): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = this.puff;
    ps.emitter = emitter;
    // Particle age advances by updateSpeed × (frame time / 16.7 ms): 1/60
    // makes lifetimes, emit power and gravity all per second.
    ps.updateSpeed = 1 / 60;
    ps.renderingGroupId = OVERLAY_GROUP;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    return ps;
  }

  /** Flames licking up from a wreck; follows `emitter`. */
  private makeFire(emitter: Vector3): ParticleSystem {
    const ps = this.particles("crash-fire", 300, emitter);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitRate = 70;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.6;
    ps.minEmitBox = new Vector3(-0.6, -0.2, -0.6);
    ps.maxEmitBox = new Vector3(0.6, 0.3, 0.6);
    ps.direction1 = new Vector3(-0.6, 3, -0.6);
    ps.direction2 = new Vector3(0.6, 5, 0.6);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 1.2;
    ps.gravity = new Vector3(0, 2, 0);
    ps.addSizeGradient(0, 1.4, 2.2);
    ps.addSizeGradient(1, 0.5, 0.8);
    ps.addColorGradient(0, new Color4(1, 0.92, 0.55, 1));
    ps.addColorGradient(0.4, new Color4(1, 0.45, 0.1, 0.9));
    ps.addColorGradient(1, new Color4(0.45, 0.08, 0.03, 0));
    ps.start();
    return ps;
  }

  /** Black smoke rising from a wreck and drifting downwind; follows `emitter`. */
  private makeSmoke(emitter: Vector3): ParticleSystem {
    const ps = this.particles("crash-smoke", 400, emitter);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 18;
    ps.minLifeTime = 2.5;
    ps.maxLifeTime = 4.5;
    ps.minEmitBox = new Vector3(-0.5, 0, -0.5);
    ps.maxEmitBox = new Vector3(0.5, 0.5, 0.5);
    ps.direction1 = new Vector3(-0.4, 2.5, -0.4);
    ps.direction2 = new Vector3(0.4, 4, 0.4);
    ps.minEmitPower = 0.8;
    ps.maxEmitPower = 1.2;
    ps.gravity = SMOKE_DRIFT.clone();
    ps.minAngularSpeed = -0.5;
    ps.maxAngularSpeed = 0.5;
    ps.addSizeGradient(0, 1, 1.6);
    ps.addSizeGradient(1, 4.5, 6.5);
    ps.addColorGradient(0, new Color4(0.15, 0.14, 0.13, 0));
    ps.addColorGradient(0.08, new Color4(0.16, 0.15, 0.14, 0.8));
    ps.addColorGradient(0.6, new Color4(0.33, 0.33, 0.34, 0.45));
    ps.addColorGradient(1, new Color4(0.5, 0.5, 0.52, 0));
    ps.start();
    return ps;
  }

  /** One-shot ball of fire flying out from `at`; `scale` sizes the whole burst. */
  private fireBurst(at: Vector3, count: number, scale: number): void {
    const ps = this.particles("crash-fireball", count, at.clone());
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.manualEmitCount = count;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.9;
    ps.minEmitBox = new Vector3(-0.3, -0.3, -0.3);
    ps.maxEmitBox = new Vector3(0.3, 0.3, 0.3);
    ps.direction1 = new Vector3(-1, -0.3, -1);
    ps.direction2 = new Vector3(1, 1, 1);
    ps.minEmitPower = 5 * scale;
    ps.maxEmitPower = 11 * scale;
    ps.gravity = new Vector3(0, 3, 0);
    ps.addSizeGradient(0, 1.8 * scale, 3 * scale);
    ps.addSizeGradient(1, 0.5 * scale, 0.8 * scale);
    ps.addColorGradient(0, new Color4(1, 0.95, 0.7, 1));
    ps.addColorGradient(0.3, new Color4(1, 0.55, 0.15, 1));
    ps.addColorGradient(1, new Color4(0.4, 0.07, 0.02, 0));
    ps.start();
    this.bursts.push(ps);
  }

  /** One-shot puff of dark smoke billowing out from `at`. */
  private smokeBurst(at: Vector3, count: number): void {
    const ps = this.particles("crash-smokeball", count, at.clone());
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.manualEmitCount = count;
    ps.minLifeTime = 1.5;
    ps.maxLifeTime = 3;
    ps.direction1 = new Vector3(-1, 0, -1);
    ps.direction2 = new Vector3(1, 1.2, 1);
    ps.minEmitPower = 1.5;
    ps.maxEmitPower = 3.5;
    ps.gravity = SMOKE_DRIFT.clone();
    ps.minAngularSpeed = -0.6;
    ps.maxAngularSpeed = 0.6;
    ps.addSizeGradient(0, 2, 3);
    ps.addSizeGradient(1, 5, 7);
    ps.addColorGradient(0, new Color4(0.12, 0.11, 0.1, 0.85));
    ps.addColorGradient(1, new Color4(0.4, 0.4, 0.42, 0));
    ps.start();
    this.bursts.push(ps);
  }
}

/**
 * Soft round white puff (alpha falls off smoothly to the rim), tinted by the
 * particle colour gradients: one texture serves fire and smoke alike, and
 * nothing needs loading from disk.
 */
function makePuffTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture("crash-puff", { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}
