import { useEffect, useRef } from "react";
import { boardRegion } from "../regions/regions";
import { RegionBoundary } from "../regions/RegionBoundary";
import { clearHoverEverywhere, fitCamera, panBy, wheelPixels, wheelZoomFactor, zoomAt } from "../services/camera";
import { loadScreens } from "../services/screens";
import { actions, useStore } from "../store";
import { OverlayLayer } from "./OverlayLayer";
import { ScreenLabels } from "./ScreenLabels";
import { World } from "./World";

export function Board() {
  const status = useStore((s) => s.board.status);
  const error = useStore((s) => s.board.error);
  const panning = useStore((s) => s.panning);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className={"board" + (panning ? " panning" : "")} data-board>
      <RegionBoundary
        region={boardRegion}
        failed={status === "error"}
        fallback={
          <div className="board-msg">
            <div className="board-error" data-ui>
              <b>Couldn’t load the board</b>
              <code>{error ?? "Something went wrong"}</code>
              <button onClick={() => loadScreens()}>Retry</button>
            </div>
          </div>
        }
      >
        {status === "loading" && <div className="board-msg">Loading screens…</div>}
        {status === "ok" && <BoardCanvas boardRef={ref} />}
      </RegionBoundary>
    </div>
  );
}

function BoardCanvas({ boardRef }: { boardRef: React.RefObject<HTMLDivElement | null> }) {
  const gen = useStore((s) => s.board.gen);
  const mode = useStore((s) => s.mode);
  const camera = useStore((s) => s.camera);
  const dots = dotGrid(camera.x, camera.y, camera.z);

  // Fit once per board load.
  useEffect(() => {
    const el = boardRef.current;
    if (el) fitCamera(el.clientWidth, el.clientHeight);
  }, [gen, boardRef]);

  // Wheel needs a non-passive native listener to stop browser zoom / scroll.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    // A wheel gesture that starts on empty board stays with the board: while it
    // continues (incl. trackpad momentum), previews sliding under the still
    // cursor must not take over the wheel and scroll their page instead.
    let gestureEnd: ReturnType<typeof setTimeout> | undefined;
    const onWheel = boardRegion.wrap((e: WheelEvent) => {
      e.preventDefault();
      el.classList.add("gesture");
      clearTimeout(gestureEnd);
      gestureEnd = setTimeout(() => el.classList.remove("gesture"), 200);
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY, e.deltaMode));
      else panBy(-wheelPixels(e.deltaX, e.deltaMode), -wheelPixels(e.deltaY, e.deltaMode));
    });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(gestureEnd);
      el.classList.remove("gesture");
    };
  }, [boardRef]);

  // Drag on empty board pans; a click without a drag clears the selection.
  const onPointerDown = boardRegion.wrap((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest(".preview, [data-ui]")) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    let lastY = e.clientY;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = boardRegion.wrap((ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) {
        moved = true;
        actions.setPanning(true);
        clearHoverEverywhere();
      }
      if (moved) panBy(ev.clientX - lastX, ev.clientY - lastY);
      lastX = ev.clientX;
      lastY = ev.clientY;
    });
    const onUp = boardRegion.wrap((ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      if (moved) actions.setPanning(false);
      else if (ev.type === "pointerup") {
        actions.clearSelection();
        actions.setMenu(null);
      }
    });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });

  return (
    <div
      onPointerDown={onPointerDown}
      style={{ position: "absolute", inset: 0, backgroundImage: dots.image, backgroundSize: dots.size, backgroundPosition: dots.pos }}
    >
      <World />
      <div className="wheel-shield" />
      <ScreenLabels />
      <OverlayLayer />
      {mode === "interact" && <div className="mode-hint">Interact mode — pages receive clicks and keys · press V to select</div>}
      <div className="board-help">Drag or scroll to pan · Ctrl/⌘ + scroll to zoom</div>
    </div>
  );
}

function dotGrid(x: number, y: number, z: number) {
  let g = 40 * z;
  while (g < 14) g *= 2;
  while (g > 56) g /= 2;
  return {
    image: "radial-gradient(circle, var(--dot) 1px, transparent 1.3px)",
    size: `${g}px ${g}px`,
    pos: `${x % g}px ${y % g}px`,
  };
}
