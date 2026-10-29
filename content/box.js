// Floating result box, injected on demand when a conversion is picked. All
// text comes from the background script, already localised.
(() => {
  "use strict";
  if (window.__cvConverterBox) return;
  window.__cvConverterBox = true;

  const api = globalThis.browser || globalThis.chrome;
  const GAP = 6;
  const MARGIN = 8;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      --bg: #ffffff; --fg: #1d2330; --muted: #667085; --line: #e4e7ec; --field: #f7f8fa;
      --accent: #0b7a75; --accent-soft: #e6f4f3; --warn: #9a5b00; --warn-bg: #fff4e0;
      width: 360px; max-width: calc(100vw - ${2 * MARGIN}px);
      background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 10px 30px rgba(16, 24, 40, .18), 0 2px 6px rgba(16, 24, 40, .08);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      overflow: auto; max-height: calc(100vh - ${2 * MARGIN}px);
    }
    @media (prefers-color-scheme: dark) {
      .card {
        --bg: #1f232b; --fg: #e8eaef; --muted: #9aa3b2; --line: #343a46; --field: #262b34;
        --accent: #4fc3bb; --accent-soft: #1d3a39; --warn: #f5c16c; --warn-bg: #3a2f1c;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .5);
      }
    }
    header {
      display: flex; align-items: center; gap: 4px;
      padding: 8px 8px 8px 12px; background: var(--accent-soft); border-bottom: 1px solid var(--line);
    }
    .title { flex: 1; font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
    button {
      all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 6px;
      display: grid; place-items: center; color: var(--muted); font-size: 16px; line-height: 1;
    }
    button:hover { background: var(--line); color: var(--fg); }
    button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button[disabled] { opacity: .4; cursor: default; }
    .controls {
      display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: center;
      padding: 10px 12px 2px;
    }
    .controls .bank { grid-column: 1 / -1; }
    select {
      font: inherit; color: var(--fg); background: var(--field); width: 100%;
      border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; min-width: 0;
    }
    select[disabled] { opacity: .6; }
    .body { padding: 6px 12px 10px; }
    .muted { color: var(--muted); }
    .loading { padding: 8px 0; color: var(--muted); }
    .error, .hint { padding: 8px 10px; margin-top: 6px; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
    .note { margin: 6px 0 2px; color: var(--muted); font-size: 12px; }
    .section { margin-top: 8px; }
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
  let strings = {};
  let lastModel = null;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "selected") el.selected = true;
      else el.setAttribute(k, v === true ? "" : v);
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
      const el = targetElementId != null && api.menus && api.menus.getTargetElement(targetElementId);
      if (el) return el.getBoundingClientRect();
    } catch (e) {
      // Firefox only; fall through.
    }
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return active.getBoundingClientRect();
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

  // Bank on its own row, then from ⇄ to. Disabled while loading.
  function controls(model, busy) {
    const banks = (model && model.banks) || [];
    const currencies = (model && model.currencies) || [];
    const option = (value, label, selected) => h("option", { value, selected }, label);
    const pick = (key) => (e) => convert({ ...request, [key]: e.target.value });
    if (!banks.length && !currencies.length) return null;
    return h(
      "div",
      { class: "controls" },
      h(
        "select",
        { class: "bank", "aria-label": strings.bankLabel, title: strings.bankLabel, disabled: busy, onchange: pick("bank") },
        banks.map((b) => option(b.id, b.name, b.id === request.bank))
      ),
      h(
        "select",
        { "aria-label": strings.fromLabel, title: strings.fromLabel, disabled: busy || !currencies.length, onchange: pick("src") },
        currencies.map((c) => option(c.code, `${c.code} · ${c.name}`, c.code === request.src))
      ),
      h(
        "button",
        {
          title: strings.swap,
          "aria-label": strings.swap,
          disabled: busy || !request.src,
          onclick: busy ? null : () => convert({ ...request, src: request.dst, dst: request.src }),
        },
        "⇄"
      ),
      h(
        "select",
        { "aria-label": strings.toLabel, title: strings.toLabel, disabled: busy || !currencies.length, onchange: pick("dst") },
        currencies.map((c) => option(c.code, `${c.code} · ${c.name}`, c.code === request.dst))
      )
    );
  }

  function frame(title, bodyChildren, footerChildren, { busy = false } = {}) {
    root.replaceChildren(
      h("style", null, CSS),
      h(
        "div",
        { class: "card", role: "dialog", "aria-label": strings.boxLabel },
        h(
          "header",
          null,
          h("span", { class: "title" }, title),
          h("button", { title: strings.settings, "aria-label": strings.settings, onclick: openSettings }, "⚙"),
          h("button", { title: strings.refresh, "aria-label": strings.refresh, disabled: busy, onclick: busy ? null : refresh }, "⟳"),
          h("button", { title: strings.close, "aria-label": strings.close, onclick: close }, "×")
        ),
        controls(lastModel, busy),
        h("div", { class: "body" }, bodyChildren),
        footerChildren && footerChildren.length ? h("footer", null, footerChildren) : null
      )
    );
    place();
  }

  function renderLoading(title) {
    frame(title, [h("div", { class: "loading" }, strings.loading)], null, { busy: true });
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
          : s.rows.map((r) => h("div", { class: "row" }, h("span", null, r.label), h("span", { class: "value" }, withFee(r))))
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
      s0.rows.forEach((row, j) => {
        cells.push(h("span", null, row.short));
        for (const r of readings) cells.push(h("span", { class: "value" }, withFee(r.sections[i].rows[j])));
      });
    });
    return h("div", { class: "compare" }, cells);
  }

  function renderModel(model) {
    lastModel = model;
    if (model.request) request = model.request;
    const body = [];
    if (model.error && !(model.readings || []).length) body.push(h("div", { class: "error" }, model.error));
    if (model.stale) body.push(h("div", { class: "error" }, model.stale));
    if (model.srcGuessed) body.push(h("div", { class: "hint" }, strings.srcGuessed));
    const readings = model.readings || [];
    if (readings.length > 1) {
      body.push(h("div", { class: "note" }, strings.ambiguousNote));
      body.push(renderCompare(readings));
    } else if (readings.length === 1) {
      body.push(renderSingle(readings[0]));
    }

    const footer = (model.footer || []).map((line) => h("div", null, line));
    if (model.link) footer.push(h("div", null, h("a", { href: model.link.href, target: "_blank", rel: "noopener noreferrer" }, model.link.text)));
    frame(model.title, body, footer);
  }

  async function send(msg, title) {
    renderLoading(title);
    try {
      const model = await api.runtime.sendMessage(msg);
      if (!host) return;
      if (!model || !model.title) throw new Error((model && model.error) || "no response");
      renderModel(model);
    } catch (e) {
      if (host) renderModel({ ...(lastModel || {}), title, readings: [], footer: [], error: e.message });
    }
  }

  const refresh = () => send({ type: "cv-convert", request, force: true }, lastModel ? lastModel.title : "");

  function convert(next) {
    request = next;
    send({ type: "cv-convert", request }, lastModel ? lastModel.title : "");
  }

  function openSettings() {
    api.runtime.sendMessage({ type: "cv-options" }).catch(() => {});
  }

  function open(msg) {
    close();
    request = msg.request;
    strings = msg.strings || {};
    lastModel = null;
    const r = selectionRect(msg.targetElementId);
    anchor = r
      ? { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left + window.scrollX }
      : null;

    host = document.createElement("cv-converter-box");
    host.lang = msg.lang || "ro";
    host.style.cssText =
      "all: initial !important; display: block !important; position: absolute !important;" +
      " z-index: 2147483647 !important; top: 0; left: 0;";
    root = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    renderLoading(msg.title);

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer, true);
  }

  // Replies go through sendResponse: Chrome ignores returned promises.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type === "cv-open") {
      open(msg);
      sendResponse(true);
    } else if (msg.type === "cv-result") {
      if (host) renderModel(msg.model); // Closed while loading otherwise.
      sendResponse(!!host);
    }
    return false;
  });
})();
