// Floating result box, injected on demand (after lib/view.js) when a
// conversion is picked. Places itself next to the selection, can be dragged
// by its header, and closes on Esc or a click outside.
(() => {
  "use strict";
  if (window.__cvConverterBox) return;
  window.__cvConverterBox = true;

  const api = globalThis.browser || globalThis.chrome;
  const GAP = 6;
  const MARGIN = 8;

  let host = null;
  let view = null;
  let anchor = null;
  let dragged = false;

  function selectionRect(targetElementId) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    // Selections inside <input>/<textarea> have no range rect; use the element.
    try {
      const el = targetElementId != null && api.menus && api.menus.getTargetElement(targetElementId);
      if (el) return el.getBoundingClientRect();
    } catch (e) {
      // Firefox only; fall through.
    }
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return active.getBoundingClientRect();
    return null;
  }

  function setPosition(left, top) {
    host.style.setProperty("left", `${left}px`, "important");
    host.style.setProperty("top", `${top}px`, "important");
  }

  // The part of the page on screen, in page coordinates, and the scale that
  // undoes pinch-zoom. Phones also show pages without a mobile layout zoomed
  // out; either way the box keeps its size on screen.
  function visibleArea() {
    const vv = window.visualViewport;
    if (vv) return { left: vv.pageLeft, top: vv.pageTop, width: vv.width, height: vv.height, scale: 1 / vv.scale };
    const width = document.documentElement.clientWidth || window.innerWidth;
    return { left: window.scrollX, top: window.scrollY, width, height: window.innerHeight, scale: 1 };
  }

  // The card's largest size, in its own (unscaled) pixels.
  function fit(view) {
    host.style.setProperty("transform", `scale(${view.scale})`, "important");
    host.style.setProperty("--cv-max-width", `${view.width / view.scale - 2 * MARGIN}px`);
    host.style.setProperty("--cv-max-height", `${view.height / view.scale - 2 * MARGIN}px`);
  }

  // Below the selection if it fits, else above; clamped to what's on screen.
  function place() {
    if (!host) return;
    const view = visibleArea();
    fit(view);
    if (dragged) return;
    const z = view.scale;
    const w = host.offsetWidth * z;
    const hgt = host.offsetHeight * z;
    const gap = GAP * z;
    const margin = MARGIN * z;
    let left;
    let top;
    if (anchor) {
      left = anchor.left;
      top = anchor.bottom + gap;
      const roomBelow = view.top + view.height - anchor.bottom - gap;
      const roomAbove = anchor.top - view.top - gap;
      if (hgt > roomBelow && roomAbove >= hgt) top = anchor.top - gap - hgt;
      // Neither side fits: keep the whole box on screen, even over the selection.
      else if (hgt > roomBelow) top = view.top + Math.max(margin, view.height - hgt - margin);
    } else {
      left = view.left + (view.width - w) / 2;
      top = view.top + 16 * z;
    }
    left = Math.max(view.left + margin, Math.min(left, view.left + view.width - w - margin));
    setPosition(left, Math.max(MARGIN, top));
  }

  function startDrag(e) {
    if (e.button !== 0 || !host) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const left = parseFloat(host.style.left) || 0;
    const top = parseFloat(host.style.top) || 0;
    const move = (ev) => {
      dragged = true;
      setPosition(left + ev.clientX - startX, Math.max(0, top + ev.clientY - startY));
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function onPointer(e) {
    if (host && !e.composedPath().includes(host)) close();
  }

  function close() {
    if (view) view.destroy();
    if (host) host.remove();
    host = view = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onPointer, true);
    if (window.visualViewport) window.visualViewport.removeEventListener("resize", place);
  }

  function open(msg) {
    close();
    dragged = false;
    const r = selectionRect(msg.targetElementId);
    anchor = r ? { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left + window.scrollX } : null;

    host = document.createElement("cv-converter-box");
    host.lang = msg.lang || "ro";
    host.style.cssText =
      "all: initial !important; display: block !important; position: absolute !important;" +
      " z-index: 2147483647 !important; top: 0; left: 0; transform-origin: 0 0 !important;";
    const root = host.attachShadow({ mode: "closed" });
    view = globalThis.ConverterView.create({
      mode: "box",
      strings: msg.strings || {},
      request: { ...msg.request, selection: (msg.request.selection || "").trim() },
      onRequest: (request, { force }) => api.runtime.sendMessage({ type: "cv-convert", request, force }),
      onClose: close,
      onSettings: () => api.runtime.sendMessage({ type: "cv-options" }).catch(() => {}),
      onDragStart: startDrag,
      onRender: place,
    });
    root.append(view.el);
    document.documentElement.append(host);
    place();

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer, true);
    // Pinch-zoom while the box is open.
    if (window.visualViewport) window.visualViewport.addEventListener("resize", place);
  }

  // Replies go through sendResponse: Chrome ignores returned promises.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type === "cv-open") {
      open(msg);
      sendResponse(true);
    } else if (msg.type === "cv-result") {
      if (view) view.render(msg.model); // Closed while loading otherwise.
      sendResponse(!!view);
    }
    return false;
  });
})();
