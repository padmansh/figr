import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boardRegion } from "./regions/regions";
import { wasReported } from "./regions/report";
import { clearHoverEverywhere, zoomByKey, zoomKeyOf } from "./services/camera";
import "./services/details"; // subscribes to selection changes
import { handleShortcut } from "./services/keyboard";
import "./services/watch"; // subscribes to hover / selection / mode
import "./styles.css";
import { useStore } from "./store";

// Dev only: lets the console (and test scripts) read the store.
if (import.meta.env.DEV) Object.assign(window, { __figr: { useStore } });

// Shortcuts pressed while the host has focus. Keys pressed inside a preview are
// forwarded by its bridge and reach the same handleShortcut().
window.addEventListener("keydown", (e) => {
  const zoom = zoomKeyOf(e);
  if (zoom) {
    e.preventDefault(); // zoom the board, not the browser
    zoomByKey(zoom);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
  if (t.closest("[data-layers-panel]") && e.key.startsWith("Arrow")) return; // the panel's own keys
  if ((e.key === "Enter" || e.key === " ") && t.closest("button, a")) return; // let a focused button press
  if (handleShortcut(e.key, e.shiftKey)) e.preventDefault();
});

// No browser zoom anywhere in the app; the board handles Ctrl/Cmd + wheel itself.
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  },
  { passive: false },
);

// Hover clears when the pointer leaves the window.
document.documentElement.addEventListener("mouseleave", () => clearHoverEverywhere());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearHoverEverywhere();
});

// Safety net. Every handler, timer and response is already wrapped by its
// region; anything that still escapes is reported once, against the board.
const fallback = (err: unknown) => {
  if (!err || wasReported(err)) return;
  setTimeout(() => {
    if (!wasReported(err)) boardRegion.fail(err);
  });
};
window.addEventListener("error", (e) => fallback(e.error));
window.addEventListener("unhandledrejection", (e) => fallback(e.reason));

createRoot(document.getElementById("root")!).render(<App />);
