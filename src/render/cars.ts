/**
 * Cars: the little low-poly car model (shared by the car parks and the road
 * traffic) and `CarFleet`, which draws core/cars.ts traffic.
 *
 * The fleet is one thin-instanced mesh (parked cars included), plus
 * head/tail lamps and road beams at night (render/nightLights.ts): each
 * frame writes every car's matrix and colour and sets the instance count,
 * so all the traffic costs a single draw call (three more after dark).
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { Scene } from "@babylonjs/core/scene";
import { carPose, type CarTraffic } from "../core/cars";
import type { Bridge } from "../core/countryside";
import { horizonFade, type Bounds } from "../core/scenery";
import type { WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { roadSurfaceHeight } from "./bridges";
import { SceneGlow } from "./glow";
import { createPoolMesh, lampMaterial, poolMaterial, setNightLevel } from "./nightLights";

/** Car paint colours: mostly everyday greys and whites, a few brights. */
export const CAR_COLORS = [
  "#e5e7eb",
  "#1f2937",
  "#9ca3af",
  "#b91c1c",
  "#1d4ed8",
  "#f5f5f4",
  "#475569",
  "#15803d",
];

/**
 * A small low-poly car (body plus cabin), nose along +x, wheels at y = 0.
 * Colour it with a per-instance "color" buffer and a white `material`.
 */
export function createCarMesh(name: string, material: StandardMaterial, scene: Scene): Mesh {
  const body = CreateBox("carBody", { width: 1.0, height: 0.3, depth: 0.5 }, scene);
  body.bakeTransformIntoVertices(Matrix.Translation(0, 0.22, 0));
  const cabin = CreateBox("carCabin", { width: 0.55, height: 0.24, depth: 0.44 }, scene);
  cabin.bakeTransformIntoVertices(Matrix.Translation(-0.05, 0.49, 0));
  const car = Mesh.MergeMeshes([body, cabin], true);
  if (!car) throw new Error("Failed to build car model");
  car.name = name;
  car.material = material;
  car.receiveShadows = true;
  car.isPickable = false;
  return car;
}

/** Headlight / tail-light colours and the beam a car throws on the road. */
const HEADLIGHT = "#fff4d6";
const TAILLIGHT = "#ff3030";
const BEAM = "#ffe9b0";
/** Beam pool: how far ahead of the car's centre, its size, its brightness. */
const BEAM_AHEAD = 1.3;
const BEAM_LENGTH = 1.1;
const BEAM_WIDTH = 0.45;
const BEAM_STRENGTH = 0.55;

/** A pair of small lamps at `x` along the car (front +0.51, back −0.51). */
function lampPair(name: string, x: number, scene: Scene): Mesh {
  const lamps = [-1, 1].map((side) => {
    const lamp = CreateBox(`${name}-${side}`, { width: 0.04, height: 0.08, depth: 0.12 }, scene);
    lamp.bakeTransformIntoVertices(Matrix.Translation(x, 0.26, side * 0.15));
    return lamp;
  });
  const pair = Mesh.MergeMeshes(lamps, true);
  if (!pair) throw new Error("Failed to build car lamps");
  pair.name = name;
  pair.isPickable = false;
  return pair;
}

/** Scale-0 matrix: an instance that draws nothing (a parked car's lights). */
const HIDDEN = Matrix.Scaling(0, 0, 0);

/** Road traffic, drawn as thin instances of one car mesh. */
export class CarFleet {
  private readonly mesh: Mesh;
  private capacity = 0;
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private readonly palette = CAR_COLORS.map((hex) => Color3.FromHexString(hex));
  private readonly m = new Matrix();
  private readonly rot = new Quaternion();
  private readonly scale = new Vector3();
  private readonly pos = new Vector3();
  /** Night lights: headlights, tail lights, beams on the road (hidden by day). */
  private readonly head: Mesh;
  private readonly tail: Mesh;
  private readonly beam: Mesh;
  private readonly headMat: StandardMaterial;
  private readonly tailMat: StandardMaterial;
  private readonly beamMat: StandardMaterial;
  private lightMatrices = new Float32Array(0);
  private beamMatrices = new Float32Array(0);
  private night = 0;

  constructor(scene: Scene, shadows: ShadowGenerator | null) {
    const paint = new StandardMaterial("trafficCar", scene);
    paint.diffuseColor = Color3.White();
    paint.specularColor = new Color3(0.2, 0.2, 0.2);
    this.mesh = createCarMesh("traffic", paint, scene);
    this.headMat = lampMaterial("carHeadlights", HEADLIGHT, scene);
    this.tailMat = lampMaterial("carTaillights", TAILLIGHT, scene);
    this.beamMat = poolMaterial("carBeams", BEAM, scene);
    this.head = lampPair("carHead", 0.51, scene);
    this.head.material = this.headMat;
    this.tail = lampPair("carTail", -0.51, scene);
    this.tail.material = this.tailMat;
    this.beam = createPoolMesh("carBeam", scene);
    this.beam.material = this.beamMat;
    for (const mesh of [this.head, this.tail, this.beam]) {
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isVisible = false;
    }
    const glow = SceneGlow.for(scene);
    glow.add(this.head, true);
    glow.add(this.tail, true);
    this.ensureCapacity(48);
    this.mesh.thinInstanceCount = 0;
    this.head.thinInstanceCount = this.tail.thinInstanceCount = this.beam.thinInstanceCount = 0;
    // Disabled while there are no cars: see `sync`.
    for (const mesh of [this.mesh, this.head, this.tail, this.beam]) mesh.setEnabled(false);
    // Cars drive all over the map: never cull them against a stale box.
    this.mesh.alwaysSelectAsActiveMesh = true;
    shadows?.addShadowCaster(this.mesh, false);
  }

  /** Grow the instance buffers to hold at least `n` cars. */
  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    this.capacity = Math.max(n, this.capacity * 2);
    this.matrices = new Float32Array(this.capacity * 16);
    this.colors = new Float32Array(this.capacity * 4);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    this.lightMatrices = new Float32Array(this.capacity * 16);
    this.beamMatrices = new Float32Array(this.capacity * 16);
    // Head and tail lamps share one set of poses (the car's own, or hidden).
    this.head.thinInstanceSetBuffer("matrix", this.lightMatrices, 16, false);
    this.tail.thinInstanceSetBuffer("matrix", this.lightMatrices, 16, false);
    this.beam.thinInstanceSetBuffer("matrix", this.beamMatrices, 16, false);
  }

  /**
   * Write every car's pose into the instance buffers. Cars sit on the road
   * surface (up the bridge ramps, tilting with them) and shrink away as they
   * drive into the horizon haze (`bounds` is the scenery map).
   */
  sync(traffic: CarTraffic, bridges: readonly Bridge[], world: WorldSize, bounds: Bounds): void {
    const cars = traffic.cars;
    this.ensureCapacity(cars.length);
    cars.forEach((car, i) => {
      const pose = carPose(traffic, car);
      const size = 1 - horizonFade(pose.pos, bounds);
      this.scale.setAll(size);
      // Height under the car, and its slope along the heading (for the tilt).
      const y = roadSurfaceHeight(pose.pos, bridges);
      const hx = Math.cos(pose.heading) * 0.5;
      const hy = Math.sin(pose.heading) * 0.5;
      const front = roadSurfaceHeight({ x: pose.pos.x + hx, y: pose.pos.y + hy }, bridges);
      const back = roadSurfaceHeight({ x: pose.pos.x - hx, y: pose.pos.y - hy }, bridges);
      const tilt = Math.atan2(front - back, 1);
      Quaternion.RotationYawPitchRollToRef(headingToRotationY(pose.heading), 0, tilt, this.rot);
      toScene(pose.pos, world, y, this.pos);
      Matrix.ComposeToRef(this.scale, this.rot, this.pos, this.m);
      this.m.copyToArray(this.matrices, i * 16);
      const c = this.palette[car.id % this.palette.length]!;
      this.colors.set([c.r, c.g, c.b, 1], i * 4);
      // After dark: lamps on the car's pose (off while parked), and a beam
      // on the road ahead, following the ramps like the car does.
      if (this.night > 0) {
        if (car.parked) {
          HIDDEN.copyToArray(this.lightMatrices, i * 16);
          HIDDEN.copyToArray(this.beamMatrices, i * 16);
        } else {
          this.m.copyToArray(this.lightMatrices, i * 16);
          const ahead = {
            x: pose.pos.x + Math.cos(pose.heading) * BEAM_AHEAD,
            y: pose.pos.y + Math.sin(pose.heading) * BEAM_AHEAD,
          };
          toScene(ahead, world, roadSurfaceHeight(ahead, bridges) + 0.012, this.pos);
          this.scale.set(BEAM_LENGTH * size, 1, BEAM_WIDTH * size);
          Matrix.ComposeToRef(this.scale, this.rot, this.pos, this.m);
          this.m.copyToArray(this.beamMatrices, i * 16);
        }
      }
    });
    this.mesh.thinInstanceCount = cars.length;
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.thinInstanceBufferUpdated("color");
    if (this.night > 0) {
      for (const mesh of [this.head, this.tail, this.beam]) {
        mesh.thinInstanceCount = cars.length;
        mesh.thinInstanceBufferUpdated("matrix");
      }
    }
    // With no instances Babylon draws a mesh itself, once, at its own
    // transform: a lone car (and its lights) at the map's centre.
    for (const mesh of [this.mesh, this.head, this.tail, this.beam]) {
      mesh.setEnabled(cars.length > 0);
    }
  }

  /** 0 day … 1 night: lights and beams fade in (poses written by `sync`). */
  setNight(n: number): void {
    this.night = n;
    setNightLevel(this.headMat, n);
    setNightLevel(this.tailMat, n);
    setNightLevel(this.beamMat, n * BEAM_STRENGTH);
  }

  dispose(): void {
    this.mesh.dispose();
    this.head.dispose();
    this.tail.dispose();
    this.beam.dispose();
  }
}
