import { GRID_COLS, GRID_GAP, MAX_ZOOM, MIN_ZOOM, PREVIEW_H, PREVIEW_W } from "../config";
import type { Events } from "../protocol";
import { actions, getState } from "../store";
import { getConnection } from "./previews";

// Camera math. world → screen: screen = world × z + (x, y).

export function previewPos(index: number) {
  return {
    x: (index % GRID_COLS) * (PREVIEW_W + GRID_GAP),
    y: Math.floor(index / GRID_COLS) * (PREVIEW_H + GRID_GAP),
  };
}

export function worldSize(count: number) {
  const cols = Math.min(count, GRID_COLS);
  const rows = Math.ceil(count / GRID_COLS);
  return { w: cols * PREVIEW_W + (cols - 1) * GRID_GAP, h: rows * PREVIEW_H + (rows - 1) * GRID_GAP };
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Hover clears whenever the board starts panning or zooming (R2.3). */
export function clearHoverEverywhere() {
  const h = getState().hover;
  if (!h) return;
  getConnection(h.sid)?.command("clearHover", {});
  actions.clearHover();
}

/** Zoom about a point in board coordinates: the world point under it stays put. */
export function zoomAt(px: number, py: number, factor: number) {
  const { x, y, z } = getState().camera;
  const z2 = clampZoom(z * factor);
  if (z2 === z) return;
  const wx = (px - x) / z;
  const wy = (py - y) / z;
  clearHoverEverywhere();
  actions.setCamera({ x: px - wx * z2, y: py - wy * z2, z: z2 });
}

export function panBy(dx: number, dy: number) {
  const c = getState().camera;
  clearHoverEverywhere();
  actions.setCamera({ ...c, x: c.x + dx, y: c.y + dy });
}

export function wheelPixels(delta: number, mode: number) {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta;
}

export function wheelZoomFactor(deltaY: number, mode: number) {
  const px = Math.max(-25, Math.min(25, wheelPixels(deltaY, mode))); // one mouse notch ≈ 1.28×; pinch deltas are small
  return Math.exp(-px * 0.01);
}

/** Ctrl/Cmd + wheel inside a preview: the bridge sends iframe coordinates. */
export function zoomFromPreview(sid: string, e: Events["wheelZoom"]) {
  const s = getState();
  const i = s.screens.findIndex((sc) => sc.id === sid);
  if (i < 0) return;
  const p = previewPos(i);
  const { x, y, z } = s.camera;
  zoomAt(x + (p.x + e.x) * z, y + (p.y + e.y) * z, wheelZoomFactor(e.dy, e.mode));
}

/** Fit the whole grid; at the 25% floor, start at the top-left. */
export function fitCamera(viewW: number, viewH: number) {
  const n = getState().screens.length;
  if (!n || !viewW || !viewH) return;
  const margin = 48;
  const size = worldSize(n);
  const z = clampZoom(Math.min((viewW - margin * 2) / size.w, (viewH - margin * 2) / size.h));
  const x = Math.max(margin, (viewW - size.w * z) / 2);
  const y = Math.max(margin, (viewH - size.h * z) / 2);
  actions.setCamera({ x, y, z });
}

export function zoomStep(viewW: number, viewH: number, factor: number) {
  zoomAt(viewW / 2, viewH / 2, factor);
}

export function boardSize() {
  const el = document.querySelector<HTMLElement>("[data-board]");
  return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
}

export type ZoomKey = "in" | "out" | "reset";

/** Cmd/Ctrl + "+" / "-" / "0" (from the host or forwarded by a preview), as a key event's zoom intent. */
export function zoomKeyOf(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ZoomKey | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") return "reset";
  return null;
}

/** Board zoom instead of browser zoom: steps about the board centre; "reset" goes to 100%. */
export function zoomByKey(kind: ZoomKey) {
  const { w, h } = boardSize();
  if (kind === "reset") zoomStep(w, h, 1 / getState().camera.z);
  else zoomStep(w, h, kind === "in" ? 1.25 : 0.8);
}
