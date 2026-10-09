import { PREVIEW_W } from "../config";
import { previewPos } from "../services/camera";
import { useStore } from "../store";

/** Screen names above each preview, in screen space so they stay readable at any zoom. */
export function ScreenLabels() {
  const camera = useStore((s) => s.camera);
  const screens = useStore((s) => s.screens);
  const previews = useStore((s) => s.previews);
  const active = useStore((s) => s.active);
  const { x, y, z } = camera;

  return (
    <div className="screen-layer">
      {screens.map((sc, i) => {
        const p = previewPos(i);
        const err = previews[sc.id]?.pageError;
        return (
          <div
            key={sc.id}
            className={"screen-label" + (active === sc.id ? " active" : "")}
            style={{ left: x + p.x * z, top: y + p.y * z - 20, width: PREVIEW_W * z }}
          >
            <span className="nm">{sc.name}</span>
            {err && (
              <span className="page-error" data-ui>
                Page error
                <span className="tip">{err}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
