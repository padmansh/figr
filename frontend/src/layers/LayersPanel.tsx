import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { layersRegion } from "../regions/regions";
import { RegionBoundary } from "../regions/RegionBoundary";
import { ensureRoot, hoverFromPanel, loadChildren, selectFromPanel, setRowOpen } from "../services/layers";
import { setQuery } from "../services/search";
import { actions, getState, useStore, type LayersState } from "../store";
import { searchRows, treeRows, type Row } from "./rows";

export function LayersPanel() {
  const failed = useStore((s) => !!s.regionErrors.layers);
  const message = useStore((s) => s.regionErrors.layers);
  return (
    <aside className="panel layers">
      <RegionBoundary
        region={layersRegion}
        failed={failed}
        fallback={
          <>
            <div className="panel-head">
              <div className="panel-title">
                <b>Layers</b>
              </div>
            </div>
            <div className="region-error">
              <div className="title">Layers panel failed</div>
              <div className="body">The board and inspector still work.</div>
              {message && <div className="detail">{message}</div>}
              <button onClick={() => layersRegion.reset()}>Retry</button>
            </div>
          </>
        }
      >
        <LayersContent />
      </RegionBoundary>
    </aside>
  );
}

function LayersContent() {
  const sid = useStore((s) => s.active);
  const screenName = useStore((s) => s.screens.find((x) => x.id === s.active)?.name ?? "");
  const status = useStore((s) => (s.active ? s.previews[s.active]?.status : undefined));
  const L = useStore((s) => (s.active ? s.layers[s.active] : undefined));
  const query = L?.query ?? "";
  const S = L?.search;

  useEffect(() => {
    if (sid && status === "ready") ensureRoot(sid);
  }, [sid, status, L?.docId]);

  return (
    <>
      <div className="panel-head">
        <div className="panel-title">
          <b>Layers</b>
          <span>{screenName}</span>
        </div>
        <div className="search">
          <input
            value={query}
            disabled={!sid || !L}
            placeholder="Search layers"
            onChange={layersRegion.wrap((e: React.ChangeEvent<HTMLInputElement>) => sid && setQuery(sid, e.target.value))}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              if (query && sid) setQuery(sid, "");
              else e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
          {query && sid && <button onClick={() => setQuery(sid, "")}>Clear</button>}
        </div>
        {S && (
          <div className="match-label">
            {S.status === "loading" && !S.total
              ? "Searching the whole page…"
              : `${S.total} match${S.total === 1 ? "" : "es"} — searched the whole page${S.truncated ? " (first 500 shown)" : ""}`}
          </div>
        )}
      </div>
      {!sid ? (
        <div className="tree">
          <div className="empty">Click something in a preview</div>
        </div>
      ) : status !== "ready" || !L ? (
        <div className="tree">
          <div className="empty">{status === "failed" ? "This preview couldn’t connect." : "Waiting for this preview…"}</div>
        </div>
      ) : (
        <Tree sid={sid} L={L} />
      )}
    </>
  );
}

function Tree({ sid, L }: { sid: string; L: LayersState }) {
  const ref = useRef<HTMLDivElement>(null);
  const searching = !!L.search;
  const rows = useMemo(() => (searching ? searchRows(L) : treeRows(L)), [L, searching]);
  const nodeRows = useMemo(() => rows.filter((r): r is Extract<Row, { kind: "node" }> => r.kind === "node"), [rows]);

  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const reveal = useStore((s) => s.reveal);

  const selected = useMemo(() => new Set(selection?.sid === sid ? selection.ids : []), [selection, sid]);

  // Hovering in the preview highlights the row, or its nearest visible ancestor. Never expands.
  const hoveredRow = useMemo(() => {
    if (!hover || hover.sid !== sid) return null;
    const visible = new Set(nodeRows.map((r) => r.id));
    for (const id of [hover.id, ...hover.ancestors]) if (visible.has(id)) return id;
    return null;
  }, [hover, sid, nodeRows]);

  useScrollKeeper(ref, sid, L.docId, searching ? L.query : null, rows, reveal);

  // Event delegation: one set of handlers for all rows.
  const rowId = (e: React.SyntheticEvent) => (e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row;

  const onClick = layersRegion.wrap((e: React.MouseEvent) => {
    const id = rowId(e);
    if (!id) return;
    if (getState().dev.throwRowClick) {
      actions.setDev((d) => void (d.throwRowClick = false));
      throw new Error("Simulated throw in a layers row click handler");
    }
    if ((e.target as HTMLElement).closest("[data-chev]")) {
      if (!searching) setRowOpen(sid, id, !L.expanded[id]);
      return;
    }
    selectFromPanel(sid, id, e.shiftKey);
  });

  const onMouseOver = layersRegion.wrap((e: React.MouseEvent) => {
    const id = rowId(e);
    if (id) hoverFromPanel(sid, id);
  });

  const onKeyDown = layersRegion.wrap((e: React.KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (getState().dev.throwKey) {
      actions.setDev((d) => void (d.throwKey = false));
      throw new Error("Simulated throw in the layers key handler");
    }
    if (!nodeRows.length) return;
    const sel = getState().selection;
    const current = sel?.sid === sid ? sel.ids[sel.ids.length - 1] : undefined;
    const i = nodeRows.findIndex((r) => r.id === current);
    const row = nodeRows[i];
    const go = (r: Row | undefined) => r && selectFromPanel(sid, r.id, false);

    switch (e.key) {
      case "ArrowDown":
        go(i < 0 ? nodeRows[0] : nodeRows[i + 1]);
        break;
      case "ArrowUp":
        go(i < 0 ? nodeRows[nodeRows.length - 1] : nodeRows[i - 1]);
        break;
      case "ArrowRight":
        if (!row || !row.node.hasChildren) break;
        if (!row.open && !searching) setRowOpen(sid, row.id, true);
        else if (nodeRows[i + 1]?.depth === row.depth + 1) go(nodeRows[i + 1]);
        break;
      case "ArrowLeft": {
        if (!row) break;
        if (row.open && !searching) {
          setRowOpen(sid, row.id, false);
          break;
        }
        for (let j = i - 1; j >= 0; j--) {
          if (nodeRows[j].depth === row.depth - 1) {
            go(nodeRows[j]);
            break;
          }
        }
        break;
      }
    }
  });

  const rootLoad = L.load.root;
  const retryRoot = useCallback(() => loadChildren(sid, "root"), [sid]);

  return (
    <div
      ref={ref}
      className="tree"
      tabIndex={0}
      data-layers-panel
      onClick={onClick}
      onMouseOver={onMouseOver}
      onMouseLeave={() => hoverFromPanel(sid, null)}
      onKeyDown={onKeyDown}
    >
      <div className="tree-inner">
        {!searching && !L.children.root && <RowState kind={rootLoad === "error" ? "error" : "loading"} depth={0} onRetry={retryRoot} />}
        {searching && L.search?.status === "ok" && rows.length === 0 && <div className="empty">No layers match “{L.query}”.</div>}
        {rows.map((r) =>
          r.kind === "node" ? (
            <RowView key={r.id} row={r} selected={selected.has(r.id)} hovered={hoveredRow === r.id} dim={searching && !r.match} />
          ) : (
            <RowState key={`${r.kind}:${r.id}`} kind={r.kind} depth={r.depth} onRetry={() => loadChildren(sid, r.id)} />
          ),
        )}
      </div>
    </div>
  );
}

const RowView = memo(function RowView({
  row,
  selected,
  hovered,
  dim,
}: {
  row: Extract<Row, { kind: "node" }>;
  selected: boolean;
  hovered: boolean;
  dim: boolean;
}) {
  const { node } = row;
  const named = !!node.name && !node.name.startsWith(node.tag);
  return (
    <div
      data-row={row.id}
      className={"row" + (selected ? " selected" : hovered ? " hovered" : "") + (row.match ? " match" : "") + (dim ? " dim" : "")}
      style={{ paddingLeft: 6 + row.depth * 12 }}
    >
      <span data-chev className={"chev" + (node.hasChildren ? (row.open ? " open" : "") : " none")} />
      <span className="name">{node.name}</span>
      {named && <span className="tag">{node.tag}</span>}
    </div>
  );
});

function RowState({ kind, depth, onRetry }: { kind: "loading" | "error"; depth: number; onRetry: () => void }) {
  const style = { paddingLeft: 25 + depth * 12 };
  if (kind === "loading") {
    return (
      <div className="row-state" style={style}>
        Loading…
      </div>
    );
  }
  return (
    <div className="row-state error" style={style}>
      Couldn’t load
      <button
        className="small-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRetry();
        }}
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Keeps the panel's scroll position honest:
 *  - switching previews restores that preview's scrollTop (R4.9)
 *  - a reveal scrolls the revealed row into view (R4.5)
 *  - otherwise rows the user is looking at don't move when rows above them are
 *    added or removed by the page (R4.10): the first visible row is the anchor.
 */
function useScrollKeeper(
  ref: React.RefObject<HTMLDivElement | null>,
  sid: string,
  docId: string,
  searchKey: string | null,
  rows: Row[],
  reveal: { sid: string; id: string; n: number } | null,
) {
  const anchors = useRef<{ id: string; top: number }[]>([]);
  const shownDoc = useRef<string | null>(null);
  const shownSid = useRef(sid); // read by the scroll listener, so a late scroll event never saves into the wrong preview
  const handledReveal = useRef(0);
  const shownSearch = useRef<string | null>(null);
  const beforeSearch = useRef(new Map<string, { top: number; left: number }>()); // per preview

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const out: { id: string; top: number }[] = [];
    for (const child of el.querySelectorAll<HTMLElement>("[data-row]")) {
      if (child.offsetTop + child.offsetHeight <= el.scrollTop) continue;
      out.push({ id: child.dataset.row!, top: child.offsetTop - el.scrollTop });
      if (out.length >= 5) break;
    }
    anchors.current = out;
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const docKey = `${sid}|${docId}`;
    if (shownDoc.current !== docKey) {
      shownDoc.current = docKey;
      shownSid.current = sid;
      const saved = getState().panelScroll[sid];
      el.scrollTop = saved?.top ?? 0;
      el.scrollLeft = saved?.left ?? 0;
      handledReveal.current = reveal?.n ?? 0;
      shownSearch.current = searchKey;
      measure();
      return;
    }
    if (shownSearch.current !== searchKey) {
      // Results start at the top; clearing the search returns to where the tree was.
      const was = shownSearch.current;
      shownSearch.current = searchKey;
      // The DOM already holds the search rows here (scroll may be clamped), so use the last saved position.
      if (was === null) beforeSearch.current.set(sid, getState().panelScroll[sid] ?? { top: 0, left: 0 });
      const back = searchKey === null ? beforeSearch.current.get(sid) : undefined;
      if (searchKey === null) beforeSearch.current.delete(sid);
      el.scrollTop = back?.top ?? 0;
      el.scrollLeft = back?.left ?? 0;
      measure();
      return;
    }
    if (reveal && reveal.sid === sid && reveal.n !== handledReveal.current) {
      const row = el.querySelector<HTMLElement>(`[data-row="${CSS.escape(reveal.id)}"]`);
      if (row) {
        handledReveal.current = reveal.n;
        const top = row.offsetTop;
        if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) {
          el.scrollTop = top - el.clientHeight / 2 + row.offsetHeight / 2;
        }
        // Deep rows: bring the name into view sideways too.
        const indent = parseFloat(row.style.paddingLeft) || 0;
        if (indent < el.scrollLeft + 8 || indent > el.scrollLeft + el.clientWidth - 120) el.scrollLeft = Math.max(0, indent - 24);
        measure();
        return;
      }
    }
    for (const a of anchors.current) {
      const row = el.querySelector<HTMLElement>(`[data-row="${CSS.escape(a.id)}"]`);
      if (!row) continue;
      const drift = row.offsetTop - el.scrollTop - a.top;
      if (drift) el.scrollTop += drift;
      break;
    }
    measure();
  }, [rows, sid, docId, searchKey, reveal, measure, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      measure();
      actions.setLayersScroll(shownSid.current, el.scrollTop, el.scrollLeft);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, measure]);
}
