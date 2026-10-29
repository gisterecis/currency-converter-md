// ProCredit Bank: rates are in the page's Drupal settings JSON. The site
// rate-limits by IP (HTTP 571), so rely on the cache.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  const rates = (t) => Scrape.table(Object.entries((t && t.rates) || {}).map(([code, r]) => [code, r && r.buy, r && r.sell]));

  Banks.register({
    id: "procredit",
    name: "ProCredit Bank",
    pageUrl: (lang) => `https://procreditbank.md/${lang}/schimb_valutar`,
    requests: () => [{ url: "https://procreditbank.md/ro/schimb_valutar", marker: "procreditExchangeRates" }],
    parse([html]) {
      const script = Scrape.between(html, 'data-drupal-selector="drupal-settings-json">', "</script>");
      let settings;
      try {
        settings = JSON.parse(script.slice(script.indexOf(">") + 1));
      } catch (e) {
        throw Scrape.layoutError("settings JSON not found");
      }
      const ex = settings.procreditExchangeRates;
      if (!ex) throw Scrape.layoutError("exchange rates missing");
      const desc = Scrape.between(html, "js-description-procredit_exchange_rates_cash_form", "</p>");
      return { date: Scrape.toDate(desc), tables: { cash: rates(ex.cash), card: rates(ex.card) } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
