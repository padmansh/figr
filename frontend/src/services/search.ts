import { actions, getState } from "../store";
import { ask } from "./previews";

// Search runs inside the page, so it covers rows the panel never loaded. Only
// the latest query's answer is applied. Results are a separate tree, so the
// normal tree's expanded state is never touched: clearing restores it exactly.

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function setQuery(sid: string, query: string) {
  actions.setQuery(sid, query);
  schedule(sid, 150);
}

/** The page changed: an open search is re-run. */
export function refreshSearch(sid: string) {
  if (getState().layers[sid]?.query.trim()) schedule(sid, 250);
}

function schedule(sid: string, ms: number) {
  clearTimeout(timers.get(sid));
  timers.set(
    sid,
    setTimeout(() => run(sid), ms),
  );
}

function run(sid: string) {
  timers.delete(sid);
  const L = getState().layers[sid];
  if (!L || !L.query.trim()) return;
  const { query, docId } = L;
  ask(
    sid,
    "search",
    { query: query.trim() },
    (r) => actions.setSearchResult(sid, docId, query, r),
    () => {
      const now = getState().layers[sid];
      return !!now && now.docId === docId && now.query === query;
    },
  );
}
