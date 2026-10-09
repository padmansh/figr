import { memo, useEffect, useMemo, useRef } from "react";
import { PAGES_ORIGIN } from "../config";
import { RegionBoundary } from "../regions/RegionBoundary";
import type { Region } from "../regions/Region";
import { previewPos } from "../services/camera";
import { attachPreview, createPreviewRegion, disposePreviewRegion, retryPreview } from "../services/previews";
import { useStore, type Screen } from "../store";

/** The scaled world: every preview at its grid position. Re-renders on camera change; previews don't. */
export function World() {
  const camera = useStore((s) => s.camera);
  const screens = useStore((s) => s.screens);
  const gen = useStore((s) => s.board.gen);
  return (
    <div className="world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
      {screens.map((sc, i) => (
        <Preview key={`${gen}:${sc.id}`} screen={sc} index={i} />
      ))}
    </div>
  );
}

const Preview = memo(function Preview({ screen, index }: { screen: Screen; index: number }) {
  const sid = screen.id;
  const attempt = useStore((s) => s.previews[sid]?.attempt ?? 0);
  const failed = useStore((s) => s.previews[sid]?.status === "failed");
  // One region per attempt; Retry creates a fresh one.
  const region = useMemo(() => createPreviewRegion(sid), [sid, attempt]);
  useEffect(() => () => disposePreviewRegion(sid, region), [sid, region]);
  const pos = previewPos(index);

  return (
    <div className="preview" style={{ left: pos.x, top: pos.y }} data-preview={sid}>
      <RegionBoundary region={region} failed={failed} fallback={<FailedCover sid={sid} />}>
        <Frame key={attempt} screen={screen} region={region} />
      </RegionBoundary>
    </div>
  );
});

function Frame({ screen, region }: { screen: Screen; region: Region }) {
  const sid = screen.id;
  const connecting = useStore((s) => s.previews[sid]?.status === "connecting");
  const broken = useStore((s) => !!s.dev.broken[sid]);
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    return attachPreview(sid, ref.current, region);
  }, [sid, region]);

  return (
    <>
      <iframe
        ref={ref}
        title={screen.name}
        src={broken ? `${PAGES_ORIGIN}/__missing__.html` : screen.url}
        width={1280}
        height={800}
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
      {connecting && <div className="preview-cover">Connecting…</div>}
    </>
  );
}

function FailedCover({ sid }: { sid: string }) {
  const kind = useStore((s) => s.previews[sid]?.failKind);
  const crash = kind === "crash";
  return (
    <div className="preview-failed" data-ui>
      <b>{crash ? "Something went wrong in this preview" : "Couldn’t connect to this preview"}</b>
      <span>{crash ? "A handler for this preview threw an error." : "The page didn’t respond in time."}</span>
      <button onClick={() => retryPreview(sid)}>Retry</button>
    </div>
  );
}
