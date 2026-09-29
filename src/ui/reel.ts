/**
 * A rolling reel: a set of faces (numerals, or "00".."23" for a clock's
 * hours) spaced round a drum turned about the horizontal axis, like a
 * slot-machine reel or a car's odometer. `turnTo` rolls the drum to a face
 * and it settles with a small bounce (the transition's overshooting easing,
 * `.reel-drum` in style.css).
 *
 * Drums only ever roll forward (the next face comes up from below), so the
 * last face wraps round to the first (9 → 0, 23 → 00) the way a real one
 * does, rather than spinning back through every face.
 *
 * Used by the HUD's score (ui/scoreRoll.ts).
 */

/** Height of one face on the drum (em; matches `.reel` in style.css). */
const FACE_EM = 1.2;

export interface ReelOptions {
  /** Face labels in rolling order; the reel is as wide as the longest. */
  faces: readonly string[];
}

export interface Reel {
  /** The reel's element (not yet in the page). Decorative: `aria-hidden`. */
  readonly root: HTMLElement;
  /** Roll forward to face `index` (no-op when it's already showing). */
  turnTo(index: number): void;
}

/** A fresh reel showing its first face. */
export function createReel({ faces }: ReelOptions): Reel {
  const count = faces.length;
  const stepDeg = 360 / count;
  // The radius that puts the faces edge to edge: each spans `stepDeg` of
  // the circle, so half a face over the radius is tan(stepDeg / 2).
  const radiusEm = FACE_EM / 2 / Math.tan(Math.PI / count);
  // Pushed back by its radius first, so the face in front sits in the page
  // plane at its natural size.
  const drumTransform = (turns: number) =>
    `translateZ(${-radiusEm}em) rotateX(${turns * stepDeg}deg)`;

  const root = document.createElement("span");
  root.className = "reel";
  root.setAttribute("aria-hidden", "true");
  root.style.width = `${Math.max(...faces.map((f) => f.length))}ch`;
  const drum = document.createElement("span");
  drum.className = "reel-drum";
  drum.style.transform = drumTransform(0);
  faces.forEach((label, n) => {
    const face = document.createElement("span");
    face.className = "reel-face";
    face.textContent = label;
    // Face n sits n steps further round, below the one before it.
    face.style.transform = `rotateX(${-n * stepDeg}deg) translateZ(${radiusEm}em)`;
    drum.append(face);
  });
  root.append(drum);

  /** Face showing now. */
  let index = 0;
  /**
   * Steps turned so far. Grows without wrapping, so the transition always
   * runs forward from the angle before.
   */
  let turns = 0;

  return {
    root,
    turnTo(next) {
      const steps = (((next - index) % count) + count) % count;
      if (steps === 0) return;
      index = next;
      turns += steps;
      drum.style.transform = drumTransform(turns);
    },
  };
}

/**
 * Put `reel` into `parent` (before `before`, else at the end) and let the
 * browser lay it out at its first face, so a `turnTo` straight after
 * animates from there rather than jumping to the new face.
 */
export function mountReel(reel: Reel, parent: HTMLElement, before?: Node | null): void {
  parent.insertBefore(reel.root, before ?? null);
  void reel.root.offsetHeight;
}

/** The ten numerals, for a digit reel. */
export const DIGITS: readonly string[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
