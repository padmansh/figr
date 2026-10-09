import type { NodeId } from "../protocol";
import { getState, useStore, type State } from "../store";
import { getConnection } from "./previews";

// Which elements each page should stream rects / live values for. Derived from
// hover + selection + mode, pushed to a page only when it changes.
//   rects: hover + selection, Select mode only (Interact draws no outlines)
//   live:  the selection, in both modes (the inspector keeps updating)

const lastSent = new Map<string, string>();

function desired(s: State, sid: string) {
  const rects: NodeId[] = [];
  const live: NodeId[] = [];
  if (s.mode === "select" && s.hover?.sid === sid) rects.push(s.hover.id);
  if (s.selection?.sid === sid) {
    for (const id of s.selection.ids) {
      if (s.mode === "select" && !rects.includes(id)) rects.push(id);
      live.push(id);
    }
  }
  return { rects, live };
}

function sync(s: State, only?: string) {
  const sids = new Set<string>(only ? [only] : lastSent.keys());
  if (!only) {
    if (s.hover) sids.add(s.hover.sid);
    if (s.selection) sids.add(s.selection.sid);
  }
  for (const sid of sids) {
    const want = desired(s, sid);
    const key = JSON.stringify(want);
    if (lastSent.get(sid) === key) continue;
    const conn = getConnection(sid);
    if (!conn) {
      lastSent.delete(sid);
      continue;
    }
    conn.command("watch", want);
    if (want.rects.length || want.live.length) lastSent.set(sid, key);
    else lastSent.delete(sid);
  }
}

/** A new document knows nothing: forget what was sent and send again. */
export function resyncWatch(sid: string) {
  lastSent.delete(sid);
  sync(getState(), sid);
}

useStore.subscribe((s, prev) => {
  if (s.hover === prev.hover && s.selection === prev.selection && s.mode === prev.mode) return;
  sync(s);
});
