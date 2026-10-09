import { ROW_TIMEOUT_MS } from "../config";
import type { NodeId, ParentId } from "../protocol";
import { Region } from "../regions/Region";
import { actions, getState } from "../store";
import { getConnection } from "./previews";
import { selectNode } from "./selection";

// Lazy tree loading. Each row's child load is its own region:
//   idle → loading → loaded | error("Couldn't load", Retry on that row)
// One request per row at a time; children are replaced, never appended; a
// collapse doesn't cancel the load. So collapse / re-expand, even mid-load,
// can't produce duplicate or missing rows.

const rowRegions = new Map<string, Region>();

function rowRegion(sid: string, docId: string, pid: ParentId) {
  const key = `${sid}|${docId}|${pid}`;
  let r = rowRegions.get(key);
  if (!r) {
    r = new Region(`row:${key}`, () => ({ region: "layers-row", screenId: sid }), {
      onFail: () => actions.setRowLoad(sid, docId, pid, "error"),
      onClear: () => { },
    });
    rowRegions.set(key, r);
  }
  return r;
}

/** The preview's document is gone: its row requests change nothing when they land. */
export function disposeRows(sid: string) {
  for (const [key, r] of rowRegions) {
    if (key.startsWith(sid + "|")) {
      r.dispose();
      rowRegions.delete(key);
    }
  }
}

export function disposeAllRows() {
  for (const r of rowRegions.values()) r.dispose();
  rowRegions.clear();
}

export function loadChildren(sid: string, pid: ParentId) {
  const L = getState().layers[sid];
  const conn = getConnection(sid);
  if (!L || !conn) return;
  if (L.load[pid] === "loading") return; // already on its way
  const docId = L.docId;
  const region = rowRegion(sid, docId, pid);
  region.reset(); // a retry: the next failure is a new one
  actions.setRowLoad(sid, docId, pid, "loading");
  region.track(conn.call("getChildren", { parentId: pid === "root" ? null : pid }, ROW_TIMEOUT_MS), (list) => {
    if (!list)
      actions.setRowLoad(sid, docId, pid, null); // the parent is gone; nodesRemoved follows
    else actions.setChildren(sid, docId, pid, list);
  });
}

export function ensureRoot(sid: string) {
  const L = getState().layers[sid];
  if (L && !L.children.root && !L.load.root) loadChildren(sid, "root");
}

export function setRowOpen(sid: string, id: NodeId, open: boolean) {
  const L = getState().layers[sid];
  if (!L || !!L.expanded[id] === open) return;
  actions.setExpanded(sid, id, open);
  if (open && !L.children[id] && !L.load[id]) loadChildren(sid, id);
}

export function selectFromPanel(sid: string, id: NodeId, shift: boolean) {
  const node = getState().layers[sid]?.nodes[id];
  if (!node) return;
  selectNode(sid, node, shift, { scrollPage: !shift });
  actions.requestReveal(sid, id);
}

export function hoverFromPanel(sid: string, id: NodeId | null) {
  const s = getState();
  if (!id) {
    if (s.hover?.source === "panel") actions.clearHover();
    return;
  }
  if (s.mode !== "select") return; // Interact mode draws no outlines
  actions.setHover({ sid, id, source: "panel", ancestors: [] });
}
