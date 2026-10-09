import { actions, getState } from "../store";
import { setMode } from "./mode";
import { selectRelative } from "./selection";

/**
 * One handler for shortcuts, whether the key was pressed in the host or inside
 * a preview (forwarded by the bridge). Returns true if the key was used.
 */
export function handleShortcut(key: string, shift: boolean): boolean {
  const s = getState();
  switch (key) {
    case "v":
    case "V":
      setMode("select");
      return true;
    case "i":
    case "I":
      setMode("interact");
      return true;
    case "Escape":
      if (s.menu) actions.setMenu(null);
      else actions.clearSelection();
      return true;
  }
  if (s.mode !== "select" || !s.selection) return false;
  if (key === "Enter") {
    selectRelative(shift ? "parent" : "firstChild");
    return true;
  }
  if (key === "Tab") {
    selectRelative(shift ? "prev" : "next");
    return true;
  }
  return false;
}
