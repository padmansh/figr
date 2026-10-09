import { boardRegion } from "../regions/regions";
import { actions, getState } from "../store";
import { fetchScreens } from "./api";
import { disposeAllRows } from "./layers";

let controller: AbortController | null = null;

/** Load (or reload) the board. Every preview remounts; all per-preview state starts over. */
export function loadScreens() {
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  boardRegion.reset();
  actions.boardLoading();
  const fail = getState().dev.failScreens;
  if (fail) actions.setDev((d) => void (d.failScreens = false));
  boardRegion.track(fetchScreens(ctl.signal, fail ? "?fail=1" : ""), (list) => {
    disposeAllRows();
    actions.setScreens(list);
  });
}
