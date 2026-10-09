import type { Events, NodeId, NodeInfo } from "../protocol";
import { actions, getState } from "../store";
import { ask } from "./previews";

export function onPageClick(sid: string, docId: string, data: Events["click"]) {
  if (!data.node) {
    // Page background: clears the selection; the preview is still the one clicked.
    actions.clearSelection();
    actions.setActive(sid);
    return;
  }
  if (data.rect) actions.setRects(sid, docId, { [data.node.id]: data.rect });
  selectNode(sid, data.node, data.shift, { reveal: true });
}

const lastSelected = () => {
  const sel = getState().selection;
  return sel ? sel.ids[sel.ids.length - 1] : null;
};

export function selectNode(sid: string, node: NodeInfo, shift: boolean, opts: { reveal?: boolean; scrollPage?: boolean } = {}) {
  actions.select(sid, node, shift);
  if (!getState().selection?.ids.includes(node.id)) return; // shift-click removed it
  if (opts.reveal) revealInLayers(sid, node.id);
  if (opts.scrollPage) scrollPageTo(sid, node.id);
}

/** Expand every ancestor row (loading levels as needed) in one round trip, then scroll the panel to it. */
export function revealInLayers(sid: string, id: NodeId) {
  const L = getState().layers[sid];
  if (!L) return;
  const docId = L.docId;
  ask(
    sid,
    "getAncestors",
    { id },
    (r) => {
      if (!r) return;
      const searching = !!getState().layers[sid]?.search;
      // While a search is open, the normal tree is left alone so clearing the search restores it exactly.
      actions.applyAncestors(sid, docId, r.levels, r.path, !searching);
      actions.requestReveal(sid, id);
    },
    () => lastSelected() === id && getState().layers[sid]?.docId === docId,
  );
}

/** Scroll only the page (inner scroll areas + its window), never the host. */
export function scrollPageTo(sid: string, id: NodeId) {
  ask(
    sid,
    "scrollTo",
    { id },
    () => { },
    () => lastSelected() === id,
  );
}

// Keyboard steps run one after another: each acts on the result of the previous
// one, so pressing Tab three times quickly moves three siblings.
let navChain: Promise<void> = Promise.resolve();

/** Enter / Shift+Enter / Tab / Shift+Tab: act on the most recent selection and replace it. */
export function selectRelative(dir: "firstChild" | "parent" | "next" | "prev") {
  navChain = navChain.then(() => step(dir));
}

function step(dir: "firstChild" | "parent" | "next" | "prev"): Promise<void> {
  const sel = getState().selection;
  if (!sel || getState().mode !== "select") return Promise.resolve();
  const sid = sel.sid;
  const id = sel.ids[sel.ids.length - 1];
  const docId = getState().layers[sid]?.docId;
  return ask(
    sid,
    "relative",
    { id, dir },
    (r) => {
      if (r.gone) {
        if (docId) actions.nodesRemoved(sid, docId, [id]);
        return;
      }
      if (!r.node) return; // no child, or already at the top level
      if (r.rect && docId) actions.setRects(sid, docId, { [r.node.id]: r.rect });
      selectNode(sid, r.node, false, { reveal: true });
    },
    () => lastSelected() === id,
  );
}
