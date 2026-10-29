// Moldindconbank: rates on the https://micb.md/ homepage (Cloudflare in front).
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  // <div class="col buy_EUR" data-sell="19.95"> — the attribute is data-sell on buy cells too.
  function rates(fragment) {
    const found = {};
    for (const tag of Scrape.tags(fragment || "", "div")) {
      const m = /class="col (buy|sell)_([A-Z]{3})"/.exec(tag);
      if (!m) continue;
      const r = (found[m[2]] = found[m[2]] || {});
      if (!(m[1] in r)) r[m[1]] = Scrape.attr(tag, "data-sell");
    }
    return Scrape.table(Object.entries(found).map(([code, r]) => [code, r.buy, r.sell]));
  }

  Banks.register({
    id: "micb",
    name: "Moldindconbank",
    pageUrl: (lang) => (lang === "ro" ? "https://micb.md/" : `https://micb.md/${lang}/`),
    requests: () => [{ url: "https://micb.md/", marker: "exchange_numerar" }],
    parse([html]) {
      const cash = Scrape.between(html, "exchange_numerar", "exchange_card");
      if (!cash) throw Scrape.layoutError("cash table not found");
      // The page shows no date; the rates are today's.
      return { date: null, tables: { cash: rates(cash), card: rates(Scrape.between(html, "exchange_card", "</section")) } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
