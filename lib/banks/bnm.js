// National Bank of Moldova official rates (XML). A reference rate, not a
// bank's buy/sell price, so it fills the "official" table.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  const url = (dmy) => `https://www.bnm.md/ro/official_exchange_rates?get_xml=1&date=${dmy}`;

  Banks.register({
    id: "bnm",
    name: "BNM",
    nameKey: "bankBnm",
    pageUrl: (lang) => `https://www.bnm.md/${lang}/official_exchange_rates`,
    requests: (days = 0) => [{ url: url(Scrape.chisinau(days).dmy), marker: "<ValCurs" }],
    // Today's rates may not be published yet: walk back a few days on 404.
    async load(get, bank) {
      for (let days = 0; days > -5; days--) {
        try {
          return [await get(bank.requests(days)[0])];
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
      throw new Scrape.RateError("http", "404", { status: 404 });
    },
    parse([xml]) {
      const head = Scrape.between(xml, "<ValCurs", ">");
      if (!head) throw Scrape.layoutError("not a ValCurs document");
      const official = {};
      for (const v of Scrape.chunks(xml, "<Valute ")) {
        const field = (name) => (Scrape.between(v, `<${name}>`, `</${name}>`) || "").slice(name.length + 2).trim();
        const code = field("CharCode");
        const value = Scrape.toRate(field("Value"));
        const nominal = Number(field("Nominal")) || 1;
        if (/^[A-Z]{3}$/.test(code) && value) official[code] = { buy: value / nominal, sell: value / nominal };
      }
      return { date: Scrape.toDate(Scrape.attr(head, "Date")), tables: { official } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
