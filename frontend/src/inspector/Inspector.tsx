import type { LiveValues } from "../protocol";
import { inspectorRegion } from "../regions/regions";
import { RegionBoundary } from "../regions/RegionBoundary";
import { retryDetails } from "../services/details";
import { actions, useStore } from "../store";

export function Inspector() {
  const failed = useStore((s) => !!s.regionErrors.inspector);
  const message = useStore((s) => s.regionErrors.inspector);
  const meta = useStore((s) => (s.selection ? (s.screens.find((x) => x.id === s.selection!.sid)?.name ?? "") : ""));
  return (
    <aside className="panel inspector">
      <div className="insp-head">
        <b>Inspector</b>
        <span>{meta}</span>
      </div>
      <RegionBoundary
        region={inspectorRegion}
        failed={failed}
        fallback={
          <div className="region-error">
            <div className="title">Inspector failed to render</div>
            <div className="body">The board and layers keep working.</div>
            {message && <div className="detail">{message}</div>}
            <button
              onClick={() => {
                actions.setDev((d) => void (d.throwInspector = false));
                inspectorRegion.reset();
              }}
            >
              Retry
            </button>
          </div>
        }
      >
        <InspectorBody />
      </RegionBoundary>
    </aside>
  );
}

const FIELDS: [label: string, get: (v: LiveValues) => string, swatch?: boolean][] = [
  ["Name", (v) => v.name],
  ["Tag", (v) => `<${v.tag}>`],
  ["Id", (v) => v.id || "—"],
  ["Classes", (v) => v.classes || "—"],
  ["data-key", (v) => v.key || "—"],
  ["Size", (v) => `${v.width} × ${v.height}`],
  ["Position", (v) => `${v.x}, ${v.y}`],
  ["Text", (v) => v.text || "—"],
  ["Color", (v) => formatColor(v.color), true],
  ["Background", (v) => formatColor(v.background), true],
  ["Font", (v) => v.fontFamily],
  ["Font size", (v) => v.fontSize],
  ["Weight", (v) => v.fontWeight],
];

function InspectorBody() {
  const selection = useStore((s) => s.selection);
  const gone = useStore((s) => s.selectionGone);
  const live = useStore((s) => s.live);
  const boom = useStore((s) => s.dev.throwInspector);

  // Dev menu: a render error, to show the inspector region catching it.
  if (boom) throw new Error("Simulated render error in <Live>");

  if (!selection) {
    if (gone) {
      return (
        <div className="gone">
          <b>This element no longer exists</b>
          <span>The page removed or rebuilt it, and it couldn’t be matched safely.</span>
        </div>
      );
    }
    return <div className="empty">Select an element to see its live values and details.</div>;
  }

  const values = selection.ids.map((id) => live[id]).filter(Boolean);
  const n = selection.ids.length;
  if (values.length < n) return <div className="empty">Reading live values…</div>;

  return (
    <>
      <div className="insp-title">
        <b>{n === 1 ? values[0].name : `${n} elements`}</b>
        <span>{n === 1 ? `<${values[0].tag}>` : "Shift-click to add or remove"}</span>
      </div>
      <div className="section">
        <div className="section-title">Live</div>
        {FIELDS.map(([label, get, swatch]) => {
          const all = new Set(values.map(get));
          const mixed = all.size > 1;
          const value = mixed ? "Mixed" : [...all][0];
          const showSwatch = swatch && !mixed && value !== "transparent";
          return (
            <div className="field" key={label}>
              <span>{label}</span>
              <span className={"val" + (mixed ? " mixed" : "")}>
                {showSwatch && <span className="swatch" style={{ background: value.split(" ")[0] }} />}
                {value}
              </span>
            </div>
          );
        })}
      </div>
      {n === 1 ? <DetailsSection /> : <div className="section muted">Details are shown for a single element.</div>}
    </>
  );
}

function DetailsSection() {
  const d = useStore((s) => s.details);
  const key = "key" in d ? d.key : "";
  return (
    <div className="section" style={{ gap: 8 }}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <span>Details</span>
        <code>{key}</code>
      </div>
      {d.status === "nokey" && <div className="muted">No details — this element has no data-key.</div>}
      {d.status === "loading" && <div className="muted">{d.slow ? "Loading details… (slow request)" : "Loading details…"}</div>}
      {d.status === "notFound" && <div className="muted">No details for this element.</div>}
      {d.status === "error" && (
        <div className="details-error">
          <b>Couldn’t load details</b>
          <code>{d.message}</code>
          <button onClick={() => retryDetails()}>Retry</button>
        </div>
      )}
      {d.status === "ok" && (
        <div className="details-grid">
          <div>
            <span>Component</span>
            <b>{d.data.component}</b>
          </div>
          <div>
            <span>Description</span>
            <span style={{ lineHeight: 1.45 }}>{d.data.description}</span>
          </div>
          <div>
            <span>Status</span>
            <span className={"status-pill " + d.data.status.toLowerCase()}>{d.data.status}</span>
          </div>
          <div>
            <span>Owner</span>
            <span>{d.data.owner}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** rgb(a) → #hex, with alpha as a percentage; fully transparent → "transparent". */
function formatColor(c: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(c || "");
  if (!m) return c;
  const p = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (p.length > 3 && p[3] === 0) return "transparent";
  const hex =
    "#" +
    p
      .slice(0, 3)
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("");
  return p.length > 3 && p[3] < 1 ? `${hex} · ${Math.round(p[3] * 100)}%` : hex;
}
