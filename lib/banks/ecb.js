// EuroCreditBank: rates widget on the https://www.ecb.md/ homepage.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  // Flat runs of divs: currname, buy (currval), sell (currval-wide), BNM (currval-tyny).
  function rates(sector) {
    const rows = [];
    for (const m of (sector || "").matchAll(/class="([^"]*\b(?:currname|currval)\b[^"]*)"[^>]*>([^<]*)</g)) {
      const cls = m[1].split(/\s+/);
      if (cls.includes("currname")) rows.push([m[2].trim()]);
      else if (rows.length && !cls.includes("currval-tyny")) rows[rows.length - 1].push(m[2].trim());
    }
    return Scrape.table(rows);
  }

  const sector = (html, n) => Scrape.between(html, `class="sector sector-${n}`, ['class="sector ', "disclamer"]);

  Banks.register({
    id: "ecb",
    name: "EuroCreditBank",
    pageUrl: (lang) => (lang === "ro" ? "https://www.ecb.md/" : `https://www.ecb.md/${lang}/`),
    requests: () => [{ url: "https://www.ecb.md/", marker: "sector sector-1" }],
    parse([html]) {
      const s1 = html.indexOf('class="sector sector-1');
      if (s1 < 0) throw Scrape.layoutError("cash rates not found");
      // "Curs valutar - 29/10/2026" in the widget title just before the tables.
      const title = html.slice(html.lastIndexOf("currency-informer", s1), s1);
      return { date: Scrape.toDate(title), tables: { cash: rates(sector(html, 1)), card: rates(sector(html, 2)) } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
