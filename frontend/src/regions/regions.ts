import { messageOf } from "../errors";
import { actions, getState } from "../store";
import { Region } from "./Region";

// The fixed regions. Per-preview and per-row regions are created by their owners
// (services/previews.ts, services/layers.ts).

export const boardRegion = new Region("board", () => ({ region: "board", screenId: null }), {
  onFail: (err) => actions.boardFailed(messageOf(err)),
  onClear: () => actions.boardLoading(),
});

export const layersRegion = new Region("layers", () => ({ region: "layers", screenId: getState().active }));

export const inspectorRegion = new Region("inspector", () => ({
  region: "inspector",
  screenId: getState().selection?.sid ?? getState().active,
}));
