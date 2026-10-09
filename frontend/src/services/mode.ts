import { actions, getState, type Mode } from "../store";
import { allConnections } from "./previews";

export function setMode(mode: Mode) {
  if (getState().mode === mode) return;
  actions.setMode(mode); // Interact also drops hover; the selection is kept, only hidden
  for (const c of allConnections()) c.command("setMode", { mode });
}
