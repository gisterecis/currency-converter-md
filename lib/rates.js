// Extracts maib exchange rates from the https://www.maib.md/ro/curs-valutar page.
(function (root) {
  "use strict";

  const RATES_URL = "https://www.maib.md/ro/curs-valutar";

  // Tab panes on the page: "Numerar – Din sucursale" and "Operațiuni cu card".
  const PANES = { cash: "one-one-new", card: "two-new" };

  function toRate(text) {
    const t = (text || "").trim().replace(",", ".");
    if (!t || t === "-") return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function parseTable(pane) {
    const table = pane.querySelector("table");
    if (!table) return null;
    const out = {};
    for (const row of table.querySelectorAll("tbody tr")) {
      const cells = [...row.querySelectorAll("td")].map((td) => td.textContent.trim());
      const code = cells[0];
      if (!/^[A-Z]{3}$/.test(code || "")) continue;
      out[code] = { buy: toRate(cells[1]), sell: toRate(cells[2]) };
      if (cells.length > 3) out[code].bnm = toRate(cells[3]);
    }
    return out;
  }

  // "2026-09-29" -> "29.09.2026"
  function paneDate(pane) {
    const input = pane.querySelector("input.curs__valutar_date, input[name=date]");
    if (!input) return null;
    const iso = input.getAttribute("data-date");
    const m = iso && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : input.getAttribute("value") || null;
  }

  function parseRates(doc) {
    const cashPane = doc.getElementById(PANES.cash);
    if (!cashPane) throw new Error("maib page layout changed: cash rate table not found");
    const cash = parseTable(cashPane);
    if (!cash || !Object.values(cash).some((r) => r.buy && r.sell)) {
      throw new Error("maib page layout changed: no cash rates found");
    }
    const cardPane = doc.getElementById(PANES.card);
    const card = (cardPane && parseTable(cardPane)) || {};
    return { date: paneDate(cashPane), cash, card };
  }

  function isChallengePage(html) {
    return !html.includes(PANES.cash) && /_Incapsula_Resource|incap_ses|Incapsula/i.test(html);
  }

  const api = { RATES_URL, PANES, parseRates, isChallengePage };
  root.MaibRates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
