/**
 * Keep the screen awake while a shift is running.
 *
 * A game is played with a finger or a mouse on a map that moves by itself, so
 * for long stretches nothing "touches" the device, and a phone dims and locks
 * its screen in the middle of a shift. The Screen Wake Lock API holds the
 * screen on for as long as it's wanted.
 *
 * Best effort, and silent when it can't help: browsers without the API
 * (older Safari and Firefox), a page that isn't visible, or a device in
 * battery saver all refuse, and the game plays on as before. The browser
 * drops the lock whenever the tab is hidden, so it is taken again when the
 * tab comes back.
 */
export interface ScreenWake {
  /**
   * Say whether the screen should stay on now. Cheap to call every frame: it
   * only does anything when the answer changes (or the lock was lost).
   */
  sync(wanted: boolean): void;
}

/** @param nav / doc injectable for tests. */
export function createScreenWake(nav: Navigator = navigator, doc: Document = document): ScreenWake {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  /** A request is in flight. */
  let pending = false;
  /** The browser refused: stop asking until the wish changes or the tab returns. */
  let refused = false;

  const acquire = async () => {
    if (!nav.wakeLock || sentinel || pending || refused) return;
    pending = true;
    try {
      const lock = await nav.wakeLock.request("screen");
      // The shift ended while the request was out: let go straight away.
      if (!wanted) {
        await lock.release();
        return;
      }
      sentinel = lock;
      lock.addEventListener("release", () => {
        if (sentinel === lock) sentinel = null;
      });
    } catch {
      refused = true;
    } finally {
      pending = false;
    }
  };

  const release = () => {
    const lock = sentinel;
    sentinel = null;
    void lock?.release().catch(() => {});
  };

  // The browser releases the lock when the tab is hidden: take it again on return.
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState !== "visible") return;
    refused = false;
    if (wanted) void acquire();
  });

  return {
    sync(next) {
      if (next === wanted) {
        // Wanted but lost (released by the browser, not refused): ask again.
        if (wanted && !sentinel) void acquire();
        return;
      }
      wanted = next;
      refused = false;
      if (wanted) void acquire();
      else release();
    },
  };
}
