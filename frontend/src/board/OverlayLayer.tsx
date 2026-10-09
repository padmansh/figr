import { PREVIEW_H, PREVIEW_W } from "../config";
import type { VisRect } from "../protocol";
import { previewPos } from "../services/camera";
import { useStore } from "../store";

// Outlines live in screen space, above the scaled world, so strokes stay 1px /
// 2px and labels stay 11px at every zoom. Each outline is clipped twice: to the
// preview's box, then to the element's visible area inside the page (viewport
// and inner scroll areas). Rects come from the page; pan / zoom never needs a
// round trip because the camera is applied here.

const LABEL_H = 16;

interface Outline {
  key: string;
  kind: "hover" | "selected";
  ox: number;
  oy: number;
  r: VisRect;
}

export function OverlayLayer() {
  const camera = useStore((s) => s.camera);
  const screens = useStore((s) => s.screens);
  const rects = useStore((s) => s.rects);
  const hover = useStore((s) => s.hover);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const panning = useStore((s) => s.panning);

  if (mode !== "select") return null; // Interact: selection kept but hidden

  const { x, y, z } = camera;
  const indexOf = (sid: string) => screens.findIndex((s) => s.id === sid);
  const outlines: Outline[] = [];
  const add = (sid: string, id: string, kind: Outline["kind"]) => {
    const r = rects[sid]?.[id];
    const i = indexOf(sid);
    if (!r || i < 0) return; // null = scrolled out of view: still selected, nothing drawn
    const p = previewPos(i);
    outlines.push({ key: `${kind}:${sid}:${id}`, kind, ox: x + p.x * z, oy: y + p.y * z, r });
  };
  if (selection) for (const id of selection.ids) add(selection.sid, id, "selected");
  if (hover && !panning && !(selection?.sid === hover.sid && selection.ids.includes(hover.id))) add(hover.sid, hover.id, "hover");

  const ow = PREVIEW_W * z;
  const oh = PREVIEW_H * z;

  return (
    <div className="overlay-layer">
      {outlines.map(({ key, kind, ox, oy, r }) => {
        const color = kind === "selected" ? "var(--sel)" : "var(--hov)";
        const visTop = Math.max(r.y, r.cy) * z;
        const visBottom = Math.min(r.y + r.h, r.cy + r.ch) * z;
        // Above the element; below it if there is no room above inside the preview.
        let lt = visTop - LABEL_H - 2;
        if (lt < 0) lt = visBottom + 2;
        if (lt + LABEL_H > oh) lt = Math.max(0, visTop) + 2;
        const ll = Math.min(Math.max(Math.max(r.x, r.cx) * z, 0), Math.max(0, ow - 60));
        return (
          <div key={key} className="ov" style={{ left: ox, top: oy, width: ow, height: oh }}>
            <div className="ov-clip" style={{ left: r.cx * z, top: r.cy * z, width: r.cw * z, height: r.ch * z }}>
              <div
                className="ov-box"
                style={{
                  left: (r.x - r.cx) * z,
                  top: (r.y - r.cy) * z,
                  width: r.w * z,
                  height: r.h * z,
                  border: `${kind === "selected" ? 2 : 1}px solid ${color}`,
                }}
              />
            </div>
            <div className="ov-label" style={{ left: ll, top: lt, background: color }}>
              {r.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
