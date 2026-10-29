// String helpers for pulling rates out of bank pages. Chrome's service worker
// has no DOMParser, so adapters work on the raw HTML/JSON/XML text.
(function (root) {
  "use strict";

  // Thrown by adapters and the fetch layer; `code` picks the message shown.
  class RateError extends Error {
    constructor(code, detail = "", extra = {}) {
      super(detail ? `${code}: ${detail}` : code);
      this.code = code;
      this.detail = detail;
      Object.assign(this, extra);
    }
  }

  const layoutError = (what) => new RateError("layout", what);

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }

  // Visible text of an HTML fragment, whitespace collapsed.
  function text(html) {
    return decodeEntities(
      String(html)
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]*>/g, " ")
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  // From the first `start` up to the nearest following `end` marker (a string
  // or a list), or the end of the text. Returns null when `start` isn't there.
  function between(html, start, end) {
    if (html == null) return null;
    const i = html.indexOf(start);
    if (i < 0) return null;
    const ends = (Array.isArray(end) ? end : end ? [end] : [])
      .map((m) => html.indexOf(m, i + start.length))
      .filter((j) => j >= 0);
    return html.slice(i, ends.length ? Math.min(...ends) : undefined);
  }

  // Pieces starting at each occurrence of `marker`: "x<li>a<li>b" -> ["<li>a", "<li>b"].
  function chunks(html, marker) {
    const out = [];
    let i = html.indexOf(marker);
    while (i >= 0) {
      const j = html.indexOf(marker, i + marker.length);
      out.push(html.slice(i, j < 0 ? undefined : j));
      i = j;
    }
    return out;
  }

  // Opening tags named `name`, optionally only those containing `contains`.
  function tags(html, name, contains) {
    const all = String(html).match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
    return contains ? all.filter((t) => t.includes(contains)) : all;
  }

  function attr(tag, name) {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
    return m ? decodeEntities(m[1] ?? m[2]) : null;
  }

  // Rows of a table fragment as arrays of cell texts.
  function tableRows(html) {
    return String(html)
      .split(/<tr\b/i)
      .slice(1)
      .map((row) => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => text(m[1])));
  }

  // "20,18", "20.1800 MDL" or 20.18 -> 20.18; "-", "", "0.0000" -> null.
  function toRate(value) {
    if (value == null) return null;
    const m = /\d+(?:[.,]\d+)?/.exec(String(value));
    if (!m) return null;
    const n = Number(m[0].replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // "2026-10-29", "2026.10.29", "29/10/2026" or "29.10.2026" -> "29.10.2026".
  function toDate(s) {
    if (!s) return null;
    let m = /(\d{4})[-./](\d{2})[-./](\d{2})/.exec(s);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    m = /(\d{2})[-./](\d{2})[-./](\d{4})/.exec(s);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  }

  // [[code, buy, sell], ...] -> { EUR: { buy, sell }, ... }. Skips MDL,
  // anything that isn't a currency code, and repeats (first one wins).
  function table(entries) {
    const out = {};
    for (const [code, buy, sell] of entries) {
      const c = String(code || "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(c) || c === "MDL" || c in out) continue;
      out[c] = { buy: toRate(buy), sell: toRate(sell) };
    }
    return out;
  }

  const hasRates = (t) => !!t && Object.values(t).some((r) => r.buy && r.sell);

  // Date and time in Chișinău, `days` from now: { iso: "2026-10-29", dmy: "29.10.2026", time: "21:15" }.
  const chisinauFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Chisinau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  function chisinau(days = 0, now = Date.now()) {
    const p = Object.fromEntries(chisinauFmt.formatToParts(new Date(now + days * 86400000)).map((x) => [x.type, x.value]));
    return { iso: `${p.year}-${p.month}-${p.day}`, dmy: `${p.day}.${p.month}.${p.year}`, time: `${p.hour}:${p.minute}` };
  }

  const api = {
    RateError,
    layoutError,
    decodeEntities,
    text,
    between,
    chunks,
    tags,
    attr,
    tableRows,
    toRate,
    toDate,
    table,
    hasRates,
    chisinau,
  };
  root.Scrape = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
