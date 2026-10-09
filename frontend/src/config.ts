export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:4000";
export const PAGES_ORIGIN = import.meta.env.VITE_PAGES_ORIGIN ?? "http://localhost:4001";

export const CONNECT_TIMEOUT_MS = 10_000; // page loaded but its bridge never said hello
export const REQUEST_TIMEOUT_MS = 10_000; // any request except a row's children
export const ROW_TIMEOUT_MS = 3_000; // a row's children

export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const GRID_GAP = 160;
export const GRID_COLS = 4;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
