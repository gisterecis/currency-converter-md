// Firefox for Android has no context menu for add-ons, so there this script
// runs in every page (background.js registers it, after lib/parse.js) and
// shows a small button under a selected amount. Tapping it opens the
// converter box next to the selection, as the menu does on desktop.
(() => {
  "use strict";
  if (window.__cvChip) return;
  window.__cvChip = true;

  const api = globalThis.browser || globalThis.chrome;
  const GAP = 30; // Clears Android's selection handles.
  const MARGIN = 8;
  // The button only offers what's mostly an amount: a number with a currency,
  // or a bare number. "Page 3 of 12" gets none.
  const BARE_NUMBER = /^[-−+]?[\d\s.,'’]+$/;

  const CSS = `
    :host { all: initial; }
    button {
      all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px;
      height: 40px; padding: 0 16px 0 12px; border-radius: 999px; cursor: pointer; white-space: nowrap;
      background: linear-gradient(120deg, #0a6f6a 0%, #11a191 100%); color: #fff;
      font: 600 15px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums;
      box-shadow: 0 8px 20px -6px rgba(16, 24, 40, .45), 0 2px 4px rgba(16, 24, 40, .12);
      -webkit-tap-highlight-color: transparent; animation: cv-in .15s ease-out;
    }
    button:active { filter: brightness(.92); }
    svg { width: 18px; height: 18px; flex: none; }
    @keyframes cv-in { from { opacity: 0; transform: translateY(-4px); } }
    @media (prefers-reduced-motion: reduce) { button { animation: none; } }
  `;

  let host = null;
  let button = null;
  let label = null;
  let text = ""; // The selection the button converts.
  let used = null; // The selection last converted: no button for it until it changes.
  let timer = null;

  // -> { text, rect } or null. Text selected in an input counts too.
  function currentSelection() {
    const el = document.activeElement;
    if (el && el.localName === "cv-converter-box") return null; // Typing in the box.
    if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && typeof el.selectionStart === "number") {
      return { text: el.value.slice(el.selectionStart, el.selectionEnd), rect: el.getBoundingClientRect() };
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    return { text: String(sel), rect: sel.getRangeAt(0).getBoundingClientRect() };
  }

  // The arrows of the logo in lib/view.js.
  function logo() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const d of ["M5 9h13l-3.5-3.5", "M19 15H6l3.5 3.5"]) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }

  function build() {
    host = document.createElement("cv-converter-chip");
    host.style.cssText =
      "all: initial !important; display: block !important; position: absolute !important;" +
      " z-index: 2147483647 !important; top: 0; left: 0; transform-origin: 0 0 !important;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    label = document.createElement("span");
    button = document.createElement("button");
    button.type = "button";
    button.append(logo(), label);
    // Keep the selection: the box opens next to it.
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", convert);
    root.append(style, button);
  }

  // Centred under the selection and kept in the visible part of the page.
  // Pinch-zoom is undone, so the button keeps its size on screen.
  function place(rect) {
    const vv = window.visualViewport;
    const view = vv
      ? { left: vv.pageLeft, top: vv.pageTop, width: vv.width, height: vv.height, scale: 1 / vv.scale }
      : { left: window.scrollX, top: window.scrollY, width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight, scale: 1 };
    const z = view.scale;
    host.style.setProperty("transform", `scale(${z})`, "important");
    const w = host.offsetWidth * z;
    const h = host.offsetHeight * z;
    let top = rect.bottom + window.scrollY + GAP * z;
    // No room below: above the selection.
    if (top + h > view.top + view.height - MARGIN * z) top = rect.top + window.scrollY - GAP * z - h;
    top = Math.max(view.top + MARGIN * z, top);
    let left = rect.left + window.scrollX + (rect.width - w) / 2;
    left = Math.max(view.left + MARGIN * z, Math.min(left, view.left + view.width - w - MARGIN * z));
    host.style.setProperty("left", `${left}px`, "important");
    host.style.setProperty("top", `${top}px`, "important");
  }

  function hide() {
    if (host) host.remove();
  }

  function update() {
    const found = currentSelection();
    const selected = found ? found.text : "";
    if (selected !== used) used = null;
    const parsed = selected.trim() && !used && globalThis.CurrencyParse.parseSelection(selected);
    if (!parsed || !(parsed.currency || BARE_NUMBER.test(selected.trim()))) {
      hide();
      return;
    }
    if (!host) build();
    text = selected;
    label.textContent = parsed.currency ? `${parsed.text} ${parsed.currency}` : parsed.text;
    button.setAttribute("aria-label", `${api.i18n.getMessage("appName")}: ${label.textContent}`);
    if (!host.isConnected) document.documentElement.append(host);
    place(found.rect);
  }

  function convert() {
    used = text;
    hide();
    api.runtime.sendMessage({ type: "cv-chip", selection: text }).catch(() => {});
  }

  // Android updates the selection while its handles are dragged: wait for a pause.
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  }

  document.addEventListener("selectionchange", schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (host && host.isConnected) schedule();
    });
  }
})();
