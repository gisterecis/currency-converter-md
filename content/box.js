// Floating result box, injected on demand when a conversion is picked.
(() => {
  "use strict";
  if (window.__maibConverterBox) return;
  window.__maibConverterBox = true;

  const RATES_URL = "https://www.maib.md/ro/curs-valutar";
  const GAP = 6;
  const MARGIN = 8;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      --bg: #ffffff; --fg: #1d2330; --muted: #667085; --line: #e4e7ec;
      --accent: #0b7a75; --accent-soft: #e6f4f3; --warn: #9a5b00; --warn-bg: #fff4e0;
      width: 340px; max-width: calc(100vw - ${2 * MARGIN}px);
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 10px 30px rgba(16, 24, 40, .18), 0 2px 6px rgba(16, 24, 40, .08);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      overflow: auto; max-height: calc(100vh - ${2 * MARGIN}px);
    }
    @media (prefers-color-scheme: dark) {
      .card {
        --bg: #1f232b; --fg: #e8eaef; --muted: #9aa3b2; --line: #343a46;
        --accent: #4fc3bb; --accent-soft: #1d3a39; --warn: #f5c16c; --warn-bg: #3a2f1c;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .5);
      }
    }
    header {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 8px 8px 12px; background: var(--accent-soft); border-bottom: 1px solid var(--line);
    }
    .title { flex: 1; font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
    button {
      all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 6px;
      display: grid; place-items: center; color: var(--muted); font-size: 16px; line-height: 1;
    }
    button:hover { background: var(--line); color: var(--fg); }
    button:focus-visible { outline: 2px solid var(--accent); }
    button[disabled] { opacity: .4; cursor: default; }
    .body { padding: 6px 12px 10px; }
    .muted { color: var(--muted); }
    .loading { padding: 8px 0; color: var(--muted); }
    .error { padding: 8px 10px; margin-top: 6px; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
    .note { margin: 6px 0 2px; color: var(--muted); font-size: 12px; }
    .section { margin-top: 6px; }
    .section-label {
      font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--accent);
    }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 1px 0; }
    .value { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .compare {
      display: grid; grid-template-columns: 1fr auto auto; column-gap: 14px; row-gap: 1px;
      align-items: baseline; margin-top: 4px;
    }
    .compare .value, .compare .col-head { text-align: right; }
    .col-head { font-weight: 600; white-space: nowrap; padding-bottom: 2px; }
    .compare .section-label { margin-top: 6px; }
    .grid-full { grid-column: 1 / -1; }
    footer {
      padding: 8px 12px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted);
      display: grid; gap: 2px;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  `;

  let host = null;
  let root = null;
  let anchor = null;
  let request = null;
  let currentTitle = "maib";

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function selectionRect(targetElementId) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    // Selections inside <input>/<textarea> have no range rect; use the element.
    try {
      const el = targetElementId != null && browser.menus.getTargetElement(targetElementId);
      if (el) return el.getBoundingClientRect();
    } catch (e) {
      // Not available; fall through.
    }
    return null;
  }

  function place() {
    if (!host) return;
    const w = host.offsetWidth;
    const hgt = host.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (anchor) {
      left = anchor.left;
      top = anchor.bottom + GAP;
      const roomBelow = vh - (anchor.bottom - window.scrollY) - GAP;
      const roomAbove = anchor.top - window.scrollY - GAP;
      if (hgt > roomBelow && roomAbove >= hgt) top = anchor.top - GAP - hgt;
    } else {
      left = window.scrollX + (vw - w) / 2;
      top = window.scrollY + 16;
    }
    left = Math.max(window.scrollX + MARGIN, Math.min(left, window.scrollX + vw - w - MARGIN));
    host.style.setProperty("left", `${left}px`, "important");
    host.style.setProperty("top", `${Math.max(MARGIN, top)}px`, "important");
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function onPointer(e) {
    if (host && !e.composedPath().includes(host)) close();
  }

  function close() {
    if (host) host.remove();
    host = root = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onPointer, true);
  }

  function frame(title, bodyChildren, footerChildren, { busy = false } = {}) {
    currentTitle = title;
    root.replaceChildren(
      h("style", null, CSS),
      h(
        "div",
        { class: "card", role: "dialog", "aria-label": "maib currency conversion" },
        h(
          "header",
          null,
          h("span", { class: "title" }, title),
          h(
            "button",
            busy
              ? { title: "Refresh rates", "aria-label": "Refresh rates", disabled: "" }
              : { title: "Refresh rates", "aria-label": "Refresh rates", onclick: refresh },
            "⟳"
          ),
          h("button", { title: "Close (Esc)", "aria-label": "Close", onclick: close }, "×")
        ),
        h("div", { class: "body" }, bodyChildren),
        footerChildren && footerChildren.length ? h("footer", null, footerChildren) : null
      )
    );
    place();
  }

  function renderLoading(title) {
    frame(title, [h("div", { class: "loading" }, "Fetching maib rates…")], null, { busy: true });
  }

  const withFee = (row) => row.value + (row.fee ? "*" : "");

  function renderSingle(reading) {
    return reading.sections.map((s) =>
      h(
        "div",
        { class: "section" },
        h("div", { class: "section-label" }, s.label),
        s.unavailable
          ? h("div", { class: "row muted" }, s.unavailable)
          : [
              h("div", { class: "row" }, h("span", null, s.get.label), h("span", { class: "value" }, withFee(s.get))),
              h("div", { class: "row" }, h("span", null, s.pay.label), h("span", { class: "value" }, withFee(s.pay))),
            ]
      )
    );
  }

  // Ambiguous number: one column per reading, same rows.
  function renderCompare(readings) {
    const cells = [h("span"), ...readings.map((r) => h("span", { class: "col-head" }, r.amount))];
    readings[0].sections.forEach((s0, i) => {
      cells.push(h("span", { class: "section-label grid-full" }, s0.label));
      if (s0.unavailable) {
        cells.push(h("span", { class: "muted grid-full" }, s0.unavailable));
        return;
      }
      for (const key of ["get", "pay"]) {
        cells.push(h("span", null, s0[key].short));
        for (const r of readings) cells.push(h("span", { class: "value" }, withFee(r.sections[i][key])));
      }
    });
    return h("div", { class: "compare" }, cells);
  }

  function renderModel(model) {
    const body = [];
    if (model.error && !model.readings.length) {
      body.push(h("div", { class: "error" }, `Couldn't load maib rates: ${model.error}`));
    }
    if (model.stale) {
      body.push(h("div", { class: "error" }, "Couldn't reach maib.md, so these are the last saved rates."));
    }
    if (model.readings.length > 1) {
      body.push(h("div", { class: "note" }, "Ambiguous separator, so both readings are shown."));
      body.push(renderCompare(model.readings));
    } else if (model.readings.length === 1) {
      body.push(renderSingle(model.readings[0]));
    }

    const footer = [];
    if (model.date) {
      const updated = model.fetchedAt
        ? ` · updated ${new Date(model.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";
      footer.push(h("div", null, `maib rates for ${model.date}${updated}`));
    }
    for (const line of model.rateLines || []) footer.push(h("div", null, line));
    if (model.anyFee) footer.push(h("div", null, "* includes the 0.1% fee on buying foreign cash"));
    footer.push(h("div", null, h("a", { href: RATES_URL, target: "_blank", rel: "noopener noreferrer" }, "maib.md/ro/curs-valutar ↗")));

    frame(model.title, body, footer);
  }

  async function refresh() {
    if (!request) return;
    const title = currentTitle;
    renderLoading(title);
    try {
      const model = await browser.runtime.sendMessage({ type: "maib-refresh", request });
      if (host) renderModel(model);
    } catch (e) {
      if (host) renderModel({ title, readings: [], rateLines: [], error: e.message });
    }
  }

  function open(msg) {
    close();
    request = msg.request;
    const r = selectionRect(msg.targetElementId);
    anchor = r
      ? { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left + window.scrollX }
      : null;

    host = document.createElement("maib-converter-box");
    host.style.cssText =
      "all: initial !important; display: block !important; position: absolute !important;" +
      " z-index: 2147483647 !important; top: 0; left: 0;";
    root = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    renderLoading(msg.title);

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer, true);
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== "string") return undefined;
    if (msg.type === "maib-open") {
      open(msg);
      return Promise.resolve(true);
    }
    if (msg.type === "maib-result") {
      if (!host) return Promise.resolve(false); // Closed while loading.
      renderModel(msg.model);
      return Promise.resolve(true);
    }
    return undefined;
  });
})();
