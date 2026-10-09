import type { NodeId, NodeInfo } from "../protocol";
import type { LayersState } from "../store";

export type Row =
  | { kind: "node"; id: NodeId; depth: number; node: NodeInfo; open: boolean; match: boolean }
  | { kind: "loading"; id: string; depth: number }
  | { kind: "error"; id: string; depth: number };

/** Depth-first over loaded children, descending only into expanded rows. Used for rendering and arrow keys. */
export function treeRows(L: LayersState): Row[] {
  const out: Row[] = [];
  const walk = (pid: string, depth: number) => {
    const kids = L.children[pid];
    if (!kids) return;
    for (const id of kids) {
      const node = L.nodes[id];
      if (!node) continue;
      const open = !!L.expanded[id] && node.hasChildren;
      out.push({ kind: "node", id, depth, node, open, match: false });
      if (!open) continue;
      if (L.children[id]) walk(id, depth + 1);
      else if (L.load[id] === "error") out.push({ kind: "error", id, depth: depth + 1 });
      else out.push({ kind: "loading", id, depth: depth + 1 });
    }
  };
  walk("root", 0);
  return out;
}

/** The search result tree: matches plus their ancestors, all open. Never touches `expanded`. */
export function searchRows(L: LayersState): Row[] {
  const S = L.search;
  if (!S) return [];
  const out: Row[] = [];
  const walk = (pid: string, depth: number) => {
    for (const id of S.children[pid] ?? []) {
      const n = S.nodes[id];
      if (!n) continue;
      const hasKids = !!S.children[id]?.length;
      out.push({ kind: "node", id, depth, node: L.nodes[id] ?? n, open: hasKids, match: !!S.matches[id] });
      if (hasKids) walk(id, depth + 1);
    }
  };
  walk("root", 0);
  return out;
}
