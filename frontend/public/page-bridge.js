/*
 * page-bridge.js — runs inside every preview page.
 *
 * Added to each page as ONE <script> in <head>, served by the host app. It is the
 * only code that can touch the page's DOM (the host is a different origin), so it:
 *   - gives elements stable ids and re-matches them when the page rebuilds its DOM
 *   - hit-tests the pointer and reports hover / click (Select mode)
 *   - blocks clicks, focus, keys and form submits in Select mode
 *   - streams visible rects + live values for the elements the host is watching
 *   - answers tree / search / navigation requests for the layers panel
 *   - forwards shortcuts, Ctrl/Cmd+wheel, Cmd/Ctrl +/-/0 and page errors to the host
 *
 * Protocol (all messages carry __figr: 1 and the page's docId):
 *   host → page  { type: 'request', id, method, params, docId }   → { type: 'response', id, result | error }
 *   host → page  { type: 'command', method, params }               (no reply)
 *   page → host  { type: 'event', name, data }      (hello first, bye on pagehide)
 * The host's docs live in frontend/src/protocol.ts.
 */
(function () {
  "use strict";
  if (window.__figrBridge) return;
  if (window.parent === window) return; // opened directly, not inside a preview

  var script = document.currentScript;
  var HOST_ORIGIN = new URL(script.src).origin;
  var DOC_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var host = window.parent;
  window.__figrBridge = { docId: DOC_ID };

  // ---------------------------------------------------------------- messaging

  var helloSent = false;
  var queue = []; // events raised before hello (e.g. a page error while parsing)

  function post(msg) {
    msg.__figr = 1;
    msg.docId = DOC_ID;
    try {
      host.postMessage(msg, HOST_ORIGIN);
    } catch (e) {
      /* host gone or a value that can't be cloned; nothing useful to do */
    }
  }

  function emit(name, data) {
    var msg = { type: "event", name: name, data: data };
    if (!helloSent) queue.push(msg);
    else post(msg);
  }

  // Bridge bugs must not look like page errors; they go to the preview's region.
  function safe(fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (err) {
        emit("bridgeError", { message: String((err && err.message) || err) });
      }
    };
  }

  // ------------------------------------------------------------- page errors
  // Installed first, from <head>, so errors in the page's own scripts are seen.

  window.addEventListener("error", function (e) {
    if (!e.error && !e.message) return; // resource load errors
    emit("pageError", { message: String(e.message || (e.error && e.error.message) || "Error") });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    var msg = r && r.message ? r.message : String(r);
    emit("pageError", { message: "Unhandled rejection: " + msg });
  });

  // ---------------------------------------------------------- names and ids

  function nameOf(el) {
    var dn = el.getAttribute("data-name");
    if (dn) return dn;
    var tag = el.localName;
    // getAttribute, not className: on SVG, className is an SVGAnimatedString.
    var cls = (el.getAttribute("class") || "").trim().split(/\s+/)[0];
    if (cls) return tag + "." + cls;
    if (el.id) return tag + "#" + el.id;
    return tag;
  }

  function isNode(el) {
    return (
      !!el && el.nodeType === 1 && el !== document.documentElement && el !== document.body && !!document.body && document.body.contains(el)
    );
  }

  var nextId = 1;
  var idOf = new WeakMap(); // Element → id
  var elOf = new Map(); // id → Element  (every id the host has ever seen)
  var anchors = new Map(); // id → descriptor used to re-find the element after a rebuild

  function idFor(el) {
    var id = idOf.get(el);
    if (!id) {
      id = "n" + nextId++;
      idOf.set(el, id);
      elOf.set(id, el);
      anchors.set(id, describe(el));
    }
    return id;
  }

  function info(el) {
    return {
      id: idFor(el),
      name: nameOf(el),
      tag: el.localName,
      key: el.getAttribute("data-key"),
      hasChildren: el.children.length > 0,
    };
  }

  function ancestorIds(el) {
    var out = [];
    for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) out.push(idFor(a));
    return out;
  }

  // ------------------------------------------------- identity across rebuilds
  //
  // Rule: an id means exactly one element. When a tracked element is detached, we
  // try to find its replacement; if we can't be sure, the id is dropped
  // (nodesRemoved). It never moves to a different element on a guess.
  //
  // A descriptor is a path from the nearest uniquely keyed ancestor (or <body>):
  //   { key, tag, steps: [{ tag, name, i, pk, po, nk, no }], text }
  // Each step finds the child by its nearest keyed siblings (pk/nk + offset, both
  // must agree when both exist) or by index, then checks tag + name. The final
  // element's text (digits ignored, so "2s ago" == "4s ago") must also match.

  var keyCounts = null;
  function keyCount(k) {
    if (!keyCounts) {
      keyCounts = new Map();
      var all = document.querySelectorAll("[data-key]");
      for (var i = 0; i < all.length; i++) {
        var kk = all[i].getAttribute("data-key");
        keyCounts.set(kk, (keyCounts.get(kk) || 0) + 1);
      }
    }
    return keyCounts.get(k) || 0;
  }

  function textSig(el) {
    return (el.textContent || "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  function indexIn(list, el) {
    for (var i = 0; i < list.length; i++) if (list[i] === el) return i;
    return -1;
  }

  function stepOf(el) {
    var kids = el.parentElement.children;
    var i = indexIn(kids, el);
    var s = { tag: el.localName, name: nameOf(el), i: i };
    var j, k;
    for (j = i - 1; j >= 0; j--) {
      k = kids[j].getAttribute("data-key");
      if (k) {
        s.pk = k;
        s.po = i - j;
        break;
      }
    }
    for (j = i + 1; j < kids.length; j++) {
      k = kids[j].getAttribute("data-key");
      if (k) {
        s.nk = k;
        s.no = j - i;
        break;
      }
    }
    return s;
  }

  function describe(el) {
    var steps = [];
    for (var cur = el; cur && cur !== document.body && cur.parentElement; cur = cur.parentElement) {
      var key = cur.getAttribute("data-key");
      if (key && keyCount(key) === 1) {
        return { key: key, tag: cur.localName, steps: steps.reverse(), text: steps.length ? textSig(el) : null };
      }
      steps.push(stepOf(cur));
    }
    return { key: null, tag: null, steps: steps.reverse(), text: textSig(el) };
  }

  function siblingByKey(kids, key, offset) {
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute("data-key") === key) return kids[i + offset] || null;
    }
    return null;
  }

  function resolve(d) {
    var cur;
    if (d.key) {
      var m = document.querySelectorAll('[data-key="' + CSS.escape(d.key) + '"]');
      if (m.length !== 1 || m[0].localName !== d.tag) return null;
      cur = m[0];
    } else {
      cur = document.body;
    }
    for (var i = 0; i < d.steps.length; i++) {
      var s = d.steps[i];
      var kids = cur.children;
      var byPrev = s.pk ? siblingByKey(kids, s.pk, s.po) : undefined;
      var byNext = s.nk ? siblingByKey(kids, s.nk, -s.no) : undefined;
      var c;
      if (byPrev === undefined && byNext === undefined) c = kids[s.i] || null;
      else if (byPrev !== undefined && byNext !== undefined) c = byPrev && byPrev === byNext ? byPrev : null;
      else c = byPrev !== undefined ? byPrev : byNext;
      if (!c || c.localName !== s.tag || nameOf(c) !== s.name) return null;
      cur = c;
    }
    if (d.text !== null && textSig(cur) !== d.text) return null;
    return cur;
  }

  // ---------------------------------------------------------------- the tree

  var loaded = new Set(); // parent ids ("root" = <body>) whose children the host holds
  var lastChildren = new Map(); // parent id → JSON of the last list sent

  function parentEl(pid) {
    if (pid === "root") return document.body;
    var el = elOf.get(pid);
    return el && el.isConnected ? el : null;
  }

  function childList(pid) {
    var p = parentEl(pid);
    if (!p) return null;
    var out = [];
    for (var i = 0; i < p.children.length; i++) out.push(info(p.children[i]));
    return out;
  }

  // -------------------------------------------------------- mutation handling

  var lastMutated = 0;
  var mutatedTimer = 0;

  function onMutations() {
    keyCounts = null;
    var removed = [];
    elOf.forEach(function (el, id) {
      if (el.isConnected) return;
      var d = anchors.get(id);
      var found = d ? resolve(d) : null;
      if (found && !idOf.has(found)) {
        elOf.set(id, found);
        idOf.set(found, id);
      } else {
        removed.push(id);
      }
    });
    for (var i = 0; i < removed.length; i++) forget(removed[i]);

    // Refresh descriptors so the next rebuild is matched against current siblings.
    keyCounts = null;
    elOf.forEach(function (el, id) {
      anchors.set(id, describe(el));
    });

    if (removed.length) emit("nodesRemoved", { ids: removed });

    loaded.forEach(function (pid) {
      var list = childList(pid);
      if (!list) return;
      var json = JSON.stringify(list);
      if (json !== lastChildren.get(pid)) {
        lastChildren.set(pid, json);
        emit("childrenChanged", { parentId: pid, children: list });
      }
    });

    if (hoverEl && !hoverEl.isConnected) {
      hoverEl = null;
      scheduleHover();
    }

    // Lets the host refresh an open search. Throttled: pages can mutate every frame.
    var now = Date.now();
    if (now - lastMutated > 400) {
      lastMutated = now;
      emit("mutated", {});
    } else if (!mutatedTimer) {
      mutatedTimer = setTimeout(function () {
        mutatedTimer = 0;
        lastMutated = Date.now();
        emit("mutated", {});
      }, 400);
    }
  }

  function forget(id) {
    elOf.delete(id);
    anchors.delete(id);
    loaded.delete(id);
    lastChildren.delete(id);
    lastRects.delete(id);
    lastLive.delete(id);
  }

  var observer = new MutationObserver(safe(onMutations));

  // ------------------------------------------------------- rects and geometry

  function isect(a, b) {
    var x = Math.max(a.x, b.x);
    var y = Math.max(a.y, b.y);
    return { x: x, y: y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
  }

  // The element's border box plus the part of the viewport it can show through:
  // the viewport intersected with every clipping ancestor (inner scroll areas).
  // null = fully out of view (scrolled away, clipped, or display:none).
  function visRect(el) {
    if (!el.isConnected) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    var de = document.documentElement;
    var clip = { x: 0, y: 0, w: de.clientWidth, h: de.clientHeight };
    for (var a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      if (a instanceof SVGElement && !(a instanceof SVGSVGElement && !a.ownerSVGElement)) continue;
      var cs = getComputedStyle(a);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        var ar = a.getBoundingClientRect();
        clip = isect(clip, { x: ar.left + a.clientLeft, y: ar.top + a.clientTop, w: a.clientWidth, h: a.clientHeight });
      }
      if (cs.position === "fixed") break;
    }
    if (clip.w <= 0 || clip.h <= 0) return null;
    if (r.right <= clip.x || r.left >= clip.x + clip.w || r.bottom <= clip.y || r.top >= clip.y + clip.h) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: clip.x, cy: clip.y, cw: clip.w, ch: clip.h, name: nameOf(el) };
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }
  function rectKey(r) {
    return r
      ? [round2(r.x), round2(r.y), round2(r.w), round2(r.h), round2(r.cx), round2(r.cy), round2(r.cw), round2(r.ch), r.name].join(",")
      : "null";
  }

  function liveOf(el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return {
      name: nameOf(el),
      tag: el.localName,
      id: el.id || "",
      classes: (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).join(" "),
      key: el.getAttribute("data-key") || "",
      width: Math.round(r.width),
      height: Math.round(r.height),
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      color: cs.color,
      background: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
    };
  }

  // ------------------------------------------------- watched elements (rAF)
  //
  // One loop covers page scroll, inner scroll areas, resizes, reflow and
  // animation: each frame, measure only the watched elements and send changes.

  var watchRects = [];
  var watchLive = [];
  var lastRects = new Map();
  var lastLive = new Map();
  var lastLiveAt = 0;
  var rafId = 0;

  function startLoop() {
    if (!rafId && (watchRects.length || watchLive.length)) rafId = requestAnimationFrame(tick);
  }

  var tick = safe(function () {
    rafId = 0;
    var changed = null;
    for (var i = 0; i < watchRects.length; i++) {
      var id = watchRects[i];
      var el = elOf.get(id);
      if (!el) continue;
      var r = visRect(el);
      var k = rectKey(r);
      if (lastRects.get(id) !== k) {
        lastRects.set(id, k);
        (changed || (changed = {}))[id] = r;
      }
    }
    if (changed) emit("rects", changed);

    var now = performance.now();
    if (watchLive.length && now - lastLiveAt > 100) {
      lastLiveAt = now;
      var live = null;
      for (var j = 0; j < watchLive.length; j++) {
        var lid = watchLive[j];
        var lel = elOf.get(lid);
        if (!lel || !lel.isConnected) continue;
        var v = liveOf(lel);
        var json = JSON.stringify(v);
        if (lastLive.get(lid) !== json) {
          lastLive.set(lid, json);
          (live || (live = {}))[lid] = v;
        }
      }
      if (live) emit("live", live);
    }
    startLoop();
  });

  // ----------------------------------------------------------------- modes

  var mode = "select"; // blocking is on from the first moment, before the host says anything

  function editable(t) {
    if (!t || t.nodeType !== 1) return false;
    var tag = t.localName;
    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
  }

  function block(e) {
    if (mode !== "select") return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Everything that could make the page act. Capture phase on window runs before
  // any page listener; this script registers first because it is in <head>.
  [
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
    "dragstart",
    "selectstart",
    "touchstart",
    "touchend",
    "submit",
    "reset",
    "keypress",
    "keyup",
    "beforeinput",
  ].forEach(function (type) {
    window.addEventListener(type, block, { capture: true, passive: false });
  });

  window.addEventListener(
    "focusin",
    function (e) {
      if (mode !== "select") return;
      if (e.target && e.target.blur) e.target.blur();
    },
    true,
  );

  // Hit test with elementFromPoint: it returns disabled controls, SVG parts and
  // whatever is on top under a sticky header, same as what the user sees.
  function hitAt(x, y) {
    var el = document.elementFromPoint(x, y);
    return isNode(el) ? el : null;
  }

  window.addEventListener(
    "pointerdown",
    safe(function (e) {
      if (mode !== "select") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var ae = document.activeElement;
      if (ae && ae !== document.body && ae.blur) ae.blur();
      if (e.button !== 0) return;
      var el = hitAt(e.clientX, e.clientY);
      emit("click", {
        node: el ? info(el) : null,
        ancestors: el ? ancestorIds(el) : [],
        rect: el ? visRect(el) : null,
        shift: e.shiftKey,
      });
    }),
    { capture: true, passive: false },
  );

  // ----------------------------------------------------------------- hover

  var pointerX = -1;
  var pointerY = -1;
  var pointerInside = false;
  var hoverEl = null;
  var hoverQueued = false;

  function scheduleHover() {
    if (hoverQueued || !pointerInside || mode !== "select") return;
    hoverQueued = true;
    requestAnimationFrame(flushHover);
  }

  var flushHover = safe(function () {
    hoverQueued = false;
    if (!pointerInside || mode !== "select") return;
    var el = hitAt(pointerX, pointerY);
    if (el === hoverEl) return;
    hoverEl = el;
    emit("hover", el ? { node: info(el), ancestors: ancestorIds(el), rect: visRect(el) } : null);
  });

  window.addEventListener(
    "pointermove",
    function (e) {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerInside = true;
      scheduleHover();
    },
    true,
  );

  // Scrolling moves content under a still pointer.
  window.addEventListener("scroll", scheduleHover, true);

  document.addEventListener(
    "mouseout",
    function (e) {
      if (e.relatedTarget) return;
      pointerInside = false;
      hoverEl = null;
      emit("pointerLeave", null);
    },
    true,
  );

  // ------------------------------------------------------- wheel and keys

  window.addEventListener(
    "wheel",
    function (e) {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page natively
      e.preventDefault(); // stop browser zoom
      e.stopImmediatePropagation();
      emit("wheelZoom", { dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, x: e.clientX, y: e.clientY });
    },
    { capture: true, passive: false },
  );

  function zoomKeyOf(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
    if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") return "in";
    if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") return "out";
    if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") return "reset";
    return null;
  }

  var SHORTCUTS = { v: 1, V: 1, i: 1, I: 1, Escape: 1, Enter: 1, Tab: 1 };

  // V / I also switch this page at once, so a click right after the key isn't
  // judged by the old mode. The host's setMode broadcast follows and agrees.
  function forwardKey(e) {
    if (e.key === "i" || e.key === "I") commands.setMode({ mode: "interact" });
    if (e.key === "v" || e.key === "V") commands.setMode({ mode: "select" });
    emit("key", { key: e.key, shift: e.shiftKey });
  }
  var INTERACT_SHORTCUTS = { v: 1, V: 1, i: 1, I: 1, Escape: 1 };

  window.addEventListener(
    "keydown",
    function (e) {
      var plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      // Cmd/Ctrl + "+" / "-" / "0" zoom the board in both modes, never the browser.
      var zoom = zoomKeyOf(e);
      if (zoom) {
        e.preventDefault();
        e.stopImmediatePropagation();
        emit("zoomKey", { kind: zoom });
        return;
      }
      if (mode === "select") {
        // Nothing reaches the page: Enter doesn't submit, Space doesn't press.
        e.preventDefault();
        e.stopImmediatePropagation();
        if (plain && SHORTCUTS[e.key]) forwardKey(e);
        return;
      }
      // Interact: the page owns its keys, except mode/escape outside text fields.
      if (plain && INTERACT_SHORTCUTS[e.key] && !editable(e.target)) {
        e.preventDefault();
        forwardKey(e);
      }
    },
    { capture: true, passive: false },
  );

  // -------------------------------------------------------------- requests

  // Scroll every scroll container (and the page) just enough to show el.
  // Not scrollIntoView(): that can scroll the host page too.
  function revealInPage(el) {
    var de = document.documentElement;
    for (var a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      var cs = getComputedStyle(a);
      var sy = (cs.overflowY === "auto" || cs.overflowY === "scroll") && a.scrollHeight > a.clientHeight;
      var sx = (cs.overflowX === "auto" || cs.overflowX === "scroll") && a.scrollWidth > a.clientWidth;
      if (!sy && !sx) continue;
      var ar = a.getBoundingClientRect();
      var er = el.getBoundingClientRect();
      if (sy) a.scrollTop += delta(er.top, er.bottom, ar.top + a.clientTop, ar.top + a.clientTop + a.clientHeight);
      if (sx) a.scrollLeft += delta(er.left, er.right, ar.left + a.clientLeft, ar.left + a.clientLeft + a.clientWidth);
    }
    var r = el.getBoundingClientRect();
    var dy = delta(r.top, r.bottom, 0, de.clientHeight);
    var dx = delta(r.left, r.right, 0, de.clientWidth);
    if (dx || dy) window.scrollBy(dx, dy);
  }

  // How far to scroll so [a, b] fits in [lo, hi], with a little margin.
  function delta(a, b, lo, hi) {
    var m = 16;
    if (a >= lo && b <= hi) return 0;
    if (b - a > hi - lo - 2 * m || a < lo) return a - lo - m;
    return b - hi + m;
  }

  var dev = { silent: false, slowChildren: 0 };

  var methods = {
    getChildren: function (p) {
      var pid = p.parentId || "root";
      var list = childList(pid);
      if (!list) return null; // the parent is gone
      loaded.add(pid);
      lastChildren.set(pid, JSON.stringify(list));
      return list;
    },

    // Everything the panel needs to reveal a deep element in one round trip.
    getAncestors: function (p) {
      var el = elOf.get(p.id);
      if (!el || !el.isConnected) return null;
      var chain = [];
      for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) chain.unshift(a);
      var levels = [{ parentId: "root", children: methods.getChildren({ parentId: "root" }) }];
      var path = [];
      for (var i = 0; i < chain.length; i++) {
        var id = idFor(chain[i]);
        path.push(id);
        levels.push({ parentId: id, children: methods.getChildren({ parentId: id }) });
      }
      return { path: path, levels: levels };
    },

    relative: function (p) {
      var el = elOf.get(p.id);
      if (!el || !el.isConnected) return { gone: true };
      var t = null;
      if (p.dir === "firstChild") t = el.firstElementChild;
      else if (p.dir === "parent") t = el.parentElement === document.body ? null : el.parentElement;
      else {
        var sibs = el.parentElement.children;
        var i = indexIn(sibs, el);
        var n = sibs.length;
        t = sibs[(i + (p.dir === "next" ? 1 : -1) + n) % n];
      }
      if (!isNode(t)) return { node: null };
      return { node: info(t), rect: visRect(t) };
    },

    scrollTo: function (p) {
      var el = elOf.get(p.id);
      if (!el || !el.isConnected) return false;
      revealInPage(el);
      return true;
    },

    // Runs here so it covers rows the host never loaded.
    search: function (p) {
      var q = String(p.query || "").toLowerCase();
      var LIMIT = 500;
      var all = document.body.getElementsByTagName("*");
      var matches = [];
      var total = 0;
      for (var i = 0; i < all.length; i++) {
        if (nameOf(all[i]).toLowerCase().indexOf(q) === -1) continue;
        total++;
        if (matches.length < LIMIT) matches.push(all[i]);
      }
      var nodes = {};
      var matchIds = [];
      for (var m = 0; m < matches.length; m++) {
        var el = matches[m];
        matchIds.push(idFor(el));
        for (var c = el; c && c !== document.body; c = c.parentElement) {
          var id = idFor(c);
          if (nodes[id]) break;
          var n = info(c);
          n.parentId = c.parentElement === document.body ? "root" : idFor(c.parentElement);
          n.index = indexIn(c.parentElement.children, c);
          nodes[id] = n;
        }
      }
      return { query: p.query, matches: matchIds, nodes: nodes, total: total, truncated: total > LIMIT };
    },
  };

  var commands = {
    setMode: function (p) {
      mode = p.mode === "interact" ? "interact" : "select";
      if (mode === "select") {
        var ae = document.activeElement;
        if (ae && ae !== document.body && ae.blur) ae.blur();
      } else {
        hoverEl = null;
      }
    },
    watch: function (p) {
      watchRects = p.rects || [];
      watchLive = p.live || [];
      lastRects.clear();
      lastLive.clear();
      lastLiveAt = 0;
      var unknown = [];
      watchRects.concat(watchLive).forEach(function (id) {
        if (!elOf.has(id) && unknown.indexOf(id) === -1) unknown.push(id);
      });
      if (unknown.length) emit("nodesRemoved", { ids: unknown });
      startLoop();
    },
    clearHover: function () {
      hoverEl = null; // the next pointer move reports hover again
    },
    dev: function (p) {
      if (p.action === "silence") dev.silent = !!p.value;
      if (p.action === "slowChildren") dev.slowChildren = Number(p.value) || 0;
      if (p.action === "throw") {
        // Thrown from an inline script, so it belongs to the page's own origin. An
        // error or rejection raised by this cross-origin file is muted by the
        // browser ("Script error.", or not reported at all).
        var tag = document.createElement("script");
        tag.textContent = 'setTimeout(function () { throw new Error("Simulated page error (dev menu)"); });';
        document.head.appendChild(tag);
        tag.remove();
      }
    },
  };

  window.addEventListener("message", function (e) {
    if (e.source !== host || e.origin !== HOST_ORIGIN) return;
    var m = e.data;
    if (!m || m.__figr !== 1) return;
    e.stopImmediatePropagation(); // host messages are not the page's business

    if (m.type === "command") {
      if (Object.prototype.hasOwnProperty.call(commands, m.method)) safe(commands[m.method])(m.params || {});
      return;
    }
    if (m.type !== "request") return;
    if (m.docId && m.docId !== DOC_ID) return; // meant for a previous document
    if (dev.silent) return;
    if (!Object.prototype.hasOwnProperty.call(methods, m.method)) {
      post({ type: "response", id: m.id, error: "Unknown method " + m.method });
      return;
    }
    var answer = function () {
      try {
        post({ type: "response", id: m.id, result: methods[m.method](m.params || {}) });
      } catch (err) {
        post({ type: "response", id: m.id, error: String((err && err.message) || err) });
      }
    };
    if (m.method === "getChildren" && dev.slowChildren) setTimeout(answer, dev.slowChildren);
    else answer();
  });

  // ------------------------------------------------------------------ init

  function init() {
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    helloSent = true;
    post({ type: "event", name: "hello", data: { url: location.href, title: document.title } });
    var q = queue;
    queue = [];
    for (var i = 0; i < q.length; i++) post(q[i]);
  }

  // Leaving this document (link, form, reload, src change): the host starts the
  // clock for the next document's hello.
  window.addEventListener("pagehide", function () {
    if (helloSent) post({ type: "event", name: "bye", data: null });
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", safe(init));
  else safe(init)();
})();
