// The host ↔ page contract. The page side is frontend/public/page-bridge.js.
//
// host → page
//   { type: "request", id, method, params, docId }   answered by one "response"
//   { type: "command", method, params }              fire-and-forget
// page → host
//   { type: "response", id, result?, error? }
//   { type: "event", name, data }
// Every message carries __figr: 1 and the docId of the page document that sent
// it. A new docId from the same iframe means the page navigated.

export type NodeId = string;
export type ParentId = NodeId | "root"; // "root" is <body>

export interface NodeInfo {
  id: NodeId;
  name: string;
  tag: string;
  key: string | null;
  hasChildren: boolean;
}

/** Border box (x, y, w, h) and the visible clip (cx, cy, cw, ch), in the page's viewport px. */
export interface VisRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  name: string;
}

export interface LiveValues {
  name: string;
  tag: string;
  id: string;
  classes: string;
  key: string;
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}

export interface SearchNode extends NodeInfo {
  parentId: ParentId;
  index: number;
}

// ---- requests: method → [params, result]
export interface Requests {
  getChildren: [{ parentId: ParentId | null }, NodeInfo[] | null];
  getAncestors: [{ id: NodeId }, { path: NodeId[]; levels: { parentId: ParentId; children: NodeInfo[] }[] } | null];
  relative: [
    { id: NodeId; dir: "firstChild" | "parent" | "next" | "prev" },
    { gone?: boolean; node?: NodeInfo | null; rect?: VisRect | null },
  ];
  scrollTo: [{ id: NodeId }, boolean];
  search: [{ query: string }, { query: string; matches: NodeId[]; nodes: Record<NodeId, SearchNode>; total: number; truncated: boolean }];
}
export type Method = keyof Requests;

// ---- commands
export interface Commands {
  setMode: { mode: "select" | "interact" };
  watch: { rects: NodeId[]; live: NodeId[] };
  clearHover: Record<string, never>;
  dev: { action: "silence" | "slowChildren" | "throw"; value?: unknown };
}

// ---- events
export interface Events {
  hello: { url: string; title: string };
  bye: null; // pagehide: this document is going away
  hover: { node: NodeInfo; ancestors: NodeId[]; rect: VisRect | null } | null;
  click: { node: NodeInfo | null; ancestors: NodeId[]; rect: VisRect | null; shift: boolean };
  pointerLeave: null;
  rects: Record<NodeId, VisRect | null>;
  live: Record<NodeId, LiveValues>;
  childrenChanged: { parentId: ParentId; children: NodeInfo[] };
  nodesRemoved: { ids: NodeId[] };
  mutated: Record<string, never>;
  key: { key: string; shift: boolean };
  wheelZoom: { dx: number; dy: number; mode: number; x: number; y: number };
  zoomKey: { kind: "in" | "out" | "reset" }; // Cmd/Ctrl + "+" / "-" / "0" while focus is in the page
  pageError: { message: string };
  bridgeError: { message: string };
}
export type EventName = keyof Events;
