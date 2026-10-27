/**
 * Interface customisation: the settings card (panel switches, radar size,
 * opacity) and the layout mode in which the panels are dragged to new
 * places. Applies the saved choices (ui/settings.ts) to the HUD through CSS:
 * an offset is the `translate` of a `[data-move]` element, the radar size
 * and opacity are the variables `--radar-size` and `--hud-opacity` on the
 * HUD root (style.css reads them).
 *
 * DOM only. The game pauses while either the card or layout mode is up
 * (`onActiveChange`, wired in main.ts like the help panel).
 */
import { PANEL_IDS, type PanelId } from "./panels";
import {
  DEFAULT_SETTINGS,
  MIN_OPACITY,
  MOVE_IDS,
  RADAR_SIZE_REM,
  loadSettings,
  saveSettings,
  type MoveId,
  type RadarSize,
  type UiSettings,
} from "./settings";

export interface Customiser {
  /** Card or layout mode showing? */
  readonly active: boolean;
  /** Open the card (true) or close everything, card and layout mode (false). */
  setOpen(open: boolean): void;
  /** Refresh the panel switches after a panel was toggled by its key. */
  syncPanels(): void;
}

export interface CustomiserOptions {
  panelOn(id: PanelId): boolean;
  setPanelOn(id: PanelId, on: boolean): void;
  onActiveChange(active: boolean): void;
}

/** Panels that get a switch in the card (the stats panel has its own opt-in key). */
const SWITCHABLE = PANEL_IDS.filter((id) => id !== "stats");

export function createCustomiser(root: HTMLElement, options: CustomiserOptions): Customiser {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const card = q("#settingsPanel");
  const closeBtn = q("#settingsCloseBtn");
  const gearBtn = q("#settingsBtn");
  const opacityInput = q<HTMLInputElement>("#settingsOpacity");
  const banner = q("#layoutBanner");
  const switches = new Map<PanelId, HTMLInputElement>();
  for (const id of SWITCHABLE) {
    switches.set(id, q<HTMLInputElement>(`input[data-panel-switch="${id}"]`));
  }
  const sizeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-radar-size]"));

  const settings: UiSettings = loadSettings();
  let cardOpen = false;
  let editing = false;

  const movable = (id: MoveId) => root.querySelector<HTMLElement>(`[data-move="${id}"]`);

  /** Place `el` at its saved offset, nudged back on screen if the window shrank. */
  const place = (id: MoveId) => {
    const el = movable(id);
    if (!el) return;
    const o = settings.offsets[id] ?? { x: 0, y: 0 };
    el.style.translate = `${o.x}px ${o.y}px`;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return; // hidden right now
    const dx = r.left < 0 ? -r.left : Math.min(0, innerWidth - r.right);
    const dy = r.top < 0 ? -r.top : Math.min(0, innerHeight - r.bottom);
    if (dx || dy) el.style.translate = `${o.x + dx}px ${o.y + dy}px`;
  };
  const placeAll = () => MOVE_IDS.forEach(place);

  const applyLook = () => {
    root.style.setProperty("--radar-size", RADAR_SIZE_REM[settings.radarSize]);
    root.style.setProperty("--hud-opacity", String(settings.opacity));
    for (const b of sizeButtons) {
      b.setAttribute("aria-pressed", String(b.dataset.radarSize === settings.radarSize));
    }
    opacityInput.value = String(Math.round(settings.opacity * 100));
    // The radar's box changed: put it (and its neighbours) back in bounds.
    requestAnimationFrame(placeAll);
  };

  const syncPanels = () => {
    for (const [id, input] of switches) input.checked = options.panelOn(id);
  };

  const update = () => {
    const active = cardOpen || editing;
    card.classList.toggle("hidden", !cardOpen);
    card.classList.toggle("flex", cardOpen);
    banner.classList.toggle("hidden", !editing);
    banner.classList.toggle("flex", editing);
    root.classList.toggle("layout-edit", editing);
    gearBtn.setAttribute("aria-expanded", String(cardOpen));
    if (cardOpen) closeBtn.focus();
    else gearBtn.blur();
    if (!editing) placeAll();
    options.onActiveChange(active);
  };
  const setOpen = (open: boolean) => {
    if (open === cardOpen && (open || !editing)) return;
    cardOpen = open;
    if (!open) editing = false;
    if (open) syncPanels();
    update();
  };

  // --- card controls -----------------------------------------------------
  gearBtn.addEventListener("click", () => setOpen(!cardOpen && !editing));
  closeBtn.addEventListener("click", () => setOpen(false));
  card.addEventListener("click", (e) => {
    if (e.target === card) setOpen(false);
  });
  for (const [id, input] of switches) {
    input.addEventListener("change", () => options.setPanelOn(id, input.checked));
  }
  for (const b of sizeButtons) {
    b.addEventListener("click", () => {
      settings.radarSize = b.dataset.radarSize as RadarSize;
      saveSettings(settings);
      applyLook();
    });
  }
  opacityInput.addEventListener("input", () => {
    settings.opacity = Math.max(MIN_OPACITY, Number(opacityInput.value) / 100);
    saveSettings(settings);
    applyLook();
  });
  const reset = () => {
    settings.offsets = {};
    settings.radarSize = DEFAULT_SETTINGS.radarSize;
    settings.opacity = DEFAULT_SETTINGS.opacity;
    saveSettings(settings);
    applyLook();
    placeAll();
  };
  q("#layoutResetBtn").addEventListener("click", reset);
  q("#layoutResetBtn2").addEventListener("click", reset);
  q("#layoutBtn").addEventListener("click", () => {
    cardOpen = false;
    editing = true;
    update();
  });
  q("#layoutDoneBtn").addEventListener("click", () => setOpen(false));

  // --- dragging ------------------------------------------------------------
  let drag: { id: MoveId; el: HTMLElement; sx: number; sy: number; ox: number; oy: number } | null =
    null;
  root.addEventListener("pointerdown", (e) => {
    if (!editing) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-move]");
    if (!el) return;
    const id = el.dataset.move as MoveId;
    const o = settings.offsets[id] ?? { x: 0, y: 0 };
    drag = { id, el, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    // Clamp by the room the panel has left, measured at its home offset.
    const from = settings.offsets[drag.id] ?? { x: 0, y: 0 };
    const r = drag.el.getBoundingClientRect();
    let x = drag.ox + e.clientX - drag.sx;
    let y = drag.oy + e.clientY - drag.sy;
    const left = r.left - from.x + x;
    const top = r.top - from.y + y;
    x += Math.max(0, -left) + Math.min(0, innerWidth - (left + r.width));
    y += Math.max(0, -top) + Math.min(0, innerHeight - (top + r.height));
    settings.offsets[drag.id] = { x, y };
    drag.el.style.translate = `${x}px ${y}px`;
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    saveSettings(settings);
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  addEventListener("resize", placeAll);
  applyLook();
  syncPanels();

  return {
    get active() {
      return cardOpen || editing;
    },
    setOpen,
    syncPanels,
  };
}
