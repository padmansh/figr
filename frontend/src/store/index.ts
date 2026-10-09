import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { LiveValues, NodeId, NodeInfo, ParentId, SearchNode, VisRect } from "../protocol";

// The store is the host's only state. It is a cache of what pages reported plus
// the host's own UI state. It never invents DOM facts: nodes, children and rects
// only arrive from a page bridge, tagged with the docId they belong to.
//
// Only the `actions` below write to it. Components, message handlers and timers
// call actions; they never call setState themselves.

export interface Screen {
  id: string;
  name: string;
  url: string;
}

export type Mode = "select" | "interact";

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface PreviewState {
  attempt: number; // bumps on Retry → remounts the iframe
  status: "connecting" | "ready" | "failed";
  failKind: "connect" | "crash" | null;
  docId: string | null;
  pageError: string | null;
}

export interface SearchState {
  query: string;
  status: "loading" | "ok";
  nodes: Record<NodeId, SearchNode>;
  children: Record<string, NodeId[]>;
  matches: Record<NodeId, true>;
  total: number;
  truncated: boolean;
}

export interface LayersState {
  docId: string;
  nodes: Record<NodeId, NodeInfo>;
  children: Record<string, NodeId[]>; // parent ("root" = <body>) → child ids, replaced, never appended
  load: Record<string, "loading" | "error">; // absent = idle or loaded
  expanded: Record<NodeId, true>;
  query: string;
  search: SearchState | null;
}

export interface Hover {
  sid: string;
  id: NodeId;
  source: "page" | "panel";
  ancestors: NodeId[]; // nearest first; used to highlight the nearest visible row
}

export interface Selection {
  sid: string;
  ids: NodeId[]; // last = most recently selected
}

export interface Details {
  component: string;
  description: string;
  status: string;
  owner: string;
}

export type DetailsState =
  | { status: "none" }
  | { status: "nokey" }
  | { status: "loading"; key: string; slow: boolean }
  | { status: "notFound"; key: string }
  | { status: "ok"; key: string; data: Details }
  | { status: "error"; key: string; message: string };

export interface ReportEntry {
  n: number;
  region: string;
  screenId: string | null;
  elementKey?: string;
  message: string;
  time: string;
}

export interface DevFlags {
  failScreens: boolean;
  detailsFail: boolean;
  race: number;
  broken: Record<string, boolean>;
  silence: Record<string, boolean>;
  slow: Record<string, boolean>;
  throwKey: boolean;
  throwMessage: Record<string, boolean>;
  throwInspector: boolean;
  throwRowClick: boolean;
  throwOnDetails: boolean;
}

export interface State {
  board: { status: "loading" | "ok" | "error"; gen: number; error: string | null };
  screens: Screen[];
  camera: Camera;
  mode: Mode;
  panning: boolean;
  previews: Record<string, PreviewState>;
  rects: Record<string, Record<NodeId, VisRect | null>>;
  layers: Record<string, LayersState>;
  panelScroll: Record<string, { top: number; left: number }>; // layers panel scroll per preview, kept apart so scrolling doesn't re-render rows
  active: string | null;
  hover: Hover | null;
  selection: Selection | null;
  selectionGone: boolean;
  live: Record<NodeId, LiveValues>;
  details: DetailsState;
  reveal: { sid: string; id: NodeId; n: number } | null;
  regionErrors: Record<string, string>;
  reports: ReportEntry[];
  dev: DevFlags;
  menu: "dev" | "reports" | null;
}

const initial: State = {
  board: { status: "loading", gen: 0, error: null },
  screens: [],
  camera: { x: 40, y: 48, z: 0.25 },
  mode: "select",
  panning: false,
  previews: {},
  rects: {},
  layers: {},
  panelScroll: {},
  active: null,
  hover: null,
  selection: null,
  selectionGone: false,
  live: {},
  details: { status: "none" },
  reveal: null,
  regionErrors: {},
  reports: [],
  dev: {
    failScreens: false,
    detailsFail: false,
    race: 0,
    broken: {},
    silence: {},
    slow: {},
    throwKey: false,
    throwMessage: {},
    throwInspector: false,
    throwRowClick: false,
    throwOnDetails: false,
  },
  menu: null,
};

export const useStore = create<State>()(immer(() => initial));

type Draft = State; // immer drafts are typed as the plain state
const set = (fn: (s: Draft) => void) => useStore.setState(fn as never);
export const getState = () => useStore.getState();

function freshLayers(docId: string): LayersState {
  return { docId, nodes: {}, children: {}, load: {}, expanded: {}, query: "", search: null };
}

/** Drop everything the host knew about one preview's document. */
function clearDoc(s: Draft, sid: string, docId: string | null) {
  if (docId) s.layers[sid] = freshLayers(docId);
  else delete s.layers[sid];
  s.rects[sid] = {};
  delete s.panelScroll[sid];
  if (s.hover?.sid === sid) s.hover = null;
  if (s.selection?.sid === sid) {
    s.selection = null;
    s.live = {};
    s.selectionGone = false;
  }
}

function layersFor(s: Draft, sid: string, docId: string): LayersState | null {
  const L = s.layers[sid];
  return L && L.docId === docId ? L : null;
}

function rememberNode(s: Draft, sid: string, node: NodeInfo) {
  const L = s.layers[sid];
  if (L) L.nodes[node.id] = node;
}

export const actions = {
  // ------------------------------------------------------------- board
  boardLoading() {
    set((s) => {
      s.board.status = "loading";
      s.board.error = null;
    });
  },
  boardFailed(message: string) {
    set((s) => {
      s.board.status = "error";
      s.board.error = message;
    });
  },
  /** New board: every preview, selection and cache starts over. */
  setScreens(list: Screen[]) {
    set((s) => {
      s.screens = list;
      s.board = { status: "ok", gen: s.board.gen + 1, error: null };
      s.previews = {};
      for (const sc of list) s.previews[sc.id] = { attempt: 0, status: "connecting", failKind: null, docId: null, pageError: null };
      s.rects = {};
      s.layers = {};
      s.panelScroll = {};
      s.active = null;
      s.hover = null;
      s.selection = null;
      s.selectionGone = false;
      s.live = {};
      s.details = { status: "none" };
      s.reveal = null;
    });
  },
  setCamera(c: Camera) {
    set((s) => {
      s.camera = c;
    });
  },
  setPanning(v: boolean) {
    set((s) => {
      s.panning = v;
    });
  },
  setMode(mode: Mode) {
    set((s) => {
      s.mode = mode;
      if (mode === "interact") s.hover = null;
    });
  },

  // ---------------------------------------------------------- previews
  previewConnected(sid: string, docId: string) {
    set((s) => {
      const p = s.previews[sid];
      if (!p) return;
      const navigated = p.docId !== null && p.docId !== docId;
      p.status = "ready";
      p.failKind = null;
      p.docId = docId;
      if (navigated) p.pageError = null;
      clearDoc(s, sid, docId);
    });
  },
  previewFailed(sid: string, kind: "connect" | "crash") {
    set((s) => {
      const p = s.previews[sid];
      if (!p) return;
      p.status = "failed";
      p.failKind = kind;
      clearDoc(s, sid, null);
      p.docId = null;
    });
  },
  previewRetry(sid: string) {
    set((s) => {
      const p = s.previews[sid];
      if (!p) return;
      p.attempt += 1;
      p.status = "connecting";
      p.failKind = null;
      p.docId = null;
      p.pageError = null;
      clearDoc(s, sid, null);
    });
  },
  setPageError(sid: string, docId: string, message: string) {
    set((s) => {
      const p = s.previews[sid];
      if (p && p.docId === docId) p.pageError = message;
    });
  },

  // ------------------------------------------------------ hover / select
  setHover(h: Hover | null) {
    set((s) => {
      if (h && s.mode !== "select") return;
      s.hover = h;
    });
  },
  /** Clear hover; `onlySid` makes a late "nothing hovered" from preview B not wipe preview A's hover. */
  clearHover(onlySid?: string) {
    set((s) => {
      if (!s.hover) return;
      if (onlySid && s.hover.sid !== onlySid) return;
      s.hover = null;
    });
  },
  setRects(sid: string, docId: string, rects: Record<NodeId, VisRect | null>) {
    set((s) => {
      if (s.previews[sid]?.docId !== docId) return;
      const r = (s.rects[sid] ??= {});
      Object.assign(r, rects);
    });
  },
  /** Click / row click / keyboard result. Shift toggles within the same preview only. */
  select(sid: string, node: NodeInfo, shift: boolean) {
    set((s) => {
      rememberNode(s, sid, node);
      const sel = s.selection;
      if (shift && sel && sel.sid === sid) {
        const i = sel.ids.indexOf(node.id);
        if (i >= 0) sel.ids.splice(i, 1);
        else sel.ids.push(node.id);
        if (!sel.ids.length) s.selection = null;
      } else {
        if (sel?.sid !== sid) s.live = {};
        s.selection = { sid, ids: [node.id] };
      }
      for (const id of Object.keys(s.live)) if (!s.selection?.ids.includes(id)) delete s.live[id];
      s.selectionGone = false;
      s.active = sid;
    });
  },
  clearSelection() {
    set((s) => {
      s.selection = null;
      s.selectionGone = false;
      s.live = {};
    });
  },
  setActive(sid: string) {
    set((s) => {
      s.active = sid;
    });
  },
  setLive(sid: string, docId: string, values: Record<NodeId, LiveValues>) {
    set((s) => {
      if (s.previews[sid]?.docId !== docId || s.selection?.sid !== sid) return;
      for (const [id, v] of Object.entries(values)) if (s.selection.ids.includes(id)) s.live[id] = v;
    });
  },
  requestReveal(sid: string, id: NodeId) {
    set((s) => {
      s.reveal = { sid, id, n: (s.reveal?.n ?? 0) + 1 };
    });
  },

  /** The page says these ids no longer exist (and could not be re-matched). */
  nodesRemoved(sid: string, docId: string, ids: NodeId[]) {
    set((s) => {
      const gone = new Set(ids);
      const L = layersFor(s, sid, docId);
      if (L) {
        for (const id of ids) {
          delete L.nodes[id];
          delete L.children[id];
          delete L.load[id];
          delete L.expanded[id];
        }
        for (const pid of Object.keys(L.children)) {
          const list = L.children[pid];
          if (list.some((id) => gone.has(id))) L.children[pid] = list.filter((id) => !gone.has(id));
        }
        if (L.search) for (const id of ids) delete L.search.matches[id];
      }
      const r = s.rects[sid];
      if (r) for (const id of ids) delete r[id];
      if (s.hover?.sid === sid && gone.has(s.hover.id)) s.hover = null;
      const sel = s.selection;
      if (sel?.sid === sid && sel.ids.some((id) => gone.has(id))) {
        sel.ids = sel.ids.filter((id) => !gone.has(id));
        for (const id of ids) delete s.live[id];
        if (!sel.ids.length) {
          s.selection = null;
          s.selectionGone = true;
        }
      }
    });
  },

  // ------------------------------------------------------------- layers
  setRowLoad(sid: string, docId: string, pid: ParentId, state: "loading" | "error" | null) {
    set((s) => {
      const L = layersFor(s, sid, docId);
      if (!L) return;
      if (state) L.load[pid] = state;
      else delete L.load[pid];
    });
  },
  /** Children are always replaced as a whole, so a repeat or late answer can't duplicate rows. */
  setChildren(sid: string, docId: string, pid: ParentId, list: NodeInfo[]) {
    set((s) => {
      const L = layersFor(s, sid, docId);
      if (!L) return;
      L.children[pid] = list.map((n) => n.id);
      for (const n of list) L.nodes[n.id] = n;
      delete L.load[pid];
    });
  },
  setExpanded(sid: string, id: NodeId, open: boolean) {
    set((s) => {
      const L = s.layers[sid];
      if (!L) return;
      if (open) L.expanded[id] = true;
      else delete L.expanded[id];
    });
  },
  /** Deep reveal: fill every level from one getAncestors answer and open the path. */
  applyAncestors(sid: string, docId: string, levels: { parentId: ParentId; children: NodeInfo[] }[], path: NodeId[], expand: boolean) {
    set((s) => {
      const L = layersFor(s, sid, docId);
      if (!L) return;
      for (const lv of levels) {
        if (!lv.children) continue;
        L.children[lv.parentId] = lv.children.map((n) => n.id);
        for (const n of lv.children) L.nodes[n.id] = n;
        delete L.load[lv.parentId];
      }
      if (expand) for (const id of path) L.expanded[id] = true;
    });
  },
  setLayersScroll(sid: string, top: number, left: number) {
    set((s) => {
      if (s.layers[sid]) s.panelScroll[sid] = { top, left };
    });
  },
  setQuery(sid: string, query: string) {
    set((s) => {
      const L = s.layers[sid];
      if (!L) return;
      L.query = query;
      if (!query.trim()) L.search = null;
      else if (L.search) L.search.status = "loading";
      else L.search = { query, status: "loading", nodes: {}, children: {}, matches: {}, total: 0, truncated: false };
    });
  },
  setSearchResult(
    sid: string,
    docId: string,
    query: string,
    r: { matches: NodeId[]; nodes: Record<NodeId, SearchNode>; total: number; truncated: boolean },
  ) {
    set((s) => {
      const L = layersFor(s, sid, docId);
      if (!L || L.query !== query) return;
      const children: Record<string, NodeId[]> = {};
      const nodes = Object.values(r.nodes).sort((a, b) => a.index - b.index);
      for (const n of nodes) (children[n.parentId] ??= []).push(n.id);
      const matches: Record<NodeId, true> = {};
      for (const id of r.matches) matches[id] = true;
      L.search = { query, status: "ok", nodes: r.nodes, children, matches, total: r.total, truncated: r.truncated };
      for (const n of nodes) {
        const { parentId: _p, index: _i, ...info } = n;
        L.nodes[n.id] = info;
      }
    });
  },

  // ------------------------------------------------------------ inspector
  setDetails(d: DetailsState) {
    set((s) => {
      s.details = d;
    });
  },

  // -------------------------------------------------------------- regions
  setRegionError(key: string, message: string | null) {
    set((s) => {
      if (message === null) delete s.regionErrors[key];
      else s.regionErrors[key] = message;
    });
  },
  logReport(e: Omit<ReportEntry, "n" | "time">) {
    set((s) => {
      const n = (s.reports[0]?.n ?? 0) + 1;
      s.reports.unshift({ ...e, n, time: new Date().toLocaleTimeString() });
    });
  },

  // ------------------------------------------------------------------ dev
  setDev(fn: (d: DevFlags) => void) {
    set((s) => {
      fn(s.dev);
    });
  },
  setMenu(menu: State["menu"]) {
    set((s) => {
      s.menu = menu;
    });
  },
};
