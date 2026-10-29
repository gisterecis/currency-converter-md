// Eximbank: https://eximbank.md/ro/exchange, behind Imperva.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  // Rows: <span>Euro <b>(EUR)</b></span> | buy | sell | BNM.
  function rates(li) {
    return Scrape.table(
      Scrape.tableRows(li || "").map((cells) => {
        const m = /\(([A-Z]{3})\)/.exec(cells[0] || "");
        return [m ? m[1] : "", cells[1], cells[2]];
      })
    );
  }

  Banks.register({
    id: "eximbank",
    name: "Eximbank",
    pageUrl: (lang) => `https://eximbank.md/${lang}/exchange`,
    requests: () => [{ url: "https://eximbank.md/ro/exchange", marker: "static__table" }],
    tabFallback: true,
    parse([html]) {
      const section = Scrape.between(html, 'class="exchange-rates', "</section>");
      const list = Scrape.between(section, '<ul class="tab__container', "</ul>");
      if (!list) throw Scrape.layoutError("rate tabs not found");
      const [cash, card] = Scrape.chunks(list, '<li class="tab__item');
      // "Cursul de schimb valutar a fost actualizat 2026.10.29"
      return { date: Scrape.toDate(Scrape.between(section, "<h2", "</h2>")), tables: { cash: rates(cash), card: rates(card) } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
