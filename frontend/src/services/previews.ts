import { CONNECT_TIMEOUT_MS, PAGES_ORIGIN } from "../config";
import { PreviewConnection } from "../connection/PreviewConnection";
import { ConnectError, TimeoutError } from "../errors";
import type { EventName, Events, Method, Requests } from "../protocol";
import { Region } from "../regions/Region";
import { reportFailure } from "../regions/report";
import { actions, getState } from "../store";
import { zoomByKey, zoomFromPreview } from "./camera";
import { handleShortcut } from "./keyboard";
import { disposeRows } from "./layers";
import { refreshSearch } from "./search";
import { onPageClick } from "./selection";
import { resyncWatch } from "./watch";

// Routes messages from the 24 iframes to their connection, and turns page
// events into store actions. Every handler runs inside the preview's region, so
// a throw while handling a message fails that preview only, and is reported once.

const connections = new Map<string, PreviewConnection>(); // sid → current connection
const byWindow = new Map<Window, PreviewConnection>();
const regions = new Map<string, Region>(); // sid → current preview region

export class PageError extends Error {
  name = "PageError";
}

window.addEventListener("message", (e) => {
  if (e.origin !== PAGES_ORIGIN) return;
  const msg = e.data;
  if (!msg || msg.__figr !== 1) return;
  // 4 previews share each URL: route by window, not URL. A message posted during
  // pagehide (bye) arrives with source === null; its random docId identifies it.
  const conn = e.source ? byWindow.get(e.source as Window) : [...connections.values()].find((c) => c.docId === msg.docId);
  if (!conn) return;
  conn.receive(msg);
});

export function getConnection(sid: string): PreviewConnection | undefined {
  const c = connections.get(sid);
  return c && c.docId ? c : undefined;
}

export function previewRegion(sid: string): Region | undefined {
  return regions.get(sid);
}

export function allConnections(): PreviewConnection[] {
  return [...connections.values()];
}

/**
 * One region per preview attempt. It covers the connect timer, every message
 * handler, request timeouts and the preview's rendering. Retry makes a new one.
 */
export function createPreviewRegion(sid: string): Region {
  const region = new Region(`preview:${sid}`, () => ({ region: "preview", screenId: sid }), {
    onFail: (err) => {
      connections.get(sid)?.dispose();
      disposeRows(sid);
      actions.previewFailed(sid, err instanceof ConnectError || err instanceof TimeoutError ? "connect" : "crash");
    },
  });
  regions.set(sid, region);
  return region;
}

export function disposePreviewRegion(sid: string, region: Region) {
  region.dispose();
  if (regions.get(sid) === region) regions.delete(sid);
}

/** Mount-time hookup for one iframe. Returns the cleanup for unmount / retry / board reload. */
export function attachPreview(sid: string, iframe: HTMLIFrameElement, region: Region): () => void {
  const win = iframe.contentWindow;
  if (!win) return () => { };

  // The page must say hello within 10s of mount, and again within 10s of every
  // navigation (announced by bye). A load event while still waiting (the bye got
  // lost, or a document without the bridge) starts the clock too.
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let awaitingHello = true;

  const startConnectTimer = () => {
    clearTimeout(connectTimer);
    connectTimer = setTimeout(
      region.wrap(() => {
        throw new ConnectError(`No answer from the page script in ${CONNECT_TIMEOUT_MS / 1000}s`);
      }),
      CONNECT_TIMEOUT_MS,
    );
  };

  const conn = new PreviewConnection(sid, win, {
    hello: region.wrap((docId: string, _data: Events["hello"], navigated: boolean) => {
      awaitingHello = false;
      clearTimeout(connectTimer);
      onHello(sid, conn, docId, navigated);
    }),
    bye: region.wrap(() => {
      awaitingHello = true;
      startConnectTimer();
    }),
    event: region.wrap(<N extends EventName>(name: N, data: Events[N], docId: string) => {
      onEvent(sid, name, data, docId);
    }) as never,
  });

  const onLoad = () => {
    if (awaitingHello) startConnectTimer();
  };
  iframe.addEventListener("load", onLoad);

  connections.set(sid, conn);
  byWindow.set(win, conn);
  startConnectTimer();

  return () => {
    clearTimeout(connectTimer);
    iframe.removeEventListener("load", onLoad);
    conn.dispose();
    disposeRows(sid);
    if (connections.get(sid) === conn) connections.delete(sid);
    if (byWindow.get(win) === conn) byWindow.delete(win);
  };
}

function onHello(sid: string, conn: PreviewConnection, docId: string, navigated: boolean) {
  disposeRows(sid); // row requests of the old document can't land in the new one
  actions.previewConnected(sid, docId); // a navigation clears this preview's selection, hover and tree
  conn.command("setMode", { mode: getState().mode });
  const dev = getState().dev;
  if (dev.silence[sid]) conn.command("dev", { action: "silence", value: true });
  if (dev.slow[sid]) conn.command("dev", { action: "slowChildren", value: 5000 });
  resyncWatch(sid);
  if (navigated) console.info(`[preview ${sid}] navigated`);
}

function onEvent<N extends EventName>(sid: string, name: N, payload: Events[N], docId: string) {
  const s = getState();
  if (s.dev.throwMessage[sid]) {
    actions.setDev((d) => void delete d.throwMessage[sid]);
    throw new Error(`Simulated throw while handling "${name}" from ${sid}`);
  }

  switch (name) {
    case "hover": {
      const data = payload as Events["hover"];
      if (!data) {
        actions.clearHover(sid);
        break;
      }
      if (s.mode !== "select" || s.panning) break;
      if (data.rect) actions.setRects(sid, docId, { [data.node.id]: data.rect });
      actions.setHover({ sid, id: data.node.id, source: "page", ancestors: data.ancestors });
      break;
    }
    case "pointerLeave":
      actions.clearHover(sid);
      break;
    case "click":
      onPageClick(sid, docId, payload as Events["click"]);
      break;
    case "rects":
      actions.setRects(sid, docId, payload as Events["rects"]);
      break;
    case "live":
      actions.setLive(sid, docId, payload as Events["live"]);
      break;
    case "childrenChanged": {
      const data = payload as Events["childrenChanged"];
      actions.setChildren(sid, docId, data.parentId, data.children);
      break;
    }
    case "nodesRemoved":
      actions.nodesRemoved(sid, docId, (payload as Events["nodesRemoved"]).ids);
      break;
    case "mutated":
      refreshSearch(sid);
      break;
    case "key": {
      const data = payload as Events["key"];
      handleShortcut(data.key, data.shift);
      break;
    }
    case "wheelZoom":
      zoomFromPreview(sid, payload as Events["wheelZoom"]);
      break;
    case "zoomKey":
      zoomByKey((payload as Events["zoomKey"]).kind);
      break;
    case "pageError": {
      // Shown as a badge; the preview keeps working. Each page error is one failure.
      const message = (payload as Events["pageError"]).message;
      actions.setPageError(sid, docId, message);
      reportFailure(new PageError(message), { region: "preview", screenId: sid });
      break;
    }
    case "bridgeError":
      throw new Error(`Page script error: ${(payload as Events["bridgeError"]).message}`);
  }
}

/**
 * Ask a preview something. The answer is applied inside the preview's region.
 * If the user moved on before it settles (`stillWanted` false), the answer is
 * dropped and a failure is not a failure.
 */
export function ask<M extends Method>(
  sid: string,
  method: M,
  params: Requests[M][0],
  onValue: (value: Requests[M][1]) => void,
  stillWanted: () => boolean = () => true,
): Promise<void> {
  const conn = getConnection(sid);
  const region = regions.get(sid);
  if (!conn || !region) return Promise.resolve();
  return conn.call(method, params).then(
    (v) => {
      if (stillWanted()) region.run(() => onValue(v));
    },
    (err) => {
      if (stillWanted()) region.fail(err);
    },
  );
}

export function retryPreview(sid: string) {
  actions.setDev((d) => void delete d.throwMessage[sid]);
  actions.previewRetry(sid); // bumps attempt → the iframe remounts with a fresh region
}
