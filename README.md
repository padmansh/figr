# Figr Viewer

A viewer for a design tool: 24 live, cross-origin iframe previews on a pan/zoom board. The host draws hover and selection outlines over the previews and runs a lazy layers panel and an inspector. Each failure is contained in its own region.

The original brief is in [ASSIGNMENT.md](ASSIGNMENT.md).

## Run

```
npm start
```

Needs Node 18+. This installs dependencies, then starts:

| Port | What |
| --- | --- |
| `:4000` | mock API (unchanged) |
| `:4001` | preview pages (each has one added `<script src="http://localhost:5173/page-bridge.js">` in `<head>`) |
| `:5173` | the app (Vite + React + TypeScript) |

Open http://localhost:5173. The **Dev** menu (dev builds only) triggers every failure on demand. The **Reports** button lists every `report()` call, which is the same list the console prints as `[report #n]`.

Tested in Chrome (latest).

## What's built

- **Board**: grid of 1280×800 previews, drag/wheel pan, Ctrl/⌘+wheel zoom (25–400%) around the pointer, including over a preview. Select (V) and Interact (I) modes.
- **Hover / selection**: drawn by the host in screen space, so strokes stay 1px / 2px and labels stay 11px at every zoom. Outlines are clipped to the preview and to inner scroll areas. Shift-click, Escape, Enter / Shift+Enter / Tab / Shift+Tab.
- **Layers panel**: lazy tree with per-row loading, a 3s timeout and per-row retry. Two-way hover and selection sync, deep reveal in one round trip, arrow keys, per-preview memory, live DOM updates without scroll jumps, and whole-page search.
- **Inspector**: live values streamed from the page; Details from the API, latest selection only; "N elements" with "Mixed" values.
- **Failures**: board, each preview, layers panel, each row, inspector and Details are separate regions. Each failure reaches `report()` exactly once.

## Main calls

| Decision | Why |
| --- | --- |
| **One plain-JS bridge in each page** (`frontend/public/page-bridge.js`), loaded first from `<head>` | The host can't touch a cross-origin DOM. Loading first means the bridge's capture listeners and error listeners run before any page code. |
| **The page owns the DOM; the host store is a cache** | The store never invents nodes. Everything it knows came from a bridge, tagged with the document id (`docId`) it belongs to. |
| **Overlays in screen space, above the scaled world** | Constant stroke and label size at any zoom. Pan and zoom only change the camera, so outlines stay glued without a round trip. |
| **The page streams rects only for watched elements** (hover + selection), from a rAF loop that sends changes only | One mechanism covers page scroll, inner scroll areas, resizes, reflow and animation. |
| **Identity: re-match by `data-key` or by keyed anchors, otherwise drop** | "Never jump" matters more than "never lose". See [Element identity](#element-identity-across-re-renders-and-navigation). |
| **A `Region` runtime, not just error boundaries** | Error boundaries only catch render errors. Requirement R6.5 needs the same handling for handlers, timers, messages and responses. |

## Ambiguities and what I decided

1. **Page errors and `report()`.** A page error is a failure, so each one is reported once (`region: "preview"`). The preview is *not* put into an error state; it only gets the "Page error" badge, since it keeps working.
2. **Hovering a row in Interact mode** draws nothing, because Interact mode draws no outlines.
3. **Active preview** changes on a Select-mode click in a preview (an element or its background) or a row click. Clicking empty board clears the selection but keeps the active preview, so the layers panel doesn't go blank.
4. **Shift + Enter at the top level** (a child of `<body>`) does nothing. **Tab with a single sibling** keeps the same element.
5. **Search** is a case-insensitive substring match on the Name. It covers the whole page and shows at most 500 matches (the count says so).
6. **Search and auto-expand.** While a search is open, selecting doesn't change the normal tree's expanded rows. Search results are a separate tree, so clearing the search restores the earlier state exactly.
7. **Out of view** means scrolled outside the page viewport *or* outside any clipping ancestor (inner scroll areas). An element under a sticky header still counts as in view.
8. **Shortcuts in Interact mode**: V, I and Escape are forwarded unless focus is in a text field, so you can still type "v" in an input. Enter and Tab belong to the page in Interact mode.
9. **One report per outage.** While a region shows an error, further errors in it aren't reported again. After Retry, a new failure is a new report.
10. **Navigation** (a link or form followed in Interact mode) clears that preview's selection, hover, tree and page-error badge. The page script answers again with a new `docId`.
11. **Non-row requests** (reveal, keyboard navigation, search, scroll-to) that get no answer in 10s count as "the script doesn't respond", so the preview shows "Couldn't connect to this preview".
12. **Arrow keys in the panel** select rows and scroll that page to the element, the same as clicking a row.
13. **`<script>` elements in `<body>`** are elements, so they appear in the tree (as `script`).
14. **A wheel pan stays a board pan.** A wheel or trackpad gesture that starts on empty board keeps panning the board (momentum included) even when a preview slides under the cursor. A new gesture over a preview scrolls that page. Swipe-to-go-back is disabled for the app. **Cmd/Ctrl + `+` / `−` / `0`** zoom the board (in, out, 100%) instead of the browser, including while focus is inside a preview.

## How state is organised

```
frontend/src/
  store/index.ts        the only host state (Zustand + immer) and the only writers (actions)
  services/             orchestration: previews (messages), selection, layers, search, details,
                        screens, camera, mode, watch, keyboard. They call actions, never setState.
  regions/              Region runtime, report-once, RegionBoundary
  connection/           PreviewConnection: request ids, timeouts, docId
  board/ layers/ inspector/ toolbar/   React views: render from the store, call services
public/page-bridge.js   in-page script
```

**Who owns what**

| Owner | Holds |
| --- | --- |
| Page bridge | The real DOM, element ids, rects, computed styles. It is the source of truth. |
| Store (`useStore`) | camera, mode, screens, per-preview status / `docId` / page error, rects of watched ids, layers cache per preview (nodes, children, row load state, expanded, search), panel scroll per preview, active preview, hover, selection, `selectionGone`, live values, details, region errors, the report log, dev flags |
| `PreviewConnection` | Pending requests, their timers, and the current `docId` |
| `Region` | Its generation, alive / failed flags (report-once) |
| React components | Nothing persistent |

**Rules**

1. Only `actions` in `store/index.ts` write state. Components, message handlers and timers call services or actions.
2. The store never invents DOM facts. Every page-derived write is checked against the preview's current `docId` and dropped if it's stale.
3. Every async result checks that it is still wanted (a `docId`, the latest selection or query, or a region generation) before it writes.
4. Every callback that can throw runs inside the region whose state it updates.

Children lists are **replaced, never appended**. There is one request per row at a time, and collapsing a row doesn't cancel its load. That makes duplicate or missing children impossible, including when a row is collapsed and re-expanded mid-load.

## Host ↔ page protocol

Every message carries `__figr: 1` and the sender document's random `docId`. The host only accepts messages whose `origin` is the pages origin. It routes them by `event.source` (4 previews share each URL), or by `docId` when `source` is `null`; Chrome does this for messages posted during `pagehide`. The page only accepts messages from the host origin and the parent window, and only whitelisted method names (no `eval`).

```
host → page   { type: "request", id, method, params, docId }  → { type: "response", id, result | error }
host → page   { type: "command", method, params }              (no reply)
page → host   { type: "event", name, data }
```

| Requests | Answer | Used for |
| --- | --- | --- |
| `getChildren(parentId \| null)` | `NodeInfo[]` (`null` = `<body>`) | lazy rows (3s timeout) |
| `getAncestors(id)` | path + every level's children in **one** answer | deep reveal |
| `relative(id, firstChild \| parent \| next \| prev)` | the element, or nothing | Enter / Shift+Enter / Tab |
| `scrollTo(id)` | — | row click: scrolls only that page (manually, not with `scrollIntoView`) |
| `search(query)` | matches + ancestors, with parent and index | search covers rows never loaded |

| Commands | |
| --- | --- |
| `setMode(mode)` | sent on hello and on every switch; the page blocks everything in Select mode |
| `watch({ rects, live })` | which ids to stream rects (hover + selection, Select mode only) and live values (selection) for |
| `clearHover` | after pan / zoom, so the next pointer move hovers again |
| `dev(...)` | dev menu: silence, slow children, page error |

| Events | |
| --- | --- |
| `hello` / `bye` | new document (handshake) / `pagehide` |
| `hover`, `click`, `pointerLeave` | hit-tested with `elementFromPoint`, which also returns disabled controls, SVG parts and whatever is on top under a sticky header |
| `rects`, `live` | changes only, for watched ids |
| `childrenChanged`, `nodesRemoved`, `mutated` | DOM changes (children are pushed only for parents the host has loaded) |
| `key`, `wheelZoom`, `zoomKey` | shortcuts, Ctrl/⌘+wheel and ⌘ +/−/0 while the pointer or focus is inside the iframe |
| `pageError`, `bridgeError` | page `error` / `unhandledrejection`; a bug in the bridge itself |

**When a side is slow, gone or replaced**

- **Never connects:** the page must say `hello` within 10s of mount, and again within 10s of every navigation, which the old document announces with `bye`. A load event while still waiting also starts the clock. This covers a 404 or a link to a page without the bridge. Otherwise the preview shows "Couldn't connect to this preview" + Retry, reported once.
- **Slow:** a row's children have a 3s timeout and fail that row only ("Couldn't load" + Retry). Any other request has 10s and fails the preview. A late answer after a timeout finds no pending request and is ignored.
- **Replaced (navigation / reload):** a new `docId` cancels every pending request with a `CancelError`. That is not a failure: nothing is shown and nothing is reported. The host clears that preview's selection, hover and tree. Row regions of the old document are disposed, so their late answers change nothing.
- **Gone (unmount, Retry, board reload):** the connection is disposed (pending → cancelled) and the region is disposed, so late results and errors do nothing.
- **Host is slow or gone:** the page doesn't depend on the host. It starts in Select mode and queues events (such as a page error during parsing) until its `hello` is sent.

## Element identity across re-renders and navigation

The bridge gives each element an id the first time the host sees it (`WeakMap` element → id, `Map` id → element). When a `MutationObserver` batch detaches a tracked element, the bridge tries to find its replacement:

1. **The element has a unique `data-key`** → the one element with that key and the same tag.
2. **Otherwise**, a path from the nearest uniquely keyed ancestor (or `<body>`). At each step the child is found by its nearest **keyed siblings** (previous key + offset and next key + offset; both must agree when both exist), or by index when there are none. Each step must match tag and Name, and the final element's text must match with digits ignored (so "2s ago" == "4s ago").
3. **No safe match** → the id is dropped (`nodesRemoved`). The host removes it from the selection, hover and tree. If the selection becomes empty, the inspector says "This element no longer exists" until the next selection.

The id never moves to an element it can't match. Descriptors are refreshed after every batch, so they always describe the current siblings. On page-4, which rebuilds the whole list with `innerHTML` every 2s, keyed items, un-keyed items between keyed ones, and the avatars and texts inside both keep their selection and their expanded rows.

**Navigation** creates a new document and a new `docId`, so ids never cross documents.

## Failures

| Region (`report` name) | Covers | Shows |
| --- | --- | --- |
| `board` | `/screens`, board rendering, pan/zoom handlers, board timers | "Couldn't load the board" + Retry (reloads the board) |
| `preview` × 24 | connect timer, every message handler for that preview, request timeouts, the preview's rendering | "Couldn't connect…" or "Something went wrong in this preview" + Retry (remounts that iframe) |
| `layers` | panel rendering, key and click handlers, search input | "Layers panel failed" + Retry |
| `layers-row` × n | one row's `getChildren` | "Couldn't load" + Retry on that row |
| `inspector` | inspector rendering | "Inspector failed to render" + Retry |
| `details` | `/elements/:key`: fetch, parse, shape check, applying the answer | error + Retry in Details; Live still shows |

`Region` (`regions/Region.ts`) gives every kind of code the same treatment:

- `fail(err)` reports once and shows the error. It is ignored if the region is gone, the error is a cancel/abort, or the region is already failed.
- `run` / `wrap` cover synchronous handlers, timers and message callbacks.
- `track(promise)` drops results from an old generation.
- `reset()` (Retry, or the user moved on) makes the next failure a new report.
- `dispose()` (the region is gone) makes late results change nothing.
- `RegionBoundary` sends render errors to the same `fail`.

A `WeakSet` of reported error objects guarantees "exactly once", even if the same error also reaches the window-level safety net.

**Cancellation is not failure.** A newer selection aborts Details (`AbortError`), navigation cancels page requests, and a newer search or keyboard step makes older answers unwanted. None of these are shown or reported.

**Dev menu**

| Item | Expect |
| --- | --- |
| Fail /screens | board error → Retry |
| Slow + fail next details | 2s, then error in Details only; Live keeps showing |
| Race details | the next 3 take 3s; click 3 elements fast → only the last shows, nothing reported |
| Throw when next details arrive | error thrown while applying a response → Details error |
| Break preview / Unbreak | no hello → 10s → "Couldn't connect"; Retry while broken fails again (new report) |
| Silence bridge | rows fail in 3s, other requests fail the preview in 10s |
| Slow children | `getChildren` takes 5s → row times out; collapse/re-expand mid-load gives no duplicates |
| Page error | badge + 1 report |
| Throw in message handler | that preview only → "Something went wrong in this preview" |
| Throw in inspector render / layers key handler / layers row click / board timer | that region only |

## Where this breaks

- **Un-keyed elements are matched by position relative to keyed siblings.** The selection could jump if, in a single render, the page removes the selected un-keyed element and inserts a different un-keyed element with the same tag, the same Name and the same text (digits ignored) at the same place between the same keyed neighbours. On these pages, that would take two identical feed entries.
- **Un-keyed elements with no keyed anchor** (no keyed ancestor and no keyed siblings) are matched by index from `<body>`, then by tag, Name and text. A page that inserts a look-alike sibling before them in the same render could make them jump. More often they get dropped.
- **Text changes drop un-keyed elements.** An un-keyed element whose own text changes in a non-numeric way during a rebuild is dropped, even though it "still exists" (for example "59s ago" → "1m ago").
- **Duplicate `data-key`s** are not used for matching (an ambiguous key is no key).
- **Overlays trail by about one frame** during fast page scroll: rects go page → host on each animation frame.
- **Off-screen previews keep running.** 24 live iframes are heavy. Chrome throttles rAF in off-screen iframes, which is harmless here because their outlines are clipped away anyway.
- **Not inspectable:** closed shadow roots, nested iframes, `<canvas>` contents.
- **Pages that take events before the bridge.** A page can't beat the bridge's capture listeners on `window` unless its own listeners were added before the bridge loaded. The bridge is the first script in `<head>`.
- **Errors in the bridge script itself** are masked by the browser because the script is cross-origin. The bridge catches its own errors and sends them as `bridgeError` instead.
- **Typing very fast after V/I:** the bridge switches its own mode immediately, so a click right after the key is judged correctly. The host's broadcast follows a frame later.
- Only Chrome was tested.

**With another week:** write overlays straight to the DOM from a store subscription (no React re-render per rect); pause off-screen previews; a smarter un-keyed matcher with a confidence score (and still drop when unsure); Playwright tests for every dev-menu scenario (the manual scripts used while building would be the start); virtualise the layers list for pages with tens of thousands of nodes.

## Products studied

| Product | Took | Why it works |
| --- | --- | --- |
| Chrome DevTools (Elements panel, CDP `DOM` domain) | `requestChildNodes` → `setChildNodes` style lazy loading; pushing changes only for nodes the client has loaded; inspect-mode hit testing | A proven protocol between a tree UI and a page in another process |
| Figma | Enter / Shift+Enter / Tab traversal, hover vs. selection colours, constant-width strokes, zoom about the pointer | R3.5's shortcuts are Figma's, so users already know them |
| Onlook (open source) | Injected script in each preview, host-drawn overlays, layers panel | The closest public architecture to this task |

## AI usage

_To fill in: how AI was used and where it got things wrong._ Concrete cases from building this:

- It assumed messages from an iframe always carry `event.source`. Chrome sends `null` for a `postMessage` posted during `pagehide`, so the `bye` was dropped until messages were also routed by `docId`.
- It relied on a "hello since the last load event" flag. The iframe `load` event and the `hello` message can arrive in either order, so a later navigation to a bridgeless page was never timed.
- Keyboard navigation read the selection before the previous step had answered, so a fast Shift+Tab, Shift+Tab lost a step. Steps are now chained.
- The panel's scroll listener kept a stale preview id across a switch and overwrote the other preview's saved position.
- An error thrown from the cross-origin bridge reaches the page as "Script error.", and a rejection from it isn't reported at all. The dev "Page error" is now thrown from an inline script in the page's own origin.
- Deep rows (page-5, 33 levels) pushed names out of a 264px panel. The tree now scrolls sideways and reveal brings the name into view.
