import { messageOf } from "../errors";
import { Region } from "../regions/Region";
import { actions, getState, useStore } from "../store";
import { fetchDetails } from "./api";

// Details for a single selected element, latest selection only:
// a new selection aborts the old request (AbortError = cancel, not a failure)
// and bumps the region generation, so a late answer can never be shown.

interface Target {
  sid: string;
  id: string;
  key: string | null;
}

let current: Target | null = null;
let controller: AbortController | null = null;

export const detailsRegion = new Region(
  "details",
  () => ({ region: "details", screenId: current?.sid ?? null, elementKey: current?.key ?? undefined }),
  {
    onFail: (err) => {
      if (current?.key) actions.setDetails({ status: "error", key: current.key, message: messageOf(err) });
    },
    onClear: () => { },
  },
);

function targetOf(): Target | null {
  const s = getState();
  const sel = s.selection;
  if (!sel || sel.ids.length !== 1) return null;
  const id = sel.ids[0];
  return { sid: sel.sid, id, key: s.layers[sel.sid]?.nodes[id]?.key ?? null };
}

function devQuery(): string {
  const dev = getState().dev;
  if (dev.detailsFail) {
    actions.setDev((d) => void (d.detailsFail = false));
    return "?latency=2000&fail=1";
  }
  if (dev.race > 0) {
    actions.setDev((d) => void (d.race -= 1));
    return "?latency=3000";
  }
  return "";
}

export function syncDetails(force = false) {
  const t = targetOf();
  if (!force && t?.sid === current?.sid && t?.id === current?.id && t?.key === current?.key) return;
  current = t;
  controller?.abort();
  controller = null;
  detailsRegion.reset();

  if (!t) return actions.setDetails({ status: "none" });
  if (!t.key) return actions.setDetails({ status: "nokey" });

  const key = t.key;
  const ctl = new AbortController();
  controller = ctl;
  const query = devQuery();
  actions.setDetails({ status: "loading", key, slow: query.includes("latency") });
  detailsRegion.track(fetchDetails(key, ctl.signal, query), (data) => {
    if (getState().dev.throwOnDetails) {
      actions.setDev((d) => void (d.throwOnDetails = false));
      throw new Error("Simulated throw while applying the details response");
    }
    actions.setDetails(data ? { status: "ok", key, data } : { status: "notFound", key });
  });
}

export function retryDetails() {
  syncDetails(true);
}

useStore.subscribe((s, prev) => {
  if (s.selection !== prev.selection || s.board.gen !== prev.board.gen) syncDetails();
});
