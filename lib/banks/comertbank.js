// Comerțbank: rates widget on the https://comertbank.md/ homepage.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  // A .vault block is three columns: currency codes, buy values, sell values.
  function rates(html, cls) {
    const block = Scrape.between(html, `class="vault ${cls}`, "universal_button");
    if (!block) return {};
    const [codes, buy, sell] = Scrape.chunks(block, 'class="vault_cell"').map((cell) =>
      [...cell.matchAll(/class="vault_(?:symbol|nr)"[^>]*>([^<]*)</g)].map((m) => m[1].trim())
    );
    return Scrape.table((codes || []).map((code, i) => [code, buy && buy[i], sell && sell[i]]));
  }

  Banks.register({
    id: "comertbank",
    name: "Comerțbank",
    pageUrl: (lang) => (lang === "ro" ? "https://comertbank.md/" : `https://comertbank.md/${lang}/`),
    requests: () => [{ url: "https://comertbank.md/", marker: "vault v_banka" }],
    parse([html]) {
      if (!html.includes("vault v_banka")) throw Scrape.layoutError("cash rates not found");
      const date = Scrape.between(html, 'class="exchange_date', "</");
      // Cut each block at the next one so cash doesn't run into the BNM column.
      const cashHtml = Scrape.between(html, 'class="vault v_banka', 'class="vault v_nbm') || "";
      return { date: Scrape.toDate(date), tables: { cash: rates(cashHtml, "v_banka"), card: rates(html, "v_card") } };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
