// Energbank: JSON API used by the site's rate widget.
(function (root) {
  "use strict";
  const { Banks, Scrape } = root;

  const API = "https://www.energbank.com/api/v1/main/corebanking/exchanges";
  // "pref" is SMART CURS: online exchange in the mobile app.
  const TYPES = [
    ["cash", "cash"],
    ["card", "card"],
    ["online", "pref"],
  ];

  Banks.register({
    id: "energbank",
    name: "Energbank",
    pageUrl: (lang) => `https://www.energbank.com/${lang}`,
    requests: () => TYPES.map(([, type]) => ({ url: `${API}/${type}/history`, type: "json" })),
    noteKey: "noteEnergbank",
    parse(bodies) {
      if (!Array.isArray(bodies[0])) throw Scrape.layoutError("unexpected cash response");
      const tables = {};
      let date = null;
      TYPES.forEach(([key], i) => {
        const rows = (Array.isArray(bodies[i]) ? bodies[i] : []).filter((r) => r && r.show_in_table !== false);
        tables[key] = Scrape.table(rows.map((r) => [r.currency, r.buying, r.selling]));
        if (!date && rows[0]) date = Scrape.toDate(rows[0].current_date);
      });
      return { date, tables };
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
