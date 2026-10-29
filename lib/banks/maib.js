// maib: https://www.maib.md/ro/curs-valutar, behind Imperva Incapsula.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  // Tab panes: "Numerar – Din sucursale" and "Operațiuni cu card" (#two-new before Oct 2026).
  const CASH = "one-one-new";
  const CARD = ["operatiuni-cu-card", "two-new"];

  const pane = (html, id) => Scrape.between(html, `id="${id}"`, 'class="tab-pane');
  const rates = (p) => Scrape.table(Scrape.tableRows(Scrape.between(p, "<table", "</table>") || ""));

  Banks.register({
    id: "maib",
    name: "maib",
    pageUrl: (lang) => `https://www.maib.md/${lang}/curs-valutar`,
    requests: () => [{ url: "https://www.maib.md/ro/curs-valutar", marker: `id="${CASH}"` }],
    tabFallback: true,
    parse([html]) {
      const cashPane = pane(html, CASH);
      if (!cashPane) throw Scrape.layoutError("cash table not found");
      const cardPane = CARD.map((id) => pane(html, id)).find(Boolean);
      const input = Scrape.tags(cashPane, "input", "curs__valutar_date")[0] || "";
      return {
        date: Scrape.toDate(Scrape.attr(input, "data-date") || Scrape.attr(input, "value")),
        tables: { cash: rates(cashPane), card: cardPane ? rates(cardPane) : {} },
      };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
