/**
 * Full screen mode: the whole page (canvas and HUD together), via the
 * browser's Fullscreen API.
 *
 * DOM-only, no Babylon: the renderer needs no help, because entering or
 * leaving full screen resizes the window and main.ts already refits the
 * engine and camera on every `resize`.
 *
 * Support is patchy, so every call is guarded:
 * - Safari before 16.4 and iPad only have the `webkit`-prefixed API;
 * - iPhone Safari has none for ordinary pages (`supported` is false and the
 *   button hides itself);
 * - a page inside an `<iframe>` without `allowfullscreen`, or a browser
 *   policy, can refuse: `toggle()` resolves to false rather than throwing.
 * The browser also demands a user gesture (a click or key press), which is
 * what calls `toggle()` here. The user can always leave with Esc (the
 * browser handles that key itself, it never reaches the game), so the state
 * is read back from `fullscreenchange`, never assumed.
 */

/** The prefixed members older WebKit adds (not in lib.dom). */
type PrefixedDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type PrefixedElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export interface Fullscreen {
  /** Can this browser put the page in full screen at all? */
  readonly supported: boolean;
  /** Is the page in full screen right now? */
  readonly active: boolean;
  /**
   * Enter full screen, or leave it. Resolves to false when the browser
   * refused (or full screen isn't supported); never rejects.
   */
  toggle(): Promise<boolean>;
  /** Call `listener` whenever full screen starts or ends, however it happened (Esc included). */
  onChange(listener: (active: boolean) => void): () => void;
}

/**
 * @param doc  the document (injectable for tests and Storybook).
 * @param root the element taken full screen: the whole page by default, so the
 *             HUD stays on top of the canvas.
 */
export function createFullscreen(
  doc: Document = document,
  root: HTMLElement = doc.documentElement,
): Fullscreen {
  const d = doc as PrefixedDocument;
  const el = root as PrefixedElement;

  const isActive = () => Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);

  return {
    get supported() {
      return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
    },
    get active() {
      return isActive();
    },
    async toggle() {
      if (!this.supported) return false;
      try {
        if (isActive()) {
          await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
        } else {
          // `navigationUI: "hide"` keeps the "press Esc to exit" hint short.
          await (el.requestFullscreen?.({ navigationUI: "hide" }) ??
            el.webkitRequestFullscreen?.());
        }
        return true;
      } catch {
        return false;
      }
    },
    onChange(listener) {
      const handler = () => listener(isActive());
      doc.addEventListener("fullscreenchange", handler);
      doc.addEventListener("webkitfullscreenchange", handler);
      return () => {
        doc.removeEventListener("fullscreenchange", handler);
        doc.removeEventListener("webkitfullscreenchange", handler);
      };
    },
  };
}
