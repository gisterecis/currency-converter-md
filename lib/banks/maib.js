// maib: https://www.maib.md/ro/curs-valutar, behind Imperva Incapsula.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  // Leaf tab panes holding one rate table each, newest ids first. Since
  // 27.11.2026 the page nests them in groups (branches, ATMs, self-service
  // terminals, the maibank app, card operations); before that there were only
  // #one-one-new (cash) and #operatiuni-cu-card / #two-new (card).
  const PANES = {
    cash: ["sucursale-agentii-one", "one-one-new"], // cash at branches and agencies (not the customs agencies)
    card: ["curs-de-card", "operatiuni-cu-card", "two-new"],
    online: ["fx-maibank"], // FX maibank: exchange in the app
    transfer: ["maibank-virament", "tss-virament"], // transfers between accounts, incoming international transfers
  };
  // The date picker is on every version of the page, and not on Imperva's
  // challenge, so it tells a real page with a changed layout from a bot check.
  const MARKER = "curs__valutar_date";

  // From the pane's own id up to the next pane. The closing quote keeps
  // id="x-tab" (the tab link) from matching id="x".
  const pane = (html, id) => Scrape.between(html, `id="${id}"`, 'class="tab-pane');
  const rates = (p) => Scrape.table(Scrape.tableRows(Scrape.between(p, "<table", "</table>") || ""));
  const first = (html, ids) => ids.map((id) => pane(html, id)).find((p) => p && p.includes("<table"));

  Banks.register({
    id: "maib",
    name: "maib",
    pageUrl: (lang) => `https://www.maib.md/${lang}/curs-valutar`,
    requests: () => [{ url: "https://www.maib.md/ro/curs-valutar", marker: MARKER }],
    tabFallback: true,
    parse([html]) {
      const cashPane = first(html, PANES.cash);
      if (!cashPane) throw Scrape.layoutError("cash table not found");
      const tables = {};
      for (const [key, ids] of Object.entries(PANES)) {
        const p = key === "cash" ? cashPane : first(html, ids);
        if (p) tables[key] = rates(p);
      }
      if (!Scrape.hasRates(tables.cash)) throw Scrape.layoutError("cash table has no rates");
      const input = Scrape.tags(cashPane, "input", "curs__valutar_date")[0] || "";
      return { date: Scrape.toDate(Scrape.attr(input, "data-date") || Scrape.attr(input, "value")), tables };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
