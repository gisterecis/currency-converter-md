// The converter UI, shared by the in-page box (content/box.js, inside a closed
// shadow root) and the toolbar popup (popup/). All text comes from the
// background script, already localised; conversions go through `onRequest`.
(function (root) {
  "use strict";
  if (root.ConverterView) return;

  const NS = "http://www.w3.org/2000/svg";

  // 24×24 stroke icons as [tag, attributes] lists.
  const ICONS = {
    logo: [["path", { d: "M5 9h13l-3.5-3.5" }], ["path", { d: "M19 15H6l3.5 3.5" }]],
    cash: [["rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ["circle", { cx: 12, cy: 12, r: 2.5 }], ["path", { d: "M6 9.5v.01M18 14.5v.01" }]],
    card: [["rect", { x: 2, y: 5, width: 20, height: 14, rx: 2 }], ["path", { d: "M2 10h20M6 15h4" }]],
    online: [["rect", { x: 7, y: 2, width: 10, height: 20, rx: 2 }], ["path", { d: "M11 18h2" }]],
    official: [["path", { d: "M3 10 12 4l9 6" }], ["path", { d: "M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" }]],
    gear: [
      ["circle", { cx: 12, cy: 12, r: 3 }],
      ["path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" }],
    ],
    refresh: [["path", { d: "M21 4v6h-6" }], ["path", { d: "M20.5 15a9 9 0 1 1-2.1-9.4L21 10" }]],
    close: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
    swap: [["path", { d: "m17 3 4 4-4 4" }], ["path", { d: "M3 7h18" }], ["path", { d: "m7 21-4-4 4-4" }], ["path", { d: "M21 17H3" }]],
    chevron: [["path", { d: "m6 9 6 6 6-6" }]],
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      --bg: #ffffff; --surface: #f5f7f9; --surface-2: #e9edf1; --fg: #101828; --muted: #667085; --line: #e2e7ed;
      --accent: #0b7a75; --accent-ink: #ffffff;
      --best: #067647; --best-bg: #ecfdf3; --best-line: #8fdcb5;
      --warn: #93370d; --warn-bg: #fef6ee; --info: #175cd3; --info-bg: #eff8ff;
      --shadow: 0 24px 48px -12px rgba(16, 24, 40, .3), 0 4px 10px -2px rgba(16, 24, 40, .08);
      position: relative; width: 380px;
      max-width: var(--cv-max-width, calc(100vw - 16px)); max-height: var(--cv-max-height, calc(100vh - 16px));
      overflow: hidden auto; background: var(--bg); color: var(--fg);
      border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      animation: cv-pop .18s cubic-bezier(.2, .8, .2, 1);
    }
    @media (prefers-color-scheme: dark) {
      .card {
        --bg: #15181e; --surface: #1d2129; --surface-2: #2a303a; --fg: #eef0f4; --muted: #98a2b3; --line: #2c323c;
        --accent: #3cc8b9; --accent-ink: #062b28;
        --best: #6ce9a6; --best-bg: #0f2a1e; --best-line: #23744b;
        --warn: #fdb022; --warn-bg: #2f2312; --info: #84caff; --info-bg: #102a43;
        --shadow: 0 24px 48px -12px rgba(0, 0, 0, .75);
      }
    }
    @keyframes cv-pop { from { opacity: 0; transform: translateY(6px) scale(.985); } }
    @keyframes cv-shimmer { to { background-position: -200% 0; } }
    @keyframes cv-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .card, .card * { animation: none !important; transition: none !important; } }
    svg { width: 16px; height: 16px; display: block; }

    .head {
      display: flex; align-items: center; gap: 8px; padding: 9px 8px 9px 12px; color: #fff; user-select: none;
      background: linear-gradient(120deg, #0a6f6a 0%, #11a191 100%);
    }
    .mode-box .head { cursor: grab; }
    .mode-box .head:active { cursor: grabbing; }
    .logo {
      width: 24px; height: 24px; border-radius: 7px; flex: none; display: grid; place-items: center;
      background: rgba(255, 255, 255, .96); color: #0b7a75; box-shadow: 0 1px 2px rgba(0, 0, 0, .15);
    }
    .logo svg { width: 16px; height: 16px; stroke-width: 2.6; }
    .title { flex: 1; font-weight: 650; font-size: 13.5px; letter-spacing: .01em; }
    .icon-btn {
      all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px; flex: none;
      display: grid; place-items: center; cursor: pointer; color: inherit; transition: background .15s, color .15s;
    }
    .head .icon-btn:hover { background: rgba(255, 255, 255, .2); }
    .icon-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
    .icon-btn[disabled] { opacity: .45; cursor: default; }
    .busy .refresh svg { animation: cv-spin .9s linear infinite; }

    .controls { display: grid; gap: 8px; padding: 12px 12px 2px; }
    .row { display: flex; gap: 6px; align-items: center; min-width: 0; }
    .meta { margin-left: auto; padding-left: 6px; color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pick, .amount {
      height: 34px; min-width: 0; border: 1px solid var(--line); border-radius: 9px; background: var(--surface);
      color: var(--fg); transition: border-color .15s, box-shadow .15s, background .15s;
    }
    .pick:hover, .amount:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
    .pick:focus-within, .amount:focus {
      outline: none; background: var(--bg); border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
    }
    /* A native <select> stretched invisibly over a compact face: the face shows
       "EUR euro", the dropdown keeps the full names. */
    .pick { position: relative; display: flex; align-items: center; gap: 5px; padding: 0 7px 0 10px; cursor: pointer; }
    .pick select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font: inherit; border: 0; margin: 0; }
    .pick select option { color: #101828; background: #ffffff; }
    .pick .code { font-weight: 700; letter-spacing: .02em; flex: none; }
    .pick .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11.5px; }
    .pick .chev { width: 14px; height: 14px; flex: none; margin-left: auto; color: var(--muted); }
    .pick.off { opacity: .6; pointer-events: none; }
    .pick.bank-pick { flex: 0 1 auto; min-width: 130px; max-width: 64%; }
    .pick.bank-pick .code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; }
    .pick.cur-pick { flex: 1 1 0; }
    .amount { width: 110px; flex: none; padding: 0 9px; font: inherit; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
    .swap { width: 30px; height: 30px; color: var(--muted); }
    .swap:hover { background: var(--surface-2); color: var(--accent); }
    .swap svg { transition: transform .3s; }
    .swap.turned svg { transform: rotate(180deg); }

    .body { padding: 4px 12px 12px; transition: opacity .15s; }
    .busy .body { opacity: .55; }
    .alert { padding: 8px 10px; margin: 8px 0 0; border-radius: 9px; font-size: 12.5px; }
    .warn { background: var(--warn-bg); color: var(--warn); }
    .info { background: var(--info-bg); color: var(--info); }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 0; }
    .chips-note { flex-basis: 100%; color: var(--muted); font-size: 12px; }
    .chip {
      all: unset; cursor: pointer; padding: 3px 11px; border-radius: 999px; border: 1px solid var(--line);
      font-weight: 600; font-variant-numeric: tabular-nums; transition: background .15s, border-color .15s;
    }
    .chip:hover { border-color: var(--accent); }
    .chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .sec { margin-top: 12px; }
    .sec-head {
      display: flex; align-items: center; gap: 6px; margin-bottom: 9px; color: var(--muted);
      font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    }
    .sec-icon { width: 15px; height: 15px; color: var(--accent); }
    .sec-empty { color: var(--muted); padding: 2px 0; }
    .tiles { display: grid; gap: 8px; }
    .tiles.n2 { grid-template-columns: 1fr 1fr; }
    .tile {
      all: unset; box-sizing: border-box; position: relative; display: grid; gap: 2px; min-width: 0;
      padding: 9px 10px 8px; border-radius: 11px; background: var(--surface); border: 1px solid transparent;
      cursor: copy; transition: border-color .15s, transform .15s, background .15s;
    }
    .tile:hover { border-color: var(--line); transform: translateY(-1px); }
    .tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .tile.best { background: var(--best-bg); border-color: var(--best-line); }
    .tile.copied { border-color: var(--accent); }
    .tile-label { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: var(--muted); font-size: 11.5px; min-width: 0; }
    .tile-label > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge {
      position: absolute; top: -8px; right: 10px; padding: 1px 7px; border-radius: 999px;
      background: var(--best); color: var(--bg); box-shadow: 0 0 0 2px var(--bg);
      font-size: 9.5px; font-weight: 700; line-height: 14px; letter-spacing: .04em; text-transform: uppercase;
    }
    .tile-value { font-size: 17px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cur-code { margin-left: 4px; font-size: 11.5px; font-weight: 650; color: var(--muted); letter-spacing: 0; }
    .fee { margin-left: 1px; color: var(--muted); }
    .tile-rate { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sk, .sk:hover { cursor: default; transform: none; border-color: transparent; }
    .sk-line {
      display: block; height: 9px; margin: 3px 0; border-radius: 6px;
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%);
      background-size: 200% 100%; animation: cv-shimmer 1.1s linear infinite;
    }
    .sk-line.big { height: 17px; }
    .w30 { width: 30%; } .w45 { width: 45%; } .w60 { width: 60%; } .w75 { width: 75%; }

    .foot {
      display: grid; gap: 3px; padding: 10px 12px 12px; border-top: 1px solid var(--line);
      background: var(--surface); color: var(--muted); font-size: 11.5px;
    }
    .foot[hidden] { display: none; }
    .foot .date { color: var(--fg); font-weight: 600; opacity: .85; }
    .foot-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; }
    .link { color: var(--accent); font-weight: 600; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .more {
      all: unset; display: inline-flex; align-items: center; gap: 2px; cursor: pointer; color: var(--muted);
      font-size: 11.5px; font-weight: 600; border-radius: 6px; padding: 1px 2px;
    }
    .more:hover { color: var(--accent); }
    .more:focus-visible { outline: 2px solid var(--accent); }
    .more .chev { width: 13px; height: 13px; transition: transform .2s; }
    .more[aria-expanded="true"] .chev { transform: rotate(180deg); }
    .published { font-variant-numeric: tabular-nums; }
    .toast {
      position: absolute; left: 50%; bottom: 14px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
      padding: 6px 12px; border-radius: 999px; background: var(--fg); color: var(--bg); white-space: nowrap;
      font-size: 12px; font-weight: 600; box-shadow: 0 6px 16px rgba(0, 0, 0, .2); transition: opacity .18s, transform .18s;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .copy-buf { position: absolute; left: -9999px; opacity: 0; }
    .mode-popup { width: 100%; max-width: none; max-height: none; border: 0; border-radius: 0; box-shadow: none; animation: none; }
    .mode-box .head { touch-action: none; } /* Dragging by touch moves the box, not the page. */
  `;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function icon(name, cls) {
    const svg = document.createElementNS(NS, "svg");
    const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
    if (cls) attrs.class = cls;
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const [tag, a] of ICONS[name] || []) {
      const child = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(a)) child.setAttribute(k, v);
      svg.append(child);
    }
    return svg;
  }

  // A <select> inside a face that shows the chosen option compactly.
  function picker(select, cls) {
    const face = { code: h("span", { class: "code" }), name: h("span", { class: "name" }) };
    const wrap = h("label", { class: `pick ${cls}` }, face.code, face.name, icon("chevron", "chev"), select);
    const sync = () => {
      const opt = select.selectedOptions[0];
      face.code.textContent = opt ? opt.dataset.code : "";
      face.name.textContent = opt ? opt.dataset.name : "";
      wrap.classList.toggle("off", select.disabled);
    };
    select.addEventListener("change", sync);
    return { wrap, sync };
  }

  // Keeps a <select>'s options ([value, code, name]) in sync without
  // rebuilding it on every render.
  function fillSelect(select, options, value) {
    const sig = JSON.stringify(options);
    if (select.dataset.sig !== sig) {
      select.replaceChildren(
        ...options.map(([v, code, name]) => {
          const o = h("option", { value: v }, name ? `${code} · ${name}` : code);
          o.dataset.code = code;
          o.dataset.name = name || "";
          return o;
        })
      );
      select.dataset.sig = sig;
    }
    if (value != null) select.value = value;
  }

  //   mode         "box" (in a page: close button, draggable header) or "popup"
  //   strings      localised UI strings from the background
  //   request      { selection, src, dst, bank } to start from
  //   onRequest    (request, { force }) -> Promise<model>
  //   onClose, onSettings, onDragStart(pointerEvent), onRender()
  function create({ mode = "box", strings = {}, request: initial = {}, onRequest, onClose, onSettings, onDragStart, onRender }) {
    const s = strings;
    let request = { ...initial };
    let model = null;
    let readingIndex = 0;
    let seq = 0;
    let amountTouched = false;
    let showRates = false;
    let typingTimer = null;
    let toastTimer = null;

    const els = {};
    els.refresh = h("button", { class: "icon-btn refresh", title: s.refresh, "aria-label": s.refresh, onclick: () => send(request, { force: true }) }, icon("refresh"));
    els.head = h(
      "header",
      {
        class: "head",
        onpointerdown: (e) => {
          if (onDragStart && !e.target.closest("button")) onDragStart(e);
        },
      },
      h("span", { class: "logo" }, icon("logo")),
      h("span", { class: "title" }, s.appName),
      h("button", { class: "icon-btn", title: s.settings, "aria-label": s.settings, onclick: () => onSettings && onSettings() }, icon("gear")),
      els.refresh,
      mode === "box" ? h("button", { class: "icon-btn", title: s.close, "aria-label": s.close, onclick: () => onClose && onClose() }, icon("close")) : null
    );

    els.bank = h("select", { class: "bank", "aria-label": s.bankLabel, title: s.bankLabel, onchange: (e) => send({ ...request, bank: e.target.value }) });
    els.meta = h("span", { class: "meta" });
    els.amount = h("input", {
      class: "amount",
      type: "text",
      inputmode: "decimal",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: s.enterAmount,
      "aria-label": s.amountLabel,
      oninput: () => {
        amountTouched = true;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => send({ ...request, selection: els.amount.value }), 350);
      },
      onkeydown: (e) => {
        if (e.key !== "Enter") return;
        clearTimeout(typingTimer);
        send({ ...request, selection: els.amount.value });
      },
    });
    els.amount.value = initial.selection || "";
    els.src = h("select", { class: "cur", "aria-label": s.fromLabel, title: s.fromLabel, onchange: (e) => send({ ...request, src: e.target.value }) });
    els.swap = h(
      "button",
      {
        class: "icon-btn swap",
        title: s.swap,
        "aria-label": s.swap,
        onclick: () => {
          if (!request.src) return;
          els.swap.classList.toggle("turned");
          send({ ...request, src: request.dst, dst: request.src });
        },
      },
      icon("swap")
    );
    els.dst = h("select", { class: "cur", "aria-label": s.toLabel, title: s.toLabel, onchange: (e) => send({ ...request, dst: e.target.value }) });
    const picks = { bank: picker(els.bank, "bank-pick"), src: picker(els.src, "cur-pick"), dst: picker(els.dst, "cur-pick") };
    els.body = h("div", { class: "body", "aria-live": "polite" });
    els.foot = h("footer", { class: "foot", hidden: true });
    els.toast = h("div", { class: "toast", role: "status" });

    // Keys typed in the box shouldn't trigger the page's own shortcuts.
    const keep = (e) => {
      if (e.key !== "Escape") e.stopPropagation();
    };
    const card = h(
      "div",
      { class: `card mode-${mode}`, role: mode === "box" ? "dialog" : null, "aria-label": s.boxLabel, onkeydown: keep, onkeyup: keep, onkeypress: keep },
      els.head,
      h("div", { class: "controls" }, h("div", { class: "row" }, picks.bank.wrap, els.meta), h("div", { class: "row" }, els.amount, picks.src.wrap, els.swap, picks.dst.wrap)),
      els.body,
      els.foot,
      els.toast
    );
    const el = h("div", null, h("style", null, CSS), card);
    for (const sel of [els.bank, els.src, els.dst]) sel.disabled = true;
    for (const p of Object.values(picks)) p.sync();
    renderSkeleton();
    card.classList.add("busy");

    function renderSkeleton() {
      const tile = () => h("div", { class: "tile sk" }, h("span", { class: "sk-line w45" }), h("span", { class: "sk-line big w75" }), h("span", { class: "sk-line w60" }));
      els.body.replaceChildren(
        ...[0, 1].map(() => h("section", { class: "sec" }, h("div", { class: "sec-head" }, h("span", { class: "sk-line w30" })), h("div", { class: "tiles n2" }, tile(), tile())))
      );
    }

    async function send(next, { force = false } = {}) {
      request = next;
      const mine = ++seq;
      card.classList.add("busy");
      els.refresh.disabled = true;
      let m;
      try {
        m = await onRequest(next, { force });
        if (!m || !m.request) throw new Error((m && m.error) || "no response");
      } catch (e) {
        m = { ...(model || {}), request: next, readings: [], notes: [], rateLines: [], dateLine: null, hint: null, stale: null, error: String((e && e.message) || e) };
      }
      if (mine === seq) render(m); // Otherwise a newer request is on its way.
    }

    function render(m) {
      model = m;
      request = { ...request, ...(m.request || {}) };
      card.classList.remove("busy");
      els.refresh.disabled = false;
      fillSelect(els.bank, (m.banks || []).map((b) => [b.id, b.name, ""]), request.bank);
      const currencies = (m.currencies || []).map((c) => [c.code, c.code, c.name]);
      fillSelect(els.src, currencies, request.src);
      fillSelect(els.dst, currencies, request.dst);
      els.bank.disabled = !(m.banks || []).length;
      els.src.disabled = els.dst.disabled = !currencies.length;
      for (const p of Object.values(picks)) p.sync();
      els.swap.disabled = !request.src;
      if (!amountTouched && m.amountText != null) els.amount.value = m.amountText;
      updateMeta();
      renderBody();
      renderFoot();
      if (onRender) onRender();
    }

    function renderBody() {
      const m = model;
      const parts = [];
      const readings = m.readings || [];
      if (m.error && !readings.length) parts.push(h("div", { class: "alert warn" }, m.error));
      if (m.stale) parts.push(h("div", { class: "alert warn" }, m.stale));
      if (m.hint) parts.push(h("div", { class: "alert info" }, m.hint));
      if (m.srcGuessed) parts.push(h("div", { class: "alert info" }, s.srcGuessed));
      if (readingIndex >= readings.length) readingIndex = 0;
      if (readings.length > 1) {
        parts.push(
          h(
            "div",
            { class: "chips", role: "group" },
            h("span", { class: "chips-note" }, s.ambiguousNote),
            readings.map((r, i) =>
              h(
                "button",
                {
                  class: "chip",
                  "aria-pressed": String(i === readingIndex),
                  onclick: () => {
                    readingIndex = i;
                    renderBody();
                  },
                },
                r.amount
              )
            )
          )
        );
      }
      const reading = readings[readingIndex];
      if (reading) for (const sec of reading.sections) parts.push(section(sec));
      els.body.replaceChildren(...parts);
    }

    function section(sec) {
      return h(
        "section",
        { class: `sec sec-${sec.key}` },
        h("div", { class: "sec-head" }, icon(sec.key, "sec-icon"), h("span", null, sec.label)),
        sec.unavailable ? h("div", { class: "sec-empty" }, sec.unavailable) : h("div", { class: `tiles n${sec.rows.length}` }, sec.rows.map(tile))
      );
    }

    function tile(row) {
      return h(
        "button",
        { class: row.best ? "tile best" : "tile", title: s.copyHint, onclick: (e) => copy(row, e.currentTarget) },
        h("span", { class: "tile-label" }, h("span", null, row.short)),
        row.best ? h("span", { class: "badge" }, s.best) : null,
        h("span", { class: "tile-value" }, h("span", { class: "num" }, row.number), h("span", { class: "cur-code" }, row.currency), row.fee ? h("span", { class: "fee" }, "*") : null),
        row.rate ? h("span", { class: "tile-rate" }, row.rate) : null
      );
    }

    // Date and notes, then the bank's page and, folded away, its published rates.
    function renderFoot() {
      const m = model;
      const lines = [];
      if (m.dateLine) lines.push(h("div", { class: "date" }, m.dateLine));
      for (const line of m.notes || []) lines.push(h("div", null, line));
      const rates = m.rateLines || [];
      const toggle = rates.length
        ? h(
            "button",
            {
              class: "more",
              "aria-expanded": String(showRates),
              onclick: () => {
                showRates = !showRates;
                renderFoot();
                if (onRender) onRender();
              },
            },
            s.publishedRates,
            icon("chevron", "chev")
          )
        : null;
      if (m.link || toggle) {
        lines.push(h("div", { class: "foot-row" }, m.link ? h("a", { class: "link", href: m.link.href, target: "_blank", rel: "noopener noreferrer" }, m.link.text) : h("span"), toggle));
      }
      if (showRates) for (const line of rates) lines.push(h("div", { class: "published" }, line));
      els.foot.replaceChildren(...lines);
      els.foot.hidden = !lines.length;
    }

    function ago(ts) {
      const mins = Math.floor((Date.now() - ts) / 60000);
      if (mins < 1) return s.justNow;
      const rtf = new Intl.RelativeTimeFormat((model && model.locale) || "ro-MD", { numeric: "auto" });
      return mins < 60 ? rtf.format(-mins, "minute") : rtf.format(-Math.floor(mins / 60), "hour");
    }

    function updateMeta() {
      const ts = model && model.fetchedAt;
      els.meta.textContent = ts && s.updatedAgo ? s.updatedAgo.replace("$1", ago(ts)) : "";
    }
    const metaTimer = setInterval(updateMeta, 30000);

    async function writeClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // No clipboard API here (insecure page, permissions policy): fall back.
      }
      const buf = h("textarea", { class: "copy-buf", "aria-hidden": "true" });
      buf.value = text;
      card.append(buf);
      buf.focus();
      buf.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      buf.remove();
      return ok;
    }

    async function copy(row, tileEl) {
      const ok = await writeClipboard(row.number);
      toast(ok ? s.copied.replace("$1", row.value) : s.copyFailed);
      if (!ok) return;
      tileEl.classList.add("copied");
      setTimeout(() => tileEl.classList.remove("copied"), 700);
    }

    function toast(text) {
      els.toast.textContent = text;
      els.toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1600);
    }

    return {
      el,
      card,
      render,
      send: (next = request, opts) => send(next, opts),
      focusAmount() {
        els.amount.focus();
        els.amount.select();
      },
      destroy() {
        clearInterval(metaTimer);
        clearTimeout(typingTimer);
        clearTimeout(toastTimer);
      },
    };
  }

  root.ConverterView = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
