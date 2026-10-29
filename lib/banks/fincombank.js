// FinComBank: cash rates differ by branch; we read branch nr. 3 (bd. Dacia 20).
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  const BRANCH = "11041229";

  Banks.register({
    id: "fincombank",
    name: "FinComBank",
    pageUrl: (lang) => `https://fincombank.com/${lang === "ru" ? "ru" : "ro"}/curs-valutar`,
    requests: () => [
      { url: `https://fincombank.com/ro/curs-valutar/fx/${BRANCH}`, marker: "exchange-rates__valuta-item" },
      { url: "https://fincombank.com/ro/curs-valutar-pentru-carduri", marker: "htmlCardsCurrencyConverter" },
    ],
    noteKey: "noteFincombank",
    parse([cashHtml, cardHtml]) {
      // <button data-sell="20.1800" data-buy="20.0300" class="exchange-rates__valuta-item">EUR</button>
      const buttons = [...cashHtml.matchAll(/(<button\b[^>]*exchange-rates__valuta-item[^>]*>)\s*([A-Z]{3})/g)];
      if (!buttons.length) throw Scrape.layoutError("cash rates not found");
      const cash = Scrape.table(buttons.map(([, tag, code]) => [code, Scrape.attr(tag, "data-buy"), Scrape.attr(tag, "data-sell")]));
      // <tr class="valute" data-code="EUR" data-rate-buy="19.8600" data-rate-sell="20.3400">
      const card = Scrape.table(
        Scrape.tags(cardHtml, "tr", 'class="valute"').map((t) => [Scrape.attr(t, "data-code"), Scrape.attr(t, "data-rate-buy"), Scrape.attr(t, "data-rate-sell")])
      );
      const dateInput = Scrape.tags(cashHtml, "input", 'id="filials_date"')[0];
      return { date: Scrape.toDate(dateInput && Scrape.attr(dateInput, "value")), tables: { cash, card } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
